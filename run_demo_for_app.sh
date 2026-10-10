#!/usr/bin/env bash
# CivicMind — DEMO server reachable by the citizen Android app on the same Wi-Fi.
# Same isolated demo database as run_demo.sh, listening on all interfaces and accepting the app's
# origin (https://localhost). Use only on a trusted network; deploy behind HTTPS for real users.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"
export CIVICMIND_DB="$ROOT/data/demo/civicmind_demo.db"
export CIVICMIND_EVIDENCE_DIR="$ROOT/data/demo/evidence"
export CIVICMIND_DEMO_MODE=1
export CIVICMIND_CORS_ORIGINS="https://localhost"
export CIVICMIND_REVERSE_GEOCODER="${CIVICMIND_REVERSE_GEOCODER:-nominatim}"
python3 -m pip install -q -r requirements.txt
python3 seed_demo.py --db "$CIVICMIND_DB"
echo
echo "Server address(es) to enter in the CivicMind app:"
(hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null) | tr ' ' '\n' | sed '/^$/d;s#.*#    http://&:8000#'
echo
exec python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
