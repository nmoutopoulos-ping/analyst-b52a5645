"""
main.py — Ping Pipeline Entry Point
--------------------------------------
Orchestrates the full underwriting pipeline:

  1. Accept search data directly from payload (no Google Sheets needed)
  2. Call RentCast API for rental comps per unit-mix combo (parallel)
  3. Populate Excel model (Raw Comps, Assumptions, Inputs)
  4. Generate Word summary (executive + market analysis + comp listings)
  5. Email .xlsx + .docx to requester
  6. Mark search processed locally

Entry points:
  run_pipeline_from_payload(payload)  ← called by server.py on POST /trigger
  run_pipeline()                      ← legacy sheet-based runner (local dev only)
"""

import json
import shutil
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook

from config import TEMPLATE_PATH, OUTPUT_DIR
from helpers import (
    load_processed, save_processed,
    shorten_address, aggregate_rent_assumptions,
)
from fetcher import rentcast_comps, build_comp_rows
from excel_writer import populate_raw_comps, populate_assumptions, populate_inputs
from docx_writer import generate_summary_docx
from emailer import generate_summary, generate_email_body, send_email


# ── Shared pipeline core ────────────────────────────────────────────────────────

def _run_search(search_id: str, search_meta: dict,
                combos: list, commercial_spaces: list) -> None:
    """Steps 2-6 for a single search. Used by both entry points."""

    # 2. Fetch RentCast comps (parallel across combos)
    print(f"  [2] Fetching RentCast comps for {len(combos)} combo(s) in parallel...")

    def _fetch(combo):
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
    with ThreadPoolExecutor(max_workers=max(len(combos), 1)) as ex:
        for combo, rows in [f.result() for f in as_completed(
                {ex.submit(_fetch, c): c for c in combos})]:
            print(f"      → {combo['type']} {combo['beds']}bd/{combo['baths']}ba: {len(rows)} comps")
            all_comp_rows.extend(rows)

    all_comp_rows.sort(key=lambda r: (float(r["filter_beds"]), float(r["filter_baths"])))
    comp_summary = aggregate_rent_assumptions(all_comp_rows)

    # Embed per-type unit counts; ensure every combo appears even with 0 comps
    combo_map = {}
    for c in combos:
        try:
            bs = str(int(float(c["beds"])))
            bf = float(c["baths"])
            ba = str(int(bf)) if bf == int(bf) else str(bf)
        except (ValueError, TypeError):
            bs, ba = str(c["beds"]), str(c["baths"])
        try:
            u = int(float(c.get("units", 0) or 0))
        except (ValueError, TypeError):
            u = 0
        combo_map[(bs, ba)] = u

    for s in comp_summary:
        s["units"] = combo_map.get((s["beds"], s["baths"]), 0)
    existing = {(s["beds"], s["baths"]) for s in comp_summary}
    for (bs, ba), u in combo_map.items():
        if (bs, ba) not in existing:
            comp_summary.append({"beds": bs, "baths": ba,
                                  "count": 0, "avg_rent": 0, "avg_sqft": 0, "units": u})
    comp_summary.sort(key=lambda s: (float(s["beds"]), float(s["baths"])))

    # 3. Populate Excel model
    print(f"  [3] Populating Excel model...")
    short_name  = shorten_address(search_meta["address"])
    safe_addr   = short_name.replace("/", "-").replace(":", "")[:60]
    job_dir     = OUTPUT_DIR / f"{search_id} — {safe_addr} — {search_meta['email']}"
    job_dir.mkdir(parents=True, exist_ok=True)
    output_fn   = job_dir / f"Ping_{search_id}_Model.xlsx"
    shutil.copy(TEMPLATE_PATH, output_fn)

    wb = load_workbook(output_fn)
    populate_raw_comps(wb["Raw Comps"], all_comp_rows, search_meta)
    populate_assumptions(wb["Assumptions"], search_meta, combos, comp_summary, commercial_spaces)
    populate_inputs(wb["Inputs"], search_meta, combos, comp_summary, commercial_spaces)
    wb.save(output_fn)
    print(f"         Excel: {output_fn.name}")

    # 4. Generate Word summary
    print(f"  [4] Generating Word summary...")
    summary_fn = generate_summary_docx(job_dir, search_meta, comp_summary, all_comp_rows)
    print()
    print(generate_summary(search_meta, combos, comp_summary))
    print()

    # 5. Send email
    print(f"  [5] Sending email to {search_meta['email']}...")
    subject    = f"Your Ping analysis is ready \u2014 {short_name}"
    email_body = generate_email_body(
        search_meta, comp_summary, output_fn, summary_fn,
        commercial_spaces=commercial_spaces,
    )
    send_email(search_meta["email"], subject, email_body, [output_fn, summary_fn])

    # 6. Mark done
    processed = load_processed()
    processed.add(search_id)
    save_processed(processed)
    print(f"  \u2705  {search_id} complete.")


