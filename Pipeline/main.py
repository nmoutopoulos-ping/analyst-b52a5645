"""
main.py — Ping Pipeline Entry Point
--------------------------------------
Orchestrates the full underwriting pipeline:

  1. Fetch NEW searches from Google Sheets CSV
  2. Call RentCast API for rental comps per unit-mix combo
  3. Populate Excel model (Raw Comps, Assumptions, Inputs)
  4. Generate Word summary (executive + market analysis + comp listings)
  5. Email .xlsx + .docx to requester  [disabled until SMTP is configured]
  6. Mark searches DONE locally + best-effort GAS status update

Run:  python main.py
"""

import json
import shutil
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook

from config import TEMPLATE_PATH, OUTPUT_DIR
from helpers import (
    load_processed, save_processed,
    shorten_address, aggregate_rent_assumptions,
)
from fetcher import fetch_new_searches, gas_update_status, rentcast_comps, build_comp_rows
from excel_writer import (
    populate_raw_comps,
    populate_assumptions, populate_inputs,
)
from docx_writer import generate_summary_docx
from emailer import generate_summary, generate_email_body, send_email


def run_pipeline() -> None:
    print(f"\n{'='*60}")
    print(f"  Ping Pipeline — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    # 1. Fetch new searches
    print("\n[1] Fetching NEW searches from Google Sheets...")
    rows = fetch_new_searches()
    if not rows:
        print("  No NEW searches found. Nothing to process.")
        return
    print(f"  Found {len(rows)} NEW row(s).")

    # Group rows by searchId (each combo is one row in the sheet)
    searches = defaultdict(list)
    for row in rows:
        searches[row["searchId"]].append(row)
    print(f"  Grouped into {len(searches)} unique search(es).")

    processed = load_processed()

    for search_id, combo_rows in searches.items():
        print(f"\n[Search] {search_id}")
        gas_update_status(search_id, "PROCESSING")

        try:
            base = combo_rows[0]
            search_meta = {
                "searchId":   search_id,
                "email":      base["email"],
                "address":    base["address"],
                "lat":        float(base["lat"]),
                "lng":        float(base["lng"]),
                "radius":     float(base["radius"]),
                "minComps":   int(float(base["minComps"])),
                "maxComps":   int(float(base["maxComps"])),
                "status":     base["status"],
                "totalUnits": base["totalUnits"],
                "price":      base["price"],
                "cost":       base["cost"],
                "sqft":       base["sqft"],
            }
            combos = [
                {"beds": r["beds"], "baths": r["baths"], "type": r["type"], "units": r.get("units", "")}
                for r in combo_rows
            ]

            # Parse commercial spaces from first combo row (property-level data)
            try:
                commercial_spaces = json.loads(base.get("commercial", "") or "[]")
            except (json.JSONDecodeError, ValueError):
                commercial_spaces = []

            # Derive totalUnits from per-combo unit counts; fall back to sheet value
            try:
                derived_total = sum(int(float(r.get("units", 0) or 0)) for r in combo_rows)
            except (ValueError, TypeError):
                derived_total = 0
            if derived_total > 0:
                search_meta["totalUnits"] = str(derived_total)

            # 2. Fetch RentCast comps for each unit-mix combo (parallel)
            print(f"  [2] Fetching RentCast comps for {len(combos)} combo(s) in parallel...")

            def _fetch_combo(combo):
                listings = rentcast_comps(
                    lat=search_meta["lat"],
                    lng=search_meta["lng"],
                    radius=search_meta["radius"],
                    beds=combo["beds"],
                    baths=combo["baths"],
                    status=search_meta["status"],
                    limit=search_meta["maxComps"],
                )
                rows = build_comp_rows(
                    listings,
                    search_meta["lat"], search_meta["lng"],
                    search_meta["price"], search_meta["cost"],
                    combo["beds"], combo["baths"], combo["type"],
                )
                return combo, rows

            all_comp_rows = []
            with ThreadPoolExecutor(max_workers=len(combos)) as executor:
                futures = {executor.submit(_fetch_combo, c): c for c in combos}
                for future in as_completed(futures):
                    combo, rows = future.result()
                    print(f"      → {combo['type']} {combo['beds']}bd/{combo['baths']}ba: {len(rows)} comps")
                    all_comp_rows.extend(rows)

            # Sort by (beds, baths) to keep consistent ordering across output files
            all_comp_rows.sort(key=lambda r: (float(r["filter_beds"]), float(r["filter_baths"])))

            comp_summary = aggregate_rent_assumptions(all_comp_rows)

            # 3. Copy template and populate Excel model
            print(f"  [3] Populating Excel model...")
            short_name  = shorten_address(base["address"])
            safe_addr   = short_name.replace("/", "-").replace(":", "")[:60]
            folder_name = f"{search_id} — {safe_addr} — {search_meta['email']}"
            job_dir     = OUTPUT_DIR / folder_name
            job_dir.mkdir(parents=True, exist_ok=True)
            output_fn   = job_dir / f"Ping_{search_id}_Model.xlsx"
            shutil.copy(TEMPLATE_PATH, output_fn)

            wb = load_workbook(output_fn)
            populate_raw_comps(wb["Raw Comps"], all_comp_rows, search_meta)
            populate_assumptions(wb["Assumptions"], search_meta, combos, comp_summary, commercial_spaces)
            populate_inputs(wb["Inputs"], search_meta, combos, comp_summary, commercial_spaces)
            wb.save(output_fn)
            print(f"         Excel: {output_fn.name}")

            # 4. Generate Word summary (exec + market analysis + full comp listings)
            print(f"  [4] Generating Word summary...")
            summary_fn = generate_summary_docx(
                job_dir, search_meta, comp_summary, all_comp_rows
            )

            print()
            print(generate_summary(search_meta, combos, comp_summary))
            print()

            # 5. Build email + send
            print(f"  [5] Sending email to {search_meta['email']}...")
            subject    = f"Your Ping analysis is ready \u2014 {short_name}"
            email_body = generate_email_body(
                search_meta, comp_summary, output_fn, summary_fn,
                commercial_spaces=commercial_spaces,
            )
            send_email(
                search_meta["email"], subject, email_body,
                [output_fn, summary_fn],
            )

            # 6. Mark DONE
            processed.add(search_id)
            save_processed(processed)
            gas_update_status(search_id, "DONE")
            print(f"  \u2705  {search_id} complete.")

        except Exception as e:
            import traceback
            print(f"  \u274c  Error processing {search_id}: {e}")
            traceback.print_exc()
            gas_update_status(search_id, "ERROR")

    print(f"\n{'='*60}")
    print("  Pipeline run complete.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    run_pipeline()
