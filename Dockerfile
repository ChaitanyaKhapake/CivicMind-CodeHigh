# CivicMind — container image
# Build:  docker build -t civicmind .
# Run:    docker run -p 8000:8000 -v civicmind-data:/data \
#           -e CIVICMIND_SECRET=<long-random> -e SARVAM_API_KEY=<optional> civicmind
# The SQLite database and private evidence live in /data — mount a volume or
# they are lost when the container is replaced.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    CIVICMIND_DB=/data/civicmind.db \
    CIVICMIND_EVIDENCE_DIR=/data/evidence

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY data/civicmind_config.json ./data/civicmind_config.json

RUN useradd --create-home --uid 10001 civicmind \
 && mkdir -p /data/evidence && chown -R civicmind /data /app/backend
USER civicmind
VOLUME ["/data"]

WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
