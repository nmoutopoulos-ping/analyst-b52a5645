"""
main.py — Ping Pipeline Entry Point
--------------------------------------
Orchestrates the full underwriting pipeline:

  1. Accept search data directly from payload (no Google Sheets needed)
  2. Call RentCast API for rental comps per unit-mix combo (parallel)
  3. Populate Excel model (Raw Comps, Assumptions, Inputs)
  4. Generate Word summary (executive + market analysis + comp listings)
  5. Upload files to Supabase Storage, insert deal row to database
  6. Mark search processed locally

Entry points:
  run_pipeline_from_payload(payload) ← called by server.py on POST /trigger
  run_pipeline()                     ← legacy sheet-based runner (local dev only)
"""

import json
import shutil
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

from config import TEMPLATE_PATH, OUTPUT_DIR
from helpers import (
    load_processed,
    save_processed,
    shorten_address,
    aggregate_rent_assumptions,
)
from fetcher import rentcast_comps, build_comp_rows
from excel_writer import populate_raw_comps, populate_assumptions, populate_inputs
from docx_writer import generate_summary_docx
from emailer import generate_summary
from supabase_client import upload_deal_file, insert_deal
from assumptions import compute_returns


# ── Shared pipeline core ──────────────────────────────────────────────────────

def _run_search(search_id: str, search_meta: dict, combos: list,
                commercial_spaces: list, assump: dict | None = None) -> None:
    """Steps 2-6 for a single search. Used by both entry points."""
    assump = assump or {}

    # 2. Fetch RentCast comps (parallel across combos)
    print(f"  [2] Fetching RentCast comps for {len(combos)} combo(s) in parallel...")

    def _fetch(combo):
        listings = rentcast_comps(
            lat=search_meta["lat"], lng=search_meta["lng"],
            radius=search_meta["radius"],
            beds=combo["beds"], baths=combo["baths"],
            status=search_meta["status"],
            limit=search_meta["maxComps"],
        )
        rows = build_comp_rows(
            listings, search_meta["lat"], search_meta["lng"],
            search_meta["price"], search_meta["cost"],
            combo["beds"], combo["baths"], combo["type"],
        )
        return combo, rows

    all_comp_rows = []
    with ThreadPoolExecutor(max_workers=max(len(combos), 1)) as ex:
        for combo, rows in [f.result() for f in as_completed(
                {ex.submit(_fetch, c): c for c in combos})]:
            print(f"    → {combo['type']} {combo['beds']}bd/{combo['baths']}ba: {len(rows)} comps")
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
            comp_summary.append({
                "beds": bs, "baths": ba, "count": 0,
                "avg_rent": 0, "avg_sqft": 0, "units": u,
            })
    comp_summary.sort(key=lambda s: (float(s["beds"]), float(s["baths"])))

    # Compute financial returns for the deal card display
    try:
        _price_num = float(search_meta.get("price") or 0)
        _cost_num  = float(search_meta.get("cost") or 0)
        _total_units_num = int(float(search_meta.get("totalUnits") or 0))

        _res_annual = sum(
            float(s.get("avg_rent") or 0) * int(float(s.get("units") or 0)) * 12
            for s in comp_summary
            if s.get("avg_rent") and s.get("units")
        )
        _com_annual = sum(
            float(s.get("sqft") or 0) * float(s.get("rentPerSF") or 0)
            for s in commercial_spaces
            if s.get("sqft") and s.get("rentPerSF")
        )
        _total_annual = _res_annual + _com_annual

        deal_results = (
            compute_returns(_total_annual, _total_units_num, _price_num, _cost_num, assump)
            if (_price_num and _total_annual and _total_units_num)
            else None
        )
    except Exception as _e:
        print(f"  [WARN] Could not compute deal returns: {_e}")
        deal_results = None

    # 3. Populate Excel model
    print(f"  [3] Populating Excel model...")
    short_name = shorten_address(search_meta["address"])
    safe_addr  = short_name.replace("/", "-").replace(":", "")[:60]
    job_dir    = OUTPUT_DIR / f"{search_id} — {safe_addr} — {search_meta['email']}"
    job_dir.mkdir(parents=True, exist_ok=True)

    output_fn = job_dir / f"Ping_{search_id}_Model.xlsx"
    shutil.copy(TEMPLATE_PATH, output_fn)

    wb = load_workbook(output_fn)

    populate_raw_comps(wb["Raw Comps"], all_comp_rows, search_meta)

    # ── CHANGED: pass assump so assumptions are written to Excel ──
    populate_assumptions(wb["Assumptions"], search_meta, combos,
                         comp_summary, commercial_spaces, assump=assump)

    populate_inputs(wb["Inputs"], search_meta, combos, comp_summary,
                    commercial_spaces)

    # ── CHANGED: hide Inputs sheet (legacy, nothing references it) ──
    wb["Inputs"].sheet_state = "hidden"

    wb.save(output_fn)
    print(f"    Excel: {output_fn.name}")

    # 4. Generate Word summary
    print(f"  [4] Generating Word summary...")
    summary_fn = generate_summary_docx(
        job_dir, search_meta, comp_summary, all_comp_rows,
        assumptions=assump,
        commercial_spaces=commercial_spaces,
    )
    print()
    print(generate_summary(search_meta, combos, comp_summary))
    print()

    # 5. Upload files to Supabase Storage
    print(f"  [5] Uploading files to Supabase Storage...")
    excel_storage_path = upload_deal_file(search_id, output_fn)
    print(f"    Excel uploaded: {excel_storage_path}")

    docx_storage_path = None
    if summary_fn and summary_fn.exists():
        docx_storage_path = upload_deal_file(search_id, summary_fn)
        print(f"    Word uploaded: {docx_storage_path}")

    # 6. Insert deal row into Supabase database
    print(f"  [6] Saving deal to database...")
    deal_row = {
        "search_id":    search_id,
        "address":      search_meta["address"],
        "short_address": shorten_address(search_meta["address"]),
        "email":        search_meta["email"],
        "api_key":      search_meta.get("api_key", ""),
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "price":        search_meta.get("price", ""),
        "cost":         search_meta.get("cost", ""),
        "sqft":         search_meta.get("sqft", ""),
        "total_units":  search_meta.get("totalUnits", ""),
        "radius":       str(search_meta.get("radius", "")),
        "deal_stage":   "New",
        "combos":       combos,
        "comp_summary": comp_summary,
        "comp_rows":    all_comp_rows,
        "preset_name":  search_meta.get("preset_name", ""),
        "excel_path":   excel_storage_path,
        "docx_path":    docx_storage_path,
        "results":      deal_results,
        "status":       "complete",

        # ── CHANGED: save the full assumptions used for this deal ──
        "assumptions_snapshot": assump,
    }
    insert_deal(deal_row)

    # 7. Mark done
    processed = load_processed()
    processed.add(search_id)
    save_processed(processed)
    print(f"  \u2705 {search_id} complete.")


