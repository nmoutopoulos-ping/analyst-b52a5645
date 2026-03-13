"""
helpers.py — Ping Pipeline Utility Functions
----------------------------------------------
Pure utility functions with no external service dependencies.
Safe to import anywhere without side effects.
"""

import json
import math
from collections import defaultdict
from pathlib import Path

from config import PROCESSED_PATH


# ── Processed-ID tracker ───────────────────────────────────────────────────────

def load_processed() -> set:
    """Load the set of already-processed Search IDs from the local tracker."""
    if PROCESSED_PATH.exists():
        with open(PROCESSED_PATH) as f:
            return set(json.load(f))
    return set()


def save_processed(processed_ids: set) -> None:
    """Persist the set of processed Search IDs to disk."""
    with open(PROCESSED_PATH, "w") as f:
        json.dump(sorted(processed_ids), f, indent=2)


# ── Address formatting ─────────────────────────────────────────────────────────

def shorten_address(address: str) -> str:
    """
    Collapse a verbose Nominatim/RentCast address to 'street, city, state'.
    Strips USA, zip codes, county names, and 'City of' prefixes.
    """
    parts = [p.strip() for p in address.split(",")]
    filtered = []
    for p in parts:
        pl = p.lower().strip()
        if pl in ("united states", "us", "usa"):
            continue
        if p.strip().isdigit():             # zip code
            continue
        if "county" in pl:
            continue
        if "city of" in pl:
            p = p.strip().replace("City of ", "").replace("city of ", "")
        filtered.append(p.strip())
    if len(filtered) <= 3:
        return ", ".join(filtered)
    return f"{filtered[0]}, {filtered[-2]}, {filtered[-1]}"


# ── Geo math ───────────────────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lng points."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


# ── Unit-mix arithmetic ────────────────────────────────────────────────────────

def parse_num(val, as_int=False):
    """Parse a possibly formatted number (commas, $ signs) to float or int.
    Handles values like '2,400,000', '$2,400,000', 2400000, etc.
    Returns 0 on any parse failure or empty input.
    """
    try:
        s = str(val or "").replace("$", "").replace(",", "").strip()
        if not s:
            return 0
        return int(float(s)) if as_int else float(s)
    except (ValueError, TypeError):
        return 0


def unit_counts(total_units, n_combos: int) -> list:
    """Distribute total_units as evenly as possible across n_combos."""
    if n_combos == 0:
        return []
    try:
        total = int(float(total_units))
    except (ValueError, TypeError):
        total = 0
    base, rem = divmod(total, n_combos)
    counts = [base] * n_combos
    for i in range(rem):
        counts[i] += 1
    return counts


def aggregate_rent_assumptions(all_rows: list) -> list:
    """
    Group comp rows by (filter_beds, filter_baths) and compute average rent
    and average square footage per group.

    Returns a list of dicts:
      { beds, baths, count, avg_rent, avg_sqft }

    Keys are normalised to strings so they match the comp_lookup format used
    in excel_writer.populate_inputs().
    """
    groups = defaultdict(list)
    for r in all_rows:
        key = (r["filter_beds"], r["filter_baths"])
        groups[key].append(r)

    summary = []
    for (beds, baths), rows in groups.items():
        prices = [r["price"]        for r in rows if r["price"]]
        sqfts  = [r["squareFootage"] for r in rows if r["squareFootage"]]
        try:
            beds_s  = str(int(float(beds)))
            baths_f = float(baths)
            baths_s = str(int(baths_f)) if baths_f == int(baths_f) else str(baths_f)
        except (ValueError, TypeError):
            beds_s, baths_s = str(beds), str(baths)
        summary.append({
            "beds":     beds_s,
            "baths":    baths_s,
            "count":    len(rows),
            "avg_rent": round(sum(prices) / len(prices), 2) if prices else 0,
            "avg_sqft": round(sum(sqfts)  / len(sqfts),  2) if sqfts  else 0,
        })
    return summary