# ── Primary entry point (called by server.py) ───────────────────────────────────

def run_pipeline_from_payload(payload: dict) -> None:
    """
    Run the full pipeline from a payload dict POSTed by the Chrome extension.
    Keys: searchId, email, address, lat, lng, price, cost, sqft,
          radius, minComps, maxComps, status, combos, commercial
    """
    print(f"\n{'='*60}")
    print(f"  Ping Pipeline — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    search_id         = payload.get("searchId", f"SRCH-{datetime.now().strftime('%Y%m%d')}-ADHOC")
    combos            = payload.get("combos", [])
    commercial_spaces = payload.get("commercial") or []

    print(f"\n[Search] {search_id}")

    try:
        try:
            total_units = sum(int(float(c.get("units", 0) or 0)) for c in combos)
        except (ValueError, TypeError):
            total_units = 0

        search_meta = {
            "searchId":   search_id,
            "email":      payload.get("email", ""),
            "address":    payload.get("address", ""),
            "lat":        float(payload.get("lat") or 0),
            "lng":        float(payload.get("lng") or 0),
            "radius":     float(payload.get("radius") or 1),
            "minComps":   int(float(payload.get("minComps") or 5)),
            "maxComps":   int(float(payload.get("maxComps") or 20)),
            "status":     payload.get("status", "Active"),
            "totalUnits": str(total_units),
            "price":      payload.get("price", ""),
            "cost":       payload.get("cost", ""),
            "sqft":       payload.get("sqft", ""),
        }
        _run_search(search_id, search_meta, combos, commercial_spaces)

    except Exception as e:
        print(f"  \u274c  Error in {search_id}: {e}")
        traceback.print_exc()
        raise

    print(f"\n{'='*60}")
    print("  Pipeline run complete.")
    print(f"{'='*60}\n")


# ── Legacy entry point (local dev / sheet-based) ────────────────────────────────

def run_pipeline() -> None:
    """Legacy runner — reads NEW rows from Google Sheets. Local dev only."""
    from collections import defaultdict
    from fetcher import fetch_new_searches, gas_update_status

    print(f"\n{'='*60}")
    print(f"  Ping Pipeline (sheet mode) — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    print("\n[1] Fetching NEW searches from Google Sheets...")
    rows = fetch_new_searches()
    if not rows:
        print("  No NEW searches found.")
        return
    print(f"  Found {len(rows)} row(s).")

    searches = defaultdict(list)
    for row in rows:
        searches[row["searchId"]].append(row)

    for search_id, combo_rows in searches.items():
        print(f"\n[Search] {search_id}")
        gas_update_status(search_id, "PROCESSING")
        try:
            base   = combo_rows[0]
            combos = [{"beds": r["beds"], "baths": r["baths"],
                       "type": r["type"], "units": r.get("units", "")}
                      for r in combo_rows]
            try:
                commercial_spaces = json.loads(base.get("commercial", "") or "[]")
            except (json.JSONDecodeError, ValueError):
                commercial_spaces = []
            try:
                derived = sum(int(float(r.get("units", 0) or 0)) for r in combo_rows)
            except (ValueError, TypeError):
                derived = 0
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
                "totalUnits": str(derived) if derived > 0 else base["totalUnits"],
                "price":      base["price"],
                "cost":       base["cost"],
                "sqft":       base["sqft"],
            }
            _run_search(search_id, search_meta, combos, commercial_spaces)
            gas_update_status(search_id, "DONE")
        except Exception as e:
            print(f"  \u274c  {search_id}: {e}")
            traceback.print_exc()
            gas_update_status(search_id, "ERROR")

    print(f"\n{'='*60}")
    print("  Pipeline run complete.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    run_pipeline()
