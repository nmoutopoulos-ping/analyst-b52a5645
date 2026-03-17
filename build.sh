#!/usr/bin/env bash
# Build script for Render
# 1. Install Python deps
# 2. Install Node deps and build the React frontend
set -e

echo "==> Installing Python dependencies"
pip install -r requirements.txt

echo "==> Installing Frontend dependencies"
cd Frontend
npm install
npm run build
cd ..

echo "==> Build complete — React app at Pipeline/static/dist/"
