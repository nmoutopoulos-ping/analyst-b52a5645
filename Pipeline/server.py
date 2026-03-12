"""
server.py — Ping Pipeline Trigger Server
-----------------------------------------
A minimal Flask server that can run locally or on an external host (e.g. Render).

The Chrome extension POSTs to /trigger immediately after GAS confirms a
successful search submission. This spawns run_pipeline() in a background
thread so the pipeline starts within seconds of the user clicking
"Run Analysis" — no polling delay.

Local usage:
    python3 server.py

Render / external hosting:
    Set environment variable PORT (Render sets this automatically).
    Server binds to 0.0.0.0 so it's reachable externally.
"""

import logging
import os
import sys
from threading import Lock, Thread

from flask import Flask, jsonify

sys.path.insert(0, __file__.rsplit("/", 1)[0])   # ensure Pipeline dir is on path
from main import run_pipeline

# ── Setup ──────────────────────────────────────────────────────────────────────
app    = Flask(__name__)
_lock  = Lock()

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ping-server")

# Silence Flask's default request logger to keep logs clean
logging.getLogger("werkzeug").setLevel(logging.WARNING)


# ── Trigger endpoint ───────────────────────────────────────────────────────────

@app.route("/trigger", methods=["POST"])
def trigger():
    """
    Called by the Chrome extension immediately after a successful GAS submission.
    Spawns run_pipeline() in a background thread (non-blocking).
    If a pipeline run is already in progress, the new trigger is a no-op —
    processed.json deduplication ensures no double-processing.
    """
    if _lock.locked():
        log.info("Trigger received — pipeline already running, skipping.")
        return jsonify({"ok": True, "status": "already_running"}), 200

    def _run():
        with _lock:
            try:
                log.info("Pipeline triggered — starting run...")
                run_pipeline()
                log.info("Pipeline run complete.")
            except Exception as exc:
                log.error(f"Pipeline error: {exc}", exc_info=True)

    Thread(target=_run, daemon=True).start()
    log.info("Trigger received — pipeline started in background.")
    return jsonify({"ok": True, "status": "started"}), 200


@app.route("/health", methods=["GET"])
def health():
    """Simple health check — lets the extension verify the server is up."""
    status = "busy" if _lock.locked() else "idle"
    return jsonify({"ok": True, "status": status}), 200


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    host = "0.0.0.0"
    log.info(f"Ping Pipeline Server starting on http://{host}:{port}")
    app.run(host=host, port=port, debug=False, use_reloader=False)
