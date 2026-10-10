#!/bin/sh
# CivicMind container start-up.
#   CIVICMIND_SEED_DEMO=1  -> build / refresh the FICTIONAL demo data in $CIVICMIND_DB first (idempotent:
#                             accounts and records are only added when missing). Use with CIVICMIND_ENV=demo.
#   otherwise              -> start on the database as it is (production).
# Platform disks (e.g. Render) are mounted owned by root: when started as root, the data directory is handed
# to the unprivileged "civicmind" user and everything else runs as that user.
set -e
DATA_DIR="$(dirname "${CIVICMIND_DB:-/data/civicmind.db}")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "${CIVICMIND_EVIDENCE_DIR:-/data/evidence}"
  chown -R civicmind:civicmind "$DATA_DIR" "${CIVICMIND_EVIDENCE_DIR:-/data/evidence}"
  exec setpriv --reuid=civicmind --regid=civicmind --init-groups "$0" "$@"
fi

cd /app/backend
if [ "${CIVICMIND_SEED_DEMO:-0}" = "1" ]; then
  if [ "${CIVICMIND_ENV:-}" = "production" ]; then
    echo "CIVICMIND_SEED_DEMO=1 is not allowed with CIVICMIND_ENV=production" >&2
    exit 1
  fi
  python seed_demo.py --db "$CIVICMIND_DB"
fi
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --workers 1 --timeout-keep-alive 30
