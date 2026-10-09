#!/usr/bin/env bash
# CivicMind — DEMO mode with an ISOLATED, FICTIONAL database.
#   database : data/demo/civicmind_demo.db
#   logins   : data/demo/demo_credentials.txt   (generated locally)
#   proof    : data/demo/sample_proof_photo.jpg (for the officer step)
# Your regular backend/civicmind.db is never touched.
# Rebuild from scratch:  ./run_demo.sh --reset
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"
export CIVICMIND_DB="$ROOT/data/demo/civicmind_demo.db"
export CIVICMIND_EVIDENCE_DIR="$ROOT/data/demo/evidence"
export CIVICMIND_DEMO_MODE=1

python3 -m pip install -q -r requirements.txt
python3 seed_demo.py --db "$CIVICMIND_DB" "$@"
echo "→ Demo running on http://localhost:${PORT:-8000} — logins in data/demo/demo_credentials.txt"
exec python3 -m uvicorn main:app --host 127.0.0.1 --port "${PORT:-8000}"
