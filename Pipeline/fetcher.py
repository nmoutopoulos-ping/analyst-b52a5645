"""
fetcher.py — Ping Pipeline Data Fetching
------------------------------------------
Handles all inbound data:
  - Google Sheets CSV (new search requests)
  - RentCast API (rental comp listings)
  - GAS webhook (best-effort status updates back to the sheet)
"""

import csv
import io
import math

import requests

from config import (
    GAS_URL, SHEET_ID, SHEET_CSV_URL, HEADER_MAP,
    RC_KEY, RC_BASE,
)
from helpers import load_processed, haversine_km


# ── Google Sheets ──────────────────────────────────────────────────────────────

def fetch_new_searches() -> list:
    """
    Read the Google Sheets 'Saved Searches' tab via public CSV export URL.
    Returns a list of row dicts where Run Status == 'NEW' and the Search ID
    has not been locally processed yet.

    Requirements:
      - Sheet must be shared as 'Anyone with the link can view'.
      - sheet_id must be set in config.json.
    """
    if not SHEET_ID or SHEET_ID == "YOUR_SHEET_ID":
        raise RuntimeError(
            "sheet_id not configured in config.json.\n"
            "  1. Copy your Sheet ID from the URL:\n"
            "     https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit\n"
            "  2. Paste it into Pipeline/config.json under 'sheet_id'.\n"
            "  3. Share the sheet as 'Anyone with the link can view'."
        )

    url = SHEET_CSV_URL.format(sheet_id=SHEET_ID)
    print(f"  Reading sheet: {url[:80]}...")

    r = requests.get(url, timeout=30)
    if r.status_code == 401 or "Sign in" in r.text[:200]:
        raise RuntimeError(
            "Google Sheets returned a login page — sheet is not public.\n"
            "  Share → Anyone with the link → Viewer."
        )
    if r.status_code != 200:
        raise RuntimeError(
            f"Failed to fetch sheet CSV (HTTP {r.status_code}): {r.text[:300]}"
        )

    processed = load_processed()
    rows = []
    for raw in csv.DictReader(io.StringIO(r.text)):
        row = {field: raw.get(header, "").strip()
               for header, field in HEADER_MAP.items()}
        if row.get("runStatus", "").upper() != "NEW":
            continue
        if row.get("searchId", "") in processed:
            continue
        rows.append(row)
    return rows


# ── GAS Status Update ──────────────────────────────────────────────────────────

def gas_update_status(search_id: str, status: str) -> None:
    """
    Best-effort status update via the GAS web app endpoint.
    Silently skips if the endpoint is not configured or returns a non-JSON
    response (e.g. blocked by Workspace admin policy).
    """
    if not GAS_URL or GAS_URL == "YOUR_APPS_SCRIPT_WEB_APP_URL":
        return
    try:
        r = requests.get(
            GAS_URL,
            params={"action": "updateStatus", "searchId": search_id,
                    "status": status},
            timeout=15,
            allow_redirects=True,
        )
        if r.json().get("success"):
            print(f"  [GAS] Status → {status} for {search_id}")
    except Exception as e:
        print(f"  [GAS] Skipped ({e.__class__.__name__}: {str(e)[:80]})")


# ── RentCast ───────────────────────────────────────────────────────────────────

def rentcast_comps(lat: float, lng: float, radius: float,
                   beds, baths, status: str, limit: int) -> list:
    """
    Call the RentCast long-term rental listings endpoint.
    Returns the raw JSON list of listing objects.
    """
    r = requests.get(
        f"{RC_BASE}/listings/rental/long-term",
        headers={"X-Api-Key": RC_KEY},
        params={
            "latitude":  lat,
            "longitude": lng,
            "radius":    radius,
            "bedrooms":  beds,
            "bathrooms": baths,
            "status":    status,
            "limit":     min(int(limit), 500),
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def build_comp_rows(listings: list, subject_lat: float, subject_lng: float,
                    purchase_price, cost, filter_beds, filter_baths,
                    unit_type: str) -> list:
    """
    Convert raw RentCast listing dicts into normalised comp row dicts,
    annotated with distance from the subject property and sorted by proximity.

    CRITICAL: filter_beds and filter_baths are cast to float so that Excel
    AVERAGEIFS criteria comparisons against Raw Comps cols J/K succeed.
    String values silently break the AVERAGEIFS lookup.
    """
    try:
        filter_beds  = float(filter_beds)
        filter_baths = float(filter_baths)
    except (ValueError, TypeError):
        pass

    rows = []
    for listing in listings:
        comp_lat = listing.get("latitude")  or 0
        comp_lng = listing.get("longitude") or 0
        dist_km  = haversine_km(subject_lat, subject_lng, comp_lat, comp_lng)
        rows.append({
            "purchase_price":   purchase_price,
            "improvements":     cost,
            "distance_m":       round(dist_km * 1000, 1),
            "distance_km":      round(dist_km, 3),
            "filter_beds":      filter_beds,
            "filter_baths":     filter_baths,
            "type":             unit_type,
            "formattedAddress": listing.get("formattedAddress", ""),
            "price":            listing.get("price", ""),
            "bedrooms":         listing.get("bedrooms", ""),
            "bathrooms":        listing.get("bathrooms", ""),
            "squareFootage":    listing.get("squareFootage", ""),
            "propertyType":     listing.get("propertyType", ""),
            "listing_status":   listing.get("status", ""),
            "daysOnMarket":     listing.get("daysOnMarket", ""),
            "latitude":         comp_lat,
            "longitude":        comp_lng,
            "url":              listing.get("listingUrl", ""),
            "id":               listing.get("id", ""),
        })

    rows.sort(key=lambda r: r["distance_m"])
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows
