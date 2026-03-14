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

import json
import logging
import os
import random
import string
import sys
from datetime import datetime
from pathlib import Path
from threading import Lock, Thread

from flask import Flask, jsonify, make_response, request, send_from_directory

sys.path.insert(0, __file__.rsplit("/", 1)[0])  # ensure Pipeline dir is on path
from main import run_pipeline_from_payload
from users import USERS

# ── Setup ───────────────────────────────────────────────────────────────────────
app   = Flask(__name__)
_lock = Lock()

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
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/trigger", methods=["OPTIONS"])
@app.route("/health",  methods=["OPTIONS"])
@app.route("/deals",   methods=["OPTIONS"])
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

    # Safety: only allow known file extensions
    if not (filename.endswith(".xlsx") or filename.endswith(".docx")):
        return jsonify({"ok": False, "error": "Invalid file type"}), 400

    output_dir = _get_output_dir()
    # Find the job directory that starts with this search_id
    for job_dir in output_dir.iterdir():
        if job_dir.is_dir() and job_dir.name.startswith(search_id):
            target = job_dir / filename
            if target.exists():
                return send_from_directory(str(job_dir), filename, as_attachment=True)
    return jsonify({"ok": False, "error": "File not found"}), 404


# ── Entry point ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    log.info(f"Ping Pipeline Server starting on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
