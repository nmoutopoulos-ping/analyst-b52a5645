"""
server.py — Ping Pipeline Trigger Server
-----------------------------------------
Accepts a JSON POST from the Chrome extension, validates the user,
generates a searchId, and runs the full underwriting pipeline in a
background thread. No Google Sheets or GAS dependency.

POST /trigger
  Body: { api_key, address, lat, lng, price, cost, sqft,
          radius, minComps, maxComps, status, combos, commercial }
  → { ok, searchId, status }   or   { ok: false, error }

GET /health → { ok, status: "idle" | "busy" }

Local usage:
    python3 server.py

Railway / external hosting:
    Set environment variable PORT (Railway sets this automatically).
    Server binds to 0.0.0.0 so it's reachable externally.
"""

import functools
import json
import logging
import os
import random
import secrets
import string
import sys
from datetime import datetime
from pathlib import Path
from threading import Lock, Thread

from flask import Flask, jsonify, make_response, redirect, request, send_file, session

sys.path.insert(0, __file__.rsplit("/", 1)[0])  # ensure Pipeline dir is on path
from main import run_pipeline_from_payload
import assumptions
from supabase_client import fetch_users_dict, insert_user, delete_user

# ── User registry (loaded from Supabase at startup) ───────────────────────────
# In-memory dict for fast per-request auth lookups.
# All writes go to Supabase so changes survive redeploys.

def _load_users() -> dict:
    """Load users from Supabase. Falls back to users.json for local dev without Supabase."""
    try:
        return fetch_users_dict()
    except Exception as e:
        print(f"[WARN] Could not load users from Supabase: {e} — falling back to users.json", file=sys.stderr)
        try:
            import json as _json
            _f = Path(__file__).parent / "users.json"
            return _json.loads(_f.read_text()) if _f.exists() else {}
        except Exception:
            return {}

def _gen_api_key() -> str:
    chars = string.ascii_uppercase + string.digits
    seg = lambda n: "".join(secrets.choice(chars) for _ in range(n))
    return f"PING-{seg(4)}-{seg(4)}"

USERS: dict = _load_users()

# ── Setup ───────────────────────────────────────────────────────────────────────
app            = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "ping-dev-secret-change-in-prod")
_lock          = Lock()

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ping-server")
logging.getLogger("werkzeug").setLevel(logging.WARNING)


# ── CORS ─────────────────────────────────────────────────────────────────────────
@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/trigger",    methods=["OPTIONS"])
@app.route("/health",     methods=["OPTIONS"])
@app.route("/deals",      methods=["OPTIONS"])
@app.route("/settings",   methods=["OPTIONS"])
@app.route("/deals/<search_id>", methods=["OPTIONS"])
@app.route("/crm/login",  methods=["OPTIONS"])
def preflight():
    return make_response("", 204)

@app.route("/crm/templates", methods=["OPTIONS"])
@app.route("/crm/templates/<template_id>", methods=["OPTIONS"])
@app.route("/crm/analyze", methods=["OPTIONS"])
def crm_templates_preflight():
    return make_response("", 204)


# ── Helpers ──────────────────────────────────────────────────────────────────────
def _gen_search_id() -> str:
    date_str = datetime.now().strftime("%Y%m%d")
    rand = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"SRCH-{date_str}-{rand}"


# ── Routes ───────────────────────────────────────────────────────────────────────
@app.route("/trigger", methods=["POST"])
def trigger():
    payload = request.get_json(force=True, silent=True) or {}

    # Validate API key
    api_key = (payload.get("api_key") or "").strip()
    if not api_key:
        return jsonify({"ok": False, "error": "Missing API key"}), 400

    user = USERS.get(api_key)
    if not user:
        log.warning(f"Unauthorized trigger attempt with key: {api_key[:8]}…")
        return jsonify({
            "ok": False,
            "error": "Invalid API key. Contact your admin to request access.",
        }), 403

    # Resolve email from key — user cannot spoof this
    email = user["email"]
    payload["email"] = email

    # Attach underwriting assumptions: use client-provided preset if present, else load saved user defaults
    if not payload.get("assumptions"):
        payload["assumptions"] = assumptions.load(api_key)

    # Validate required fields
    if not payload.get("address"):
        return jsonify({"ok": False, "error": "Missing address"}), 400
    if not payload.get("combos"):
        return jsonify({"ok": False, "error": "Missing unit mix combos"}), 400

    # Reject if pipeline is already running
    if _lock.locked():
        return jsonify({
            "ok": False,
            "error": "Server is processing another analysis. Try again in a moment.",
        }), 503

    search_id = _gen_search_id()
    payload["searchId"] = search_id
    log.info(f"Trigger: {search_id} | {user['name']} <{email}> | {payload.get('address', '?')}")

    def _run():
        with _lock:
            try:
                log.info(f"[{search_id}] Pipeline starting...")
                run_pipeline_from_payload(payload)
                log.info(f"[{search_id}] Pipeline complete.")
            except Exception as exc:
                log.error(f"[{search_id}] Pipeline error: {exc}", exc_info=True)

    Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True, "searchId": search_id, "status": "started"}), 200


