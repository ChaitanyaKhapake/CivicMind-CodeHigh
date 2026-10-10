# CivicMind — production container image
# Build:  docker build -t civicmind .
# Run:    docker run -p 8000:8000 -v civicmind-data:/data --env-file civicmind.env civicmind
#         (civicmind.env holds CIVICMIND_SECRET and optional provider keys — never bake them into the image)
# The SQLite database and private evidence (photos, videos, voice notes) live in /data — mount a volume
# or they are lost when the container is replaced. Run ONE instance (in-process throttles, SQLite).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    CIVICMIND_ENV=production \
    CIVICMIND_DB=/data/civicmind.db \
    CIVICMIND_EVIDENCE_DIR=/data/evidence \
    FORWARDED_ALLOW_IPS=*

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY data/civicmind_config.json ./data/civicmind_config.json
COPY data/osm ./data/osm

RUN rm -rf /app/backend/tests \
 && useradd --create-home --uid 10001 civicmind \
 && mkdir -p /data/evidence && chown -R civicmind /data /app/backend
USER civicmind
VOLUME ["/data"]

WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8000'), timeout=4)" || exit 1
# --proxy-headers + FORWARDED_ALLOW_IPS: trust X-Forwarded-For/Proto from the platform's proxy, so
# throttling sees real client IPs and HTTPS is detected (HSTS). Narrow FORWARDED_ALLOW_IPS to your
# proxy's address if the container port is reachable directly.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --workers 1 --timeout-keep-alive 30"]
