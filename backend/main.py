"""
CivicMind — FastAPI application entry point.

Run locally:   cd backend && python -m uvicorn main:app --reload --port 8000
Open:          http://localhost:8000
"""
import os
import sys

# Make `from services import ...` work no matter where uvicorn is launched.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from config import FRONTEND_DIR, UPLOAD_DIR, CITY_CENTER, CITY_NAME  # noqa: E402
from database import init_db, query  # noqa: E402
from services import bootstrap, ai  # noqa: E402
from routes import (auth_routes, complaints, incidents, actions,  # noqa: E402
                    dashboard, admin, realtime, config_routes)

app = FastAPI(
    title="CivicMind API",
    description="AI-powered civic incident intelligence — from complaints to incidents.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()
    result = bootstrap.bootstrap()
    print(f"[CivicMind] DB ready. {result}")
    print(f"[CivicMind] AI engine: "
          f"{'Sarvam AI (' + ai.SARVAM_CHAT_MODEL + ')' if ai.ai_available() else 'rule-based fallback — set SARVAM_API_KEY to enable Sarvam AI'}")
    print("[CivicMind] Platform starts empty — dashboards populate from real citizen reports.")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "city": CITY_NAME,
        "center": CITY_CENTER,
        "ai_enabled": ai.ai_available(),
        "ai_model": ai.SARVAM_CHAT_MODEL if ai.ai_available() else None,
        "complaints": query("SELECT COUNT(*) c FROM complaints", one=True)["c"],
        "incidents": query("SELECT COUNT(*) c FROM incidents", one=True)["c"],
    }


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    # Keep the API honest and debuggable.
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# --- API routers -----------------------------------------------------------
app.include_router(config_routes.router)
app.include_router(auth_routes.router)
app.include_router(complaints.router)
app.include_router(incidents.router)
app.include_router(actions.router)
app.include_router(dashboard.router)
app.include_router(admin.router)
app.include_router(realtime.router)

# --- Static assets ---------------------------------------------------------
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Frontend last so /api/* wins.
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
