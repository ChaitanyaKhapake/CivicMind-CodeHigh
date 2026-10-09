#!/usr/bin/env bash
# CivicMind — one-command local run.
# Usage:  ./run.sh          (defaults to port 8000)
#         PORT=8080 ./run.sh
set -e
cd "$(dirname "$0")/backend"

echo "→ Installing dependencies…"
python3 -m pip install -r requirements.txt

echo "→ Starting CivicMind on http://localhost:${PORT:-8000}"
echo "  Demo logins:  citizen@civicmind.in / citizen123"
echo "                officer@civicmind.in / officer123"
echo "                admin@civicmind.in   / admin123"
exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
