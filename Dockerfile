# Ping Analyst backend — Docker image
# ------------------------------------
# Why Docker (vs Render's native Python runtime):
#   The Move 1 Rerun Engine needs LibreOffice headless to recalc workbooks
#   that openpyxl has modified. Render's native Python runtime does NOT allow
#   apt-get installs as a non-root user, so the only path to libreoffice on
#   the dyno is a Docker image.
#
# Image strategy:
#   - python:3.11-slim base (small, well-supported)
#   - apt: libreoffice-calc + libreoffice-core (headless, no GUI deps)
#   - Node 20 for the Frontend build step (carried over from build.sh)
#   - The same gunicorn command from the existing Procfile
#
# Build size: ~700 MB (libreoffice is ~400 MB of that). First build on
# Render takes ~6-8 min; subsequent builds use Docker layer cache and are
# closer to 1-2 min for code-only changes.

FROM python:3.11-slim

# ── System packages ──────────────────────────────────────────────────────────
# libreoffice-calc      → headless recalc of .xlsx files (Move 1 Rerun Engine)
# libreoffice-core      → required runtime libs
# fonts-liberation      → Excel-default-equivalent fonts so layouts don't shift
# curl, ca-certificates → for outbound HTTPS to Supabase
# nodejs, npm           → React Frontend build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-calc \
        libreoffice-core \
        fonts-liberation \
        curl \
        ca-certificates \
        gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Verify LibreOffice is on PATH
RUN which soffice && soffice --version

# ── App ──────────────────────────────────────────────────────────────────────
WORKDIR /app

# Python deps (cached layer — only invalidated when requirements.txt changes)
COPY Pipeline/requirements.txt ./Pipeline/requirements.txt
RUN pip install --no-cache-dir -r Pipeline/requirements.txt

# Frontend build (cached unless package.json changes)
COPY Frontend/package*.json ./Frontend/
RUN cd Frontend && npm install --no-audit --no-fund

# Now copy the rest of the source
COPY Pipeline/ ./Pipeline/
COPY Frontend/ ./Frontend/

# Build the React frontend → Pipeline/static/dist/
RUN cd Frontend && npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
ENV PORT=10000 \
    PYTHONUNBUFFERED=1 \
    SOFFICE_BIN=soffice

EXPOSE 10000

# Run gunicorn the same way the existing Procfile does
CMD ["sh", "-c", "cd Pipeline && gunicorn server:app --bind 0.0.0.0:${PORT} --workers 1 --timeout 300"]
