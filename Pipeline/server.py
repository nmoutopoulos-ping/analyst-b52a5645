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

from flask import Flask, jsonify, make_response, request, send_from_directory, session

sys.path.insert(0, __file__.rsplit("/", 1)[0])  # ensure Pipeline dir is on path
from main import run_pipeline_from_payload
import assumptions

# ── User registry (loaded from users.json) ───────────────────────────────────────
_USERS_FILE = Path(__file__).parent / "users.json"

def _load_users() -> dict:
    """Load users.json. Returns empty dict if file is missing or malformed."""
    try:
        return json.loads(_USERS_FILE.read_text())
    except Exception as e:
        print(f"[WARN] Could not load users.json: {e}", file=sys.stderr)
        return {}

def _save_users(users: dict) -> None:
    """Persist the in-memory USERS dict back to users.json."""
    _USERS_FILE.write_text(json.dumps(users, indent=2) + "\n")

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

@app.route("/trigger",  methods=["OPTIONS"])
@app.route("/health",   methods=["OPTIONS"])
@app.route("/deals",    methods=["OPTIONS"])
@app.route("/settings", methods=["OPTIONS"])
def preflight():
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

    # Attach the user's saved underwriting assumptions to the payload
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


# ── CRM app ───────────────────────────────────────────────────────────────────────
@app.route("/app")
@app.route("/app/")
def crm_app():
    crm_path = Path(__file__).parent / "crm.html"
    if crm_path.exists():
        return crm_path.read_text(), 200, {"Content-Type": "text/html; charset=utf-8"}
    return "CRM not found", 404


# ── Deals API ─────────────────────────────────────────────────────────────────────
def _get_output_dir():
    from config import OUTPUT_DIR
    return OUTPUT_DIR

@app.route("/deals", methods=["GET"])
def deals():
    """Return list of all completed deals, sorted newest first."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    try:
        output_dir = _get_output_dir()
        deal_list  = []
        if output_dir.exists():
            for job_dir in sorted(output_dir.iterdir(), reverse=True):
                if not job_dir.is_dir():
                    continue
                meta_file = job_dir / "meta.json"
                if meta_file.exists():
                    try:
                        meta = json.loads(meta_file.read_text())
                        deal_list.append(meta)
                    except Exception:
                        pass
        return jsonify({"ok": True, "deals": deal_list}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/deals/<search_id>/download/<filename>", methods=["GET"])
def deal_download(search_id, filename):
    """Serve a deal file (Excel or Word) for download."""
    api_key = request.headers.get("X-Api-Key") or request.args.get("api_key", "")
    if not api_key or api_key not in USERS:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    # Strip any directory components to prevent path traversal attacks
    safe_name = Path(filename).name

    # Only allow known file extensions
    if not (safe_name.endswith(".xlsx") or safe_name.endswith(".docx")):
        return jsonify({"ok": False, "error": "Invalid file type"}), 400

    output_dir = _get_output_dir()
    # Find the job directory that starts with this search_id
    for job_dir in output_dir.iterdir():
        if job_dir.is_dir() and job_dir.name.startswith(search_id):
            target = job_dir / safe_name
            if target.exists():
                return send_from_directory(str(job_dir), safe_name, as_attachment=True)
    return jsonify({"ok": False, "error": "File not found"}), 404


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
    USERS[key] = {"email": email, "name": name}
    _save_users(USERS)
    log.info(f"Admin: added user {name} <{email}> → {key}")
    return jsonify({"ok": True, "key": key, "user": USERS[key]}), 201


@app.route("/admin/users/<key>", methods=["DELETE"])
@_admin_auth
def admin_remove_user(key):
    if key not in USERS:
        return jsonify({"ok": False, "error": "Key not found"}), 404
    user = USERS.pop(key)
    _save_users(USERS)
    log.info(f"Admin: removed user {user['name']} <{user['email']}> key={key}")
    return jsonify({"ok": True, "removed": user}), 200


@app.route("/admin/users/export", methods=["GET"])
@_admin_auth
def admin_export_users():
    """Return users.json content for download / commit to GitHub."""
    return json.dumps(USERS, indent=2) + "\n", 200, {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=users.json",
    }


# ── Entry point ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    log.info(f"Ping Pipeline Server starting on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
