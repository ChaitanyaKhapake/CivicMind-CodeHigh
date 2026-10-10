"""CivicMind — admin routes. EVERY route here requires the admin role
(reads included), enforced by the router-level dependency."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_admin, create_user, validate_email, validate_password
from config import CATEGORIES, DEPARTMENT_MAP, ROLES, WARDS
from database import query, execute, is_demo_db
from services import bootstrap, evidence
from routes.common import staff_complaint, safe_json

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class UserIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)
    role: str = Field(default="citizen", max_length=10)
    department: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=20)


class ResetIn(BaseModel):
    confirm: str = ""


@router.get("/users")
def users():
    return query("""SELECT id, name, email, role, department, ward, created_at
                    FROM users ORDER BY role, name""")


@router.post("/users")
def add_user(body: UserIn, admin: dict = Depends(require_admin)):
    email = validate_email(body.email)
    validate_password(body.password)
    if body.role not in ROLES:
        raise HTTPException(422, f"Role must be one of: {', '.join(ROLES)}")
    if body.department and body.department not in set(DEPARTMENT_MAP.values()):
        raise HTTPException(422, "Unknown department")
    if body.ward and WARDS and body.ward not in WARDS:
        raise HTTPException(422, "Unknown ward")
    if query("SELECT id FROM users WHERE email=?", (email,), one=True):
        raise HTTPException(409, "Email already exists")
    uid = create_user(body.name, email, body.password, body.role, body.phone, body.department, body.ward)
    execute("INSERT INTO activity (actor, actor_id, action, detail) VALUES (?,?,?,?)",
            (admin["name"], admin["id"], "user_created", f"Created {body.role} account #{uid}"))
    return {"id": uid, "ok": True}


@router.get("/config")
def config():
    return {"categories": CATEGORIES, "departments": sorted(set(DEPARTMENT_MAP.values())),
            "roles": list(ROLES), "wards": sorted(WARDS), "read_only": True,
            "note": "Edit data/civicmind_config.json and restart to change configuration."}


@router.get("/stats")
def stats():
    total = query("SELECT COUNT(*) c FROM complaints WHERE status != 'rejected'", one=True)["c"]
    resolved = query("SELECT COUNT(*) c FROM complaints WHERE status='resolved'", one=True)["c"]
    c = lambda sql: query(sql, one=True)["c"]  # noqa: E731
    return {
        "users": c("SELECT COUNT(*) c FROM users"),
        "complaints": total,
        "open_complaints": c("SELECT COUNT(*) c FROM complaints WHERE status NOT IN ('resolved','rejected')"),
        "resolved_complaints": resolved,
        "incidents": c("SELECT COUNT(*) c FROM incidents"),
        "actions": c("SELECT COUNT(*) c FROM actions"),
        "resolutions": c("SELECT COUNT(*) c FROM resolutions"),
        "assets": c("SELECT COUNT(*) c FROM assets"),
        "open_findings": c("SELECT COUNT(*) c FROM risk_findings WHERE status IN ('open','acknowledged')"),
        "resolution_rate": round(resolved / total * 100, 1) if total else None,
        "demo_database": is_demo_db(),
    }


@router.get("/complaints")
def all_complaints(admin: dict = Depends(require_admin)):
    rows = query("""
        SELECT c.*, u.name AS citizen_name, u.email AS citizen_email, o.name AS officer_name,
               i.public_id AS incident_public_id, i.title AS incident_title, i.status AS incident_status
        FROM complaints c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users o ON o.id = c.resolved_by
        LEFT JOIN incidents i ON i.id = c.incident_id
        ORDER BY c.created_at DESC, c.id DESC LIMIT 500""")
    out = []
    for r in rows:
        inc = {"id": r["incident_id"], "public_id": r["incident_public_id"], "title": r["incident_title"],
               "status": r["incident_status"]} if r["incident_id"] else None
        out.append(staff_complaint(r, admin, inc, None, r.get("officer_name")))
    return out


@router.get("/resolutions")
def all_resolutions():
    incident_res = query("""
        SELECT r.id, r.action_id, 'incident' AS scope, i.public_id AS ref, i.id AS incident_id, i.title,
               i.category, i.ward, r.before_metric, r.after_metric, r.summary, r.status, r.verified_at,
               r.verification_type, r.proof_check, r.proof_path IS NOT NULL AS has_proof, u.name AS officer_name
        FROM resolutions r JOIN incidents i ON i.id = r.incident_id LEFT JOIN users u ON u.id = r.resolved_by
        ORDER BY r.verified_at DESC LIMIT 300""")
    complaint_res = query("""
        SELECT c.id, NULL AS action_id, 'complaint' AS scope, c.public_id AS ref, NULL AS incident_id,
               c.category AS title, c.category, c.ward, NULL AS before_metric, NULL AS after_metric,
               c.resolution_notes AS summary, 'verified' AS status, c.resolved_at AS verified_at,
               'single_complaint' AS verification_type, c.resolution_proof_check AS proof_check,
               c.resolution_proof_path IS NOT NULL AS has_proof, u.name AS officer_name
        FROM complaints c LEFT JOIN users u ON u.id = c.resolved_by
        WHERE c.resolution_proof_path IS NOT NULL ORDER BY c.resolved_at DESC LIMIT 300""")
    rows = incident_res + complaint_res
    for r in rows:
        r["proof_check"] = evidence.public_check(safe_json(r.get("proof_check")))
    rows.sort(key=lambda r: r.get("verified_at") or "", reverse=True)
    return rows


@router.get("/activity")
def activity(limit: int = 100):
    """Audit trail: who did what, newest first (no secrets are ever written to it)."""
    limit = max(1, min(500, limit))
    return query("""SELECT a.id, a.actor, a.action, a.detail, a.incident_id, a.created_at, i.public_id AS incident_public_id
                    FROM activity a LEFT JOIN incidents i ON i.id = a.incident_id
                    ORDER BY a.id DESC LIMIT ?""", (limit,))


@router.post("/reset")
def reset(body: ResetIn, admin: dict = Depends(require_admin)):
    """Clear civic data on the ISOLATED DEMO DATABASE only (users and assets kept)."""
    if body.confirm != "RESET":
        raise HTTPException(422, "Type RESET to confirm.")
    try:
        return bootstrap.reset_data()
    except PermissionError as e:
        raise HTTPException(403, str(e))
