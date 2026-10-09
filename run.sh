#!/usr/bin/env bash
# CivicMind — start with the REGULAR database (backend/civicmind.db).
# For the demo with fictional data use ./run_demo.sh instead.
# Usage:  ./run.sh            (port 8000)   |   PORT=8080 ./run.sh
set -e
cd "$(dirname "$0")/backend"

echo "→ Installing dependencies…"
python3 -m pip install -r requirements.txt

echo "→ Starting CivicMind on http://localhost:${PORT:-8000}"
echo "  No accounts are created automatically. Create an admin once with:"
echo "    python3 manage.py create-user --email you@example.org --name \"Your Name\" --role admin"
exec python3 -m uvicorn main:app --host 127.0.0.1 --port "${PORT:-8000}"
