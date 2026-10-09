"""CivicMind — admin routes (users, config, data reset)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import current_user, create_user
from database import query
from config import CATEGORIES, DEPARTMENT_MAP
from services import bootstrap

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _admin(user):
    if user["role"] != "admin":
        raise HTTPException(403, "Admin role required")


class UserIn(BaseModel):
    name: str
    email: str
    password: str
    role: str = "citizen"
    department: str | None = None
    ward: str | None = None
    phone: str | None = None


@router.get("/users")
def users(user: dict = Depends(current_user)):
    _admin(user)
    return query("""SELECT id, name, email, role, department, ward, phone, created_at
                    FROM users ORDER BY role, name""")


@router.post("/users")
def add_user(body: UserIn, user: dict = Depends(current_user)):
    _admin(user)
    if query("SELECT id FROM users WHERE email=?", (body.email.lower(),), one=True):
        raise HTTPException(409, "Email already exists")
    uid = create_user(body.name, body.email, body.password, body.role,
                      body.phone, body.department, body.ward)
    return {"id": uid, "ok": True}


@router.get("/config")
def config(user: dict = Depends(current_user)):
    _admin(user)
    return {"categories": CATEGORIES,
            "departments": sorted(set(DEPARTMENT_MAP.values())),
            "roles": ["citizen", "officer", "admin"]}


@router.get("/stats")
def stats(user: dict = Depends(current_user)):
    _admin(user)
    total = query("SELECT COUNT(*) c FROM complaints", one=True)["c"]
    resolved = query("SELECT COUNT(*) c FROM complaints WHERE status='resolved'", one=True)["c"]
    return {
        "users": query("SELECT COUNT(*) c FROM users", one=True)["c"],
        "complaints": total,
        "open_complaints": query("SELECT COUNT(*) c FROM complaints WHERE status NOT IN ('resolved','rejected')", one=True)["c"],
        "resolved_complaints": resolved,
        "incidents": query("SELECT COUNT(*) c FROM incidents", one=True)["c"],
        "actions": query("SELECT COUNT(*) c FROM actions", one=True)["c"],
        "resolutions": query("SELECT COUNT(*) c FROM resolutions", one=True)["c"],
        "resolution_rate": round(resolved / total * 100, 1) if total else 0,
    }


@router.get("/complaints")
def all_complaints(user: dict = Depends(current_user)):
    """Admin oversight: every citizen complaint with its evidence + resolution."""
    rows = query("""
        SELECT c.id, c.public_id, c.category, c.description, c.ward, c.zone, c.status,
               c.severity, c.created_at, c.image_path, c.proof_verified, c.proof_check,
               c.incident_id, c.resolved_at, c.resolution_proof_path, c.resolution_proof_check,
               c.resolution_notes,
               u.name AS citizen_name, u.email AS citizen_email,
               o.name AS officer_name,
               i.public_id AS incident_public_id
        FROM complaints c
        LEFT JOIN users u ON u.id = c.user_id
        LEFT JOIN users o ON o.id = c.resolved_by
        LEFT JOIN incidents i ON i.id = c.incident_id
        ORDER BY c.created_at DESC LIMIT 500""")
    for r in rows:
        r["proof_check"] = _safe_json(r.get("proof_check"))
        r["resolution_proof_check"] = _safe_json(r.get("resolution_proof_check"))
    return rows


@router.get("/resolutions")
def all_resolutions(user: dict = Depends(current_user)):
    """Admin oversight: every resolution — incident-level and direct complaint-level."""
    _admin(user)
    incident_res = query("""
        SELECT r.id, 'incident' AS scope, i.public_id AS ref, i.title AS title,
               i.category, i.ward, r.before_metric, r.after_metric, r.reduction_pct,
               r.resolution_confidence, r.summary, r.status, r.verified_at,
               r.proof_path, r.proof_check, u.name AS officer_name
        FROM resolutions r
        JOIN incidents i ON i.id = r.incident_id
        LEFT JOIN users u ON u.id = r.resolved_by
        ORDER BY r.verified_at DESC LIMIT 300""")
    complaint_res = query("""
        SELECT c.id, 'complaint' AS scope, c.public_id AS ref, c.description AS title,
               c.category, c.ward, NULL AS before_metric, NULL AS after_metric,
               100.0 AS reduction_pct, NULL AS resolution_confidence,
               c.resolution_notes AS summary, 'verified' AS status, c.resolved_at AS verified_at,
               c.resolution_proof_path AS proof_path, c.resolution_proof_check AS proof_check,
               u.name AS officer_name
        FROM complaints c
        LEFT JOIN users u ON u.id = c.resolved_by
        WHERE c.resolved_by IS NOT NULL
        ORDER BY c.resolved_at DESC LIMIT 300""")
    rows = incident_res + complaint_res
    for r in rows:
        r["proof_check"] = _safe_json(r.get("proof_check"))
    rows.sort(key=lambda r: r.get("verified_at") or "", reverse=True)
    return rows


def _safe_json(val, default=None):
    if val is None:
        return default
    try:
        import json
        return json.loads(val)
    except Exception:
        return default if default is not None else val


@router.post("/reset")
def reset(user: dict = Depends(current_user)):
    """Clear all civic data (complaints/incidents) but keep user accounts."""
    _admin(user)
    return bootstrap.reset_data()
