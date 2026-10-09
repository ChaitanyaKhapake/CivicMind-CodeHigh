# CivicMind — container image
# Build:  docker build -t civicmind .
# Run:    docker run -p 8000:8000 -e SARVAM_API_KEY=sk_xxx civicmind
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY . .

WORKDIR /app/backend
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