# ── Primary entry point (called by server.py) ─────────────────────────────────

def run_pipeline_from_payload(payload: dict) -> None:
    """
    Run the full pipeline from a payload dict POSTed by the Chrome extension.

    Keys: searchId, email, address, lat, lng, price, cost, sqft, radius,
          minComps, maxComps, status, combos, commercial
    """
    print(f"\n{'='*60}")
    print(f"  Ping Pipeline — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    search_id = payload.get("searchId",
                            f"SRCH-{datetime.now().strftime('%Y%m%d')}-ADHOC")
    combos = payload.get("combos", [])
    commercial_spaces = payload.get("commercial") or []
    assump = payload.get("assumptions") or {}

    print(f"\n[Search] {search_id}")

    try:
        try:
            total_units = sum(int(float(c.get("units", 0) or 0)) for c in combos)
        except (ValueError, TypeError):
            total_units = 0

        search_meta = {
            "searchId":   search_id,
            "email":      payload.get("email", ""),
            "api_key":    payload.get("api_key", ""),
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
            "preset_name": payload.get("preset_name", ""),
        }
        _run_search(search_id, search_meta, combos, commercial_spaces,
                    assump=assump)
    except Exception as e:
        print(f"  \u274c Error in {search_id}: {e}")
        traceback.print_exc()
        raise

    print(f"\n{'='*60}")
    print("  Pipeline run complete.")
    print(f"{'='*60}\n")


# ── Legacy entry point (local dev / sheet-based) ──────────────────────────────

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
            base = combo_rows[0]
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
            print(f"  \u274c {search_id}: {e}")
            traceback.print_exc()
            gas_update_status(search_id, "ERROR")

    print(f"\n{'='*60}")
    print("  Pipeline run complete.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    run_pipeline()
