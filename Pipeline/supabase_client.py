"""
supabase_client.py — Supabase REST client for Ping Analyst
-----------------------------------------------------------
Uses the Supabase HTTP REST API directly via `requests` (no supabase-py package)
so it works reliably on Railway without DNS/package issues.

Provides:
  Storage:
    - upload_deal_file()   → upload Excel/Word to Storage bucket
    - get_download_url()   → signed URL for a stored file (1-hour TTL)

  Deals:
    - insert_deal()        → insert deal row into `deals` table
    - fetch_deals()        → query deals, newest first, optionally filtered by api_key
    - update_deal_stage()  → patch deal_stage on a deal row

  Users:
    - fetch_users_dict()   → return {api_key: {email, name}} for all users
    - insert_user()        → add a new user row
    - delete_user()        → remove a user by api_key

Credentials are read from env vars (Railway) or config.json (local dev).
"""

import json
import os
from pathlib import Path

import requests

# ── Credentials ───────────────────────────────────────────────────────────────

def _get_credentials() -> tuple[str, str]:
    """Return (url, service_role_key) from env vars or config.json."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

    if not url or not key:
        config_path = Path(__file__).parent / "config.json"
        if config_path.exists():
            cfg = json.loads(config_path.read_text())
            url = url or cfg.get("SUPABASE_URL", "").strip()
            key = key or cfg.get("SUPABASE_SERVICE_KEY", "").strip()

    if not url or not key:
        raise RuntimeError(
            "Supabase credentials not found. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, "
            "or add them to config.json."
        )
    return url.rstrip("/"), key


def _headers(key: str, extra: dict | None = None) -> dict:
    h = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
    }
    if extra:
        h.update(extra)
    return h


# ── Storage ───────────────────────────────────────────────────────────────────

BUCKET         = "deal-files"
SIGNED_URL_TTL = 60 * 60  # 1 hour


def upload_deal_file(search_id: str, local_path: Path) -> str:
    """
    Upload a file to Supabase Storage.
    Returns the storage path: "{search_id}/{filename}"
    """
    url, key = _get_credentials()
    storage_path = f"{search_id}/{local_path.name}"
    endpoint = f"{url}/storage/v1/object/{BUCKET}/{storage_path}"

    with open(local_path, "rb") as f:
        data = f.read()

    resp = requests.post(
        endpoint,
        data=data,
        headers={
            "apikey":        key,
            "Authorization": f"Bearer {key}",
            "Content-Type":  "application/octet-stream",
            "x-upsert":      "true",
        },
    )
    resp.raise_for_status()
    return storage_path


def get_download_url(storage_path: str) -> str:
    """Return a signed download URL valid for SIGNED_URL_TTL seconds."""
    url, key = _get_credentials()
    endpoint = f"{url}/storage/v1/object/sign/{BUCKET}/{storage_path}"

    resp = requests.post(
        endpoint,
        json={"expiresIn": SIGNED_URL_TTL},
        headers=_headers(key),
    )
    resp.raise_for_status()
    data = resp.json()

    # Supabase returns a relative path; prepend base URL if needed
    signed = data.get("signedURL", "")
    if signed.startswith("http"):
        return signed
    return f"{url}{signed}"


# ── Database ──────────────────────────────────────────────────────────────────

TABLE = "deals"


def insert_deal(meta: dict) -> None:
    """Insert a completed deal row into the `deals` table."""
    url, key = _get_credentials()
    endpoint = f"{url}/rest/v1/{TABLE}"

    resp = requests.post(
        endpoint,
        json=meta,
        headers=_headers(key, {"Prefer": "return=minimal"}),
    )
    resp.raise_for_status()


# Columns fetched for deal lists — excludes binary blobs (excel_data, docx_data, comp_rows)
DEAL_SELECT = (
    "id,search_id,address,short_address,email,api_key,price,cost,sqft,"
    "total_units,radius,deal_stage,combos,comp_summary,excel_path,docx_path,"
    "status,created_at,preset_name,results,archived"
)

def _to_float(val):
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None

def _to_int(val):
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None

def _normalize_deal(row: dict) -> dict:
    """Reshape a raw DB row to match the frontend Deal type."""
    row["stage"] = row.pop("deal_stage", None) or "New"
    row["search_meta"] = {
        "address": row.get("address", ""),
        "price": _to_float(row.get("price")),
        "listing_price": _to_float(row.get("price")),
        "cost": _to_float(row.get("cost")),
        "sqft": _to_float(row.get("sqft")),
        "total_units": _to_int(row.get("total_units")),
        "radius": _to_float(row.get("radius")),
        "combos": row.get("combos") or [],
    }
    return row

def fetch_deals(api_key: str | None = None) -> list[dict]:
    """
    Return all deals newest first, normalized to match the frontend Deal type.
    Excludes binary blob columns to keep payload small.
    """
    url, key = _get_credentials()
    params: dict = {"select": DEAL_SELECT, "order": "created_at.desc"}
    if api_key:
        params["api_key"] = f"eq.{api_key}"
    resp = requests.get(
        f"{url}/rest/v1/{TABLE}",
        params=params,
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    return [_normalize_deal(row) for row in (resp.json() or [])]

def fetch_deal_by_id(search_id: str, api_key: str | None = None) -> dict | None:
    """Return a single deal by search_id, normalized, or None if not found."""
    url, key = _get_credentials()
    params: dict = {"select": DEAL_SELECT, "search_id": f"eq.{search_id}", "limit": "1"}
    if api_key:
        params["api_key"] = f"eq.{api_key}"
    resp = requests.get(
        f"{url}/rest/v1/{TABLE}",
        params=params,
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    results = resp.json()
    return _normalize_deal(results[0]) if results else None
def update_deal_stage(search_id: str, stage: str) -> None:
    """Update the deal_stage for a given search_id."""
    url, key = _get_credentials()
    endpoint = f"{url}/rest/v1/{TABLE}"

    resp = requests.patch(
        endpoint,
        json={"deal_stage": stage},
        params={"search_id": f"eq.{search_id}"},
        headers=_headers(key, {"Prefer": "return=minimal"}),
    )
    resp.raise_for_status()


# ── Users ─────────────────────────────────────────────────────────────────────

USERS_TABLE = "users"


def fetch_users_dict() -> dict:
    """
    Return all users as {api_key: {email, name}} — same shape as the old users.json.
    Used to populate the in-memory USERS dict at server startup.
    """
    url, key = _get_credentials()
    resp = requests.get(
        f"{url}/rest/v1/{USERS_TABLE}",
        params={"select": "api_key,email,name,extension_password"},
        headers=_headers(key),
    )
    resp.raise_for_status()
    return {u["api_key"]: {"email": u["email"], "name": u["name"], "extension_password": u.get("extension_password")} for u in resp.json()}


def insert_user(api_key: str, email: str, name: str) -> None:
    """Insert a new user row."""
    url, key = _get_credentials()
    resp = requests.post(
        f"{url}/rest/v1/{USERS_TABLE}",
        json={"api_key": api_key, "email": email, "name": name},
        headers=_headers(key, {"Prefer": "return=minimal"}),
    )
    resp.raise_for_status()


def delete_user(api_key: str) -> None:
    """Delete a user by api_key."""
    url, key = _get_credentials()
    resp = requests.delete(
        f"{url}/rest/v1/{USERS_TABLE}",
        params={"api_key": f"eq.{api_key}"},
        headers=_headers(key),
    )
    resp.raise_for_status()




# ── Extension Auth ──────────────────────────────────────────────────────────────

def update_extension_password(api_key: str, password: str) -> None:
    """Set or update the extension_password for a user."""
    url, key = _get_credentials()
    resp = requests.patch(
        f"{url}/rest/v1/{USERS_TABLE}",
        json={"extension_password": password},
        params={"api_key": f"eq.{api_key}"},
        headers=_headers(key, {"Prefer": "return=minimal"}),
    )
    resp.raise_for_status()


def fetch_user_by_email(email: str) -> dict | None:
    """Return a single user row by email (for extension login)."""
    url, key = _get_credentials()
    resp = requests.get(
        f"{url}/rest/v1/{USERS_TABLE}",
        params={
            "select": "api_key,email,name,extension_password",
            "email": f"eq.{email}",
            "limit": "1",
        },
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None

# ── Templates ──────────────────────────────────────────────────────────────────
TEMPLATES_TABLE = "templates"

def fetch_templates(api_key: str) -> list[dict]:
    """Return all templates for a user, newest first."""
    url, key = _get_credentials()
    resp = requests.get(
        f"{url}/rest/v1/{TEMPLATES_TABLE}",
        params={"select": "*", "api_key": f"eq.{api_key}", "order": "created_at.desc"},
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    return resp.json() or []

def fetch_template_by_id(template_id: str, api_key: str) -> dict | None:
    """Return a single template by id, scoped to the user."""
    url, key = _get_credentials()
    resp = requests.get(
        f"{url}/rest/v1/{TEMPLATES_TABLE}",
        params={"select": "*", "id": f"eq.{template_id}", "api_key": f"eq.{api_key}", "limit": "1"},
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    results = resp.json()
    return results[0] if results else None

def insert_template(data: dict) -> dict:
    """Insert a new template row and return it."""
    url, key = _get_credentials()
    resp = requests.post(
        f"{url}/rest/v1/{TEMPLATES_TABLE}",
        json=data,
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    return resp.json()[0]

def update_template(template_id: str, api_key: str, data: dict) -> dict:
    """Update an existing template and return the updated row."""
    url, key = _get_credentials()
    resp = requests.patch(
        f"{url}/rest/v1/{TEMPLATES_TABLE}",
        json=data,
        params={"id": f"eq.{template_id}", "api_key": f"eq.{api_key}"},
        headers=_headers(key, {"Prefer": "return=representation"}),
    )
    resp.raise_for_status()
    results = resp.json()
    return results[0] if results else {}

def delete_template(template_id: str, api_key: str) -> None:
    """Delete a template row."""
    url, key = _get_credentials()
    resp = requests.delete(
        f"{url}/rest/v1/{TEMPLATES_TABLE}",
        params={"id": f"eq.{template_id}", "api_key": f"eq.{api_key}"},
        headers=_headers(key, {"Prefer": "return=minimal"}),
    )
    resp.raise_for_status()