@app.route("/health", methods=["GET"])
def health():
    status = "busy" if _lock.locked() else "idle"
    return jsonify({"ok": True, "status": status}), 200


# ── Settings API ─────────────────────────────────────────────────────────────────
@app.route("/settings", methods=["GET"])
def get_settings():
    """Return the user's current underwriting assumptions."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    return jsonify({"ok": True, "assumptions": assumptions.load(api_key)}), 200


@app.route("/settings", methods=["PATCH"])
def patch_settings():
    """Update one or more underwriting assumptions for the authenticated user."""
    data    = request.get_json(force=True, silent=True) or {}
    api_key = (data.get("api_key") or "").strip() or \
              (request.headers.get("X-Api-Key") or "").strip()
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    merged = assumptions.save(api_key, data)
    log.info(f"Settings updated for {USERS[api_key]['name']}")
    return jsonify({"ok": True, "assumptions": merged}), 200


# ── CRM app (React build takes priority, falls back to legacy crm.html) ───────────
STATIC_DIST = Path(__file__).parent / "static" / "dist"

@app.route("/app")
@app.route("/app/")
@app.route("/app/<path:subpath>")
def crm_app(subpath=""):
    # Serve built React app if available
    if STATIC_DIST.exists():
        # Try to serve an exact file first (JS/CSS assets)
        asset = STATIC_DIST / subpath if subpath else None
        if asset and asset.exists() and asset.is_file():
            return send_file(str(asset))
        # Otherwise serve index.html (React handles routing client-side)
        index = STATIC_DIST / "index.html"
        if index.exists():
            return index.read_text(), 200, {"Content-Type": "text/html; charset=utf-8"}
    # Fallback to legacy crm.html
    crm_path = Path(__file__).parent / "crm.html"
    if crm_path.exists():
        return crm_path.read_text(), 200, {"Content-Type": "text/html; charset=utf-8"}
    return "CRM not found", 404

# Serve Vite static assets (JS/CSS bundles)
@app.route("/assets/<path:filename>")
def vite_assets(filename):
    assets_dir = STATIC_DIST / "assets"
    return send_file(str(assets_dir / filename))


# ── Deals API ─────────────────────────────────────────────────────────────────────
from supabase_client import fetch_deals, get_download_url, update_deal_stage, fetch_deal_by_id

@app.route("/deals", methods=["GET"])
def deals():
    """Return list of all completed deals from Supabase, sorted newest first."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    try:
        deal_list = fetch_deals(api_key=api_key)
        return jsonify({"ok": True, "deals": deal_list}), 200
    except Exception as e:
        log.error(f"Error fetching deals: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500



@app.route("/deals/<search_id>", methods=["GET"])
def deal_detail(search_id):
    """Return a single deal by search_id — avoids loading all deals in DealDetailPage."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    try:
        deal = fetch_deal_by_id(search_id, api_key)
        if not deal:
            return jsonify({"ok": False, "error": "Deal not found"}), 404
        return jsonify({"ok": True, "deal": deal}), 200
    except Exception as e:
        log.error(f"Error fetching deal {search_id}: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/deals/<search_id>/download/<file_type>", methods=["GET"])
def deal_download(search_id, file_type):
    """Return a signed Supabase Storage URL and redirect to file download."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    if file_type not in ("excel", "docx"):
        return jsonify({"ok": False, "error": "Invalid file type. Use 'excel' or 'docx'"}), 400

    try:
        deals_data = fetch_deals(api_key=api_key)
        deal = next((d for d in deals_data if d.get("search_id") == search_id), None)
        if not deal:
            return jsonify({"ok": False, "error": "Deal not found"}), 404

        storage_path = deal.get("excel_path") if file_type == "excel" else deal.get("docx_path")
        if not storage_path:
            return jsonify({"ok": False, "error": "File not available"}), 404

        signed_url = get_download_url(storage_path)
        return redirect(signed_url)
    except Exception as e:
        log.error(f"Error generating download URL: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/deals/<search_id>/stage", methods=["PATCH"])
def patch_deal_stage(search_id):
    """Update the deal stage for a given deal (now server-side, not localStorage)."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    data  = request.get_json(force=True, silent=True) or {}
    stage = data.get("stage", "").strip()
    valid_stages = {"New", "Review", "Offer", "Contract", "Closed", "Pass"}
    if stage not in valid_stages:
        return jsonify({"ok": False, "error": f"Invalid stage. Must be one of: {', '.join(valid_stages)}"}), 400

    try:
        update_deal_stage(search_id, stage)
        log.info(f"Deal {search_id} stage → {stage}")
        return jsonify({"ok": True, "stage": stage}), 200
    except Exception as e:
        log.error(f"Error updating deal stage: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500


# ── CRM Login ────────────────────────────────────────────────────────────────────
@app.route("/crm/login", methods=["POST"])
def crm_login():
    """
    Validate an email + API key pair for CRM sign-in.
    Both must match the same record in users.json.
    Returns the user's name on success so the CRM can personalise the UI.
    """
    data    = request.get_json(force=True, silent=True) or {}
    email   = data.get("email", "").strip().lower()
    api_key = data.get("api_key", "").strip().upper()
    if not email or not api_key:
        return jsonify({"ok": False, "error": "Email and access key are required"}), 400
    user = USERS.get(api_key)
    if not user or user["email"].lower() != email:
        return jsonify({"ok": False, "error": "Email and access key don't match"}), 401
    log.info(f"CRM login: {user['name']} <{email}>")
    return jsonify({"ok": True, "name": user["name"], "email": user["email"]}), 200


# ── Admin ────────────────────────────────────────────────────────────────────────
def _admin_auth(f):
    """Decorator: require active admin session, else return 401."""
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("ping_admin"):
            return jsonify({"ok": False, "error": "Not authenticated"}), 401
        return f(*args, **kwargs)
    return wrapper


@app.route("/admin")
@app.route("/admin/")
def admin_app():
    admin_path = Path(__file__).parent / "admin.html"
    if admin_path.exists():
        return admin_path.read_text(), 200, {"Content-Type": "text/html; charset=utf-8"}
    return "Admin not found", 404


@app.route("/admin/login", methods=["POST"])
def admin_login():
    data     = request.get_json(force=True, silent=True) or {}
    password = data.get("password", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_pw:
        return jsonify({"ok": False, "error": "ADMIN_PASSWORD env var not set"}), 503
    if password != admin_pw:
        log.warning("Admin login failed")
        return jsonify({"ok": False, "error": "Incorrect password"}), 401
    session["ping_admin"] = True
    log.info("Admin login successful")
    return jsonify({"ok": True}), 200


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("ping_admin", None)
    return jsonify({"ok": True}), 200


@app.route("/admin/users", methods=["GET"])
@_admin_auth
def admin_list_users():
    return jsonify({"ok": True, "users": USERS}), 200


@app.route("/admin/users", methods=["POST"])
@_admin_auth
def admin_add_user():
    data  = request.get_json(force=True, silent=True) or {}
    email = data.get("email", "").strip()
    name  = data.get("name", "").strip() or email.split("@")[0]
    if not email:
        return jsonify({"ok": False, "error": "Email is required"}), 400
    # Duplicate email guard
    for k, u in USERS.items():
        if u["email"].lower() == email.lower():
            return jsonify({"ok": False, "error": f"Email already registered (key: {k})"}), 409
    key = _gen_api_key()
    try:
        insert_user(key, email, name)
    except Exception as e:
        log.error(f"Failed to insert user into Supabase: {e}", exc_info=True)
        return jsonify({"ok": False, "error": "Failed to save user"}), 500
    USERS[key] = {"email": email, "name": name}
    log.info(f"Admin: added user {name} <{email}> → {key}")
    return jsonify({"ok": True, "key": key, "user": USERS[key]}), 201


@app.route("/admin/users/<key>", methods=["DELETE"])
@_admin_auth
def admin_remove_user(key):
    if key not in USERS:
        return jsonify({"ok": False, "error": "Key not found"}), 404
    user = USERS[key]
    try:
        delete_user(key)
    except Exception as e:
        log.error(f"Failed to delete user from Supabase: {e}", exc_info=True)
        return jsonify({"ok": False, "error": "Failed to delete user"}), 500
    USERS.pop(key)
    log.info(f"Admin: removed user {user['name']} <{user['email']}> key={key}")
    return jsonify({"ok": True, "removed": user}), 200


# ── Entry point ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    log.info(f"Ping Pipeline Server starting on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


# ── Templates API ─────────────────────────────────────────────────────────────
from supabase_client import fetch_templates, fetch_template_by_id, insert_template, update_template, delete_template

@app.route("/crm/templates", methods=["GET"])
def crm_list_templates():
    api_key = request.args.get("api_key", "").strip()
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    try:
        templates = fetch_templates(api_key)
        return jsonify({"ok": True, "templates": templates}), 200
    except Exception as e:
        log.error(f"Error fetching templates: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/crm/templates", methods=["POST"])
def crm_create_template():
    data = request.get_json(force=True, silent=True) or {}
    api_key = data.pop("api_key", "").strip()
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    user = USERS[api_key]
    data["api_key"] = api_key
    data["email"] = user["email"]
    if "combos" not in data:
        data["combos"] = []
    try:
        template = insert_template(data)
        return jsonify({"ok": True, "template": template, "template_id": template["id"]}), 201
    except Exception as e:
        log.error(f"Error creating template: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/crm/templates/<template_id>", methods=["PATCH"])
def crm_update_template(template_id):
    data = request.get_json(force=True, silent=True) or {}
    api_key = data.pop("api_key", "").strip()
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    try:
        template = update_template(template_id, api_key, data)
        return jsonify({"ok": True, "template": template}), 200
    except Exception as e:
        log.error(f"Error updating template: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/crm/templates/<template_id>", methods=["DELETE"])
def crm_delete_template(template_id):
    api_key = request.args.get("api_key", "").strip()
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    try:
        delete_template(template_id, api_key)
        return jsonify({"ok": True}), 200
    except Exception as e:
        log.error(f"Error deleting template: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/crm/analyze", methods=["POST"])
def crm_analyze():
    """Run the underwriting pipeline from a saved template."""
    data = request.get_json(force=True, silent=True) or {}
    api_key = data.get("api_key", "").strip()
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    template_id = data.get("template_id", "").strip()
    if not template_id:
        return jsonify({"ok": False, "error": "template_id is required"}), 400
    template = fetch_template_by_id(template_id, api_key)
    if not template:
        return jsonify({"ok": False, "error": "Template not found"}), 404
    if _lock.locked():
        return jsonify({"ok": False, "error": "Server is busy. Try again in a moment."}), 503
    user = USERS[api_key]
    search_id = _gen_search_id()
    payload = {
        "api_key": api_key,
        "email": user["email"],
        "searchId": search_id,
        "address": template.get("address", ""),
        "lat": template.get("lat"),
        "lng": template.get("lng"),
        "price": template.get("price"),
        "cost": template.get("improvements"),
        "sqft": template.get("sqft"),
        "radius": template.get("radius", 0.5),
        "minComps": template.get("min_comps"),
        "maxComps": template.get("max_comps"),
        "combos": [
            {
                "beds": c.get("beds", c.get("bed", 0)),
                "baths": c.get("baths", c.get("bath", 0)),
                "units": c.get("units", 1),
                "type": c.get("type", "Apartment"),
            }
            for c in template.get("combos", [])
        ],
        "commercial": template.get("commercial_spaces", []),
        "assumptions": assumptions.load(api_key),
    }
    log.info(f"Analyze: {search_id} | {user['name']} <{user['email']}> | {template.get('address','?')}")
    def _run():
        with _lock:
            try:
                log.info(f"[{search_id}] Pipeline starting from template {template_id}...")
                run_pipeline_from_payload(payload)
                log.info(f"[{search_id}] Pipeline complete.")
            except Exception as exc:
                log.error(f"[{search_id}] Pipeline error: {exc}", exc_info=True)
    Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True, "searchId": search_id, "status": "started"}), 200
