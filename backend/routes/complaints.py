"""CivicMind — complaint submission, listing, tracking and notifications."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import current_user
from database import query, execute, next_public_id
from services import ai, geo, clustering, evidence, priority
from services import actions as actions_svc

router = APIRouter(prefix="/api", tags=["complaints"])


class ComplaintIn(BaseModel):
    category: str
    description: str
    latitude: float
    longitude: float
    address: str | None = None
    image: str | None = None  # data URL — REQUIRED (proof of the issue)


class ResolveIn(BaseModel):
    notes: str | None = None
    proof: str | None = None       # data URL — REQUIRED (proof of the fix)
    plan: dict | None = None       # optional AI plan the officer accepted/edited
    eta_hours: float | None = None


@router.post("/complaints")
def create_complaint(body: ComplaintIn, user: dict = Depends(current_user)):
    # Only citizens file complaints. Officers resolve incidents; admins oversee.
    if user["role"] != "citizen":
        raise HTTPException(
            status_code=403,
            detail="Only citizens can file complaints. Officers resolve assigned incidents; "
                   "admins oversee the platform.")

    if not body.image:
        raise HTTPException(status_code=400,
                            detail="A photo of the issue is required as proof.")

    area = geo.map_area(body.latitude, body.longitude)
    cls = ai.classify_complaint(body.description, body.category)

    # AI legitimacy check on the citizen's proof photo.
    proof = evidence.verify("issue", body.description, cls["category"], body.image)
    if not proof["ok"]:
        raise HTTPException(status_code=400,
                            detail="The uploaded photo could not be read. Please attach a clear photo.")
    if proof["verdict"] == "flagged":
        raise HTTPException(status_code=422, detail={
            "message": "The AI evidence check flagged this photo.",
            "reasons": proof["reasons"],
            "note": proof["note"],
        })

    public_id = next_public_id("complaints", "CMP")
    cid = execute(
        """INSERT INTO complaints
           (public_id, user_id, category, description, latitude, longitude, address, ward,
            zone, image_path, image_hash, proof_verified, proof_check, status, severity,
            ai_category, ai_confidence, ai_summary, ai_engine)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'submitted', ?,?,?,?,?)""",
        (public_id, user["id"], cls["category"], body.description, body.latitude,
         body.longitude, body.address or (f"{area['ward']}, Pune" if area["ward"] else None),
         area["ward"], area["zone"], proof["image_path"], proof["image_hash"],
         1 if proof["verified"] else 0, json.dumps(proof), cls["severity"],
         cls["category"], cls["confidence"], cls["summary"], cls["engine"]),
    )

    execute("""INSERT INTO notifications (user_id, complaint_id, title, message, type)
               VALUES (?,?,?,?, 'info')""",
            (user["id"], cid, "Complaint received",
             f"Your complaint {public_id} was received, AI-classified as {cls['category']} "
             f"(severity {cls['severity']}/5) and its photo passed the evidence check."))

    # Immediately try to fuse this report with nearby related reports.
    fused = []
    try:
        fused = clustering.detect_incidents()
    except Exception as exc:  # noqa: BLE001
        print(f"[CivicMind] auto-detection skipped: {exc}")

    row = query("SELECT incident_id, status FROM complaints WHERE id=?", (cid,), one=True)

    return {
        "id": cid, "public_id": public_id, "status": row["status"],
        "incident_id": row["incident_id"], "fused_incidents": len(fused),
        "ai": {"category": cls["category"], "severity": cls["severity"],
               "department": cls.get("department"), "confidence": cls["confidence"],
               "summary": cls["summary"], "engine": cls["engine"]},
        "proof": {"verdict": proof["verdict"], "verified": proof["verified"],
                  "confidence": proof["confidence"], "reasons": proof["reasons"],
                  "note": proof["note"], "engine": proof["engine"]},
        "area": area,
    }


@router.get("/complaints")
def list_complaints(
    status: str | None = None, category: str | None = None, ward: str | None = None,
    zone: str | None = None, q: str | None = None, mine: int = 0,
    limit: int = Query(500, le=2000),
    user: dict = Depends(current_user),
):
    sql = "SELECT c.*, u.name AS citizen_name FROM complaints c LEFT JOIN users u ON u.id=c.user_id WHERE 1=1"
    params = []
    if status:
        sql += " AND c.status=?"; params.append(status)
    if category:
        sql += " AND c.category=?"; params.append(category)
    if ward:
        sql += " AND c.ward=?"; params.append(ward)
    if zone:
        sql += " AND c.zone=?"; params.append(zone)
    if q:
        sql += " AND (c.description LIKE ? OR c.public_id LIKE ? OR c.address LIKE ?)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    if mine:
        sql += " AND c.user_id=?"; params.append(user["id"])
    sql += " ORDER BY c.created_at DESC LIMIT ?"; params.append(limit)
    rows = query(sql, tuple(params))
    for r in rows:
        r["proof_check"] = _safe_json(r.get("proof_check"))
    return rows


@router.get("/complaints/{complaint_id}")
def get_complaint(complaint_id: int, user: dict = Depends(current_user)):
    c = query("SELECT * FROM complaints WHERE id=?", (complaint_id,), one=True)
    if not c:
        raise HTTPException(404, "Complaint not found")
    c["proof_check"] = _safe_json(c.get("proof_check"))
    c["resolution_proof_check"] = _safe_json(c.get("resolution_proof_check"))
    return c


@router.get("/complaints/{complaint_id}/plan")
def complaint_plan(complaint_id: int, user: dict = Depends(current_user)):
    """AI-generated resolution plan + estimated time for a single complaint."""
    if user["role"] not in ("officer", "admin"):
        raise HTTPException(403, "Officer or admin role required")
    c = query("SELECT * FROM complaints WHERE id=?", (complaint_id,), one=True)
    if not c:
        raise HTTPException(404, "Complaint not found")
    facts = {
        "category": c["category"], "ward": c["ward"], "zone": c["zone"],
        "description": c["description"], "severity": c["severity"], "report_count": 1,
        "affected_people": priority.estimate_affected(1, 0, c["severity"]),
        "status": c["status"],
    }
    plan = ai.recommend_action(facts)
    plan["eta_label"] = _eta_label(plan.get("eta_hours", 24))
    return plan


@router.post("/complaints/{complaint_id}/resolve")
def resolve_complaint(complaint_id: int, body: ResolveIn = ResolveIn(),
                      user: dict = Depends(current_user)):
    """Officer resolves one complaint directly — a proof-of-resolution photo is
    mandatory and is AI-verified before the complaint is marked solved."""
    if user["role"] not in ("officer", "admin"):
        raise HTTPException(403, "Officer or admin role required to resolve complaints")
    res = actions_svc.resolve_complaint(complaint_id, user["id"], body.notes or "",
                                        body.proof, plan=body.plan, eta_hours=body.eta_hours)
    if res is None:
        raise HTTPException(404, "Complaint not found")
    if res.get("error"):
        raise HTTPException(422, detail=res)
    return res


def _eta_label(hours):
    try:
        h = float(hours)
    except Exception:
        return "—"
    if h < 1:
        return f"{int(h * 60)} minutes"
    if h < 24:
        return f"{h:g} hours"
    d = h / 24
    return f"{d:g} day" + ("s" if d != 1 else "")


@router.get("/track/{public_id}")
def track(public_id: str):
    """Public, no-auth status tracking by complaint ID."""
    c = query("SELECT * FROM complaints WHERE public_id=?", (public_id,), one=True)
    if not c:
        raise HTTPException(404, "No complaint found with that ID")
    incident = None
    if c["incident_id"]:
        incident = query("SELECT public_id, title, status, priority_label, ward FROM incidents WHERE id=?",
                         (c["incident_id"],), one=True)
    return {
        "complaint": {k: c[k] for k in ("public_id", "category", "description", "status",
                                        "ward", "severity", "ai_category", "ai_summary",
                                        "created_at", "updated_at")},
        "incident": incident,
    }


# --- notifications ---------------------------------------------------------
@router.get("/notifications")
def notifications(unread: int = 0, user: dict = Depends(current_user)):
    sql = "SELECT * FROM notifications WHERE user_id=?"
    if unread:
        sql += " AND is_read=0"
    sql += " ORDER BY created_at DESC LIMIT 100"
    rows = query(sql, (user["id"],))
    unread_count = query("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0",
                         (user["id"],), one=True)["c"]
    return {"items": rows, "unread": unread_count}


@router.post("/notifications/read")
def mark_read(user: dict = Depends(current_user)):
    execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (user["id"],))
    return {"ok": True}


def _safe_json(val, default=None):
    if val is None:
        return default
    try:
        return json.loads(val)
    except Exception:
        return default if default is not None else val
