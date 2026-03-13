"""
server.py — Ping Pipeline Trigger Server
-----------------------------------------
Accepts a JSON POST from the Chrome extension, validates the user,
generates a searchId, and runs the full underwriting pipeline in a
background thread. No Google Sheets or GAS dependency.

POST /trigger
  Body: { email, address, lat, lng, price, cost, sqft,
          radius, minComps, maxComps, status, combos, commercial }
  → { ok, searchId, status }   or   { ok: false, error }

GET /health → { ok, status: "idle" | "busy" }

Local usage:
    python3 server.py

Railway / external hosting:
    Set environment variable PORT (Railway sets this automatically).
    Server binds to 0.0.0.0 so it's reachable externally.
"""

import logging
import os
import random
import string
import sys
from datetime import datetime
from threading import Lock, Thread

from flask import Flask, jsonify, make_response, request

sys.path.insert(0, __file__.rsplit("/", 1)[0])  # ensure Pipeline dir is on path
from main import run_pipeline_from_payload
from users import ALLOWED_USERS

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

    # Validate email
    email = (payload.get("email") or "").strip().lower()
    if not email:
        return jsonify({"ok": False, "error": "Missing email"}), 400

    if email not in {u.lower() for u in ALLOWED_USERS}:
        log.warning(f"Unauthorized trigger attempt: {email}")
        return jsonify({
            "ok": False,
            "error": "Not authorized. Contact your admin to request access.",
        }), 403

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
    log.info(f"Trigger: {search_id} | {email} | {payload.get('address', '?')}")

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


# ── Entry point ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    log.info(f"Ping Pipeline Server starting on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
