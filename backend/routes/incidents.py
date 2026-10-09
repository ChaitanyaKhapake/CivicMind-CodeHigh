"""CivicMind — incident listing, detail, detection and map data."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import current_user
from database import query, execute
from services import clustering, ai, geo
from services import actions as action_svc

router = APIRouter(prefix="/api", tags=["incidents"])


@router.get("/incidents")
def list_incidents(status: str | None = None, priority: str | None = None,
                   category: str | None = None, ward: str | None = None,
                   q: str | None = None, sort: str = "priority",
                   limit: int = Query(200, le=1000),
                   user: dict = Depends(current_user)):
    sql = "SELECT * FROM incidents WHERE 1=1"
    params = []
    if status:
        sql += " AND status=?"; params.append(status)
    if priority:
        sql += " AND priority_label=?"; params.append(priority)
    if category:
        sql += " AND category=?"; params.append(category)
    if ward:
        sql += " AND ward=?"; params.append(ward)
    if q:
        sql += " AND (title LIKE ? OR public_id LIKE ? OR ward LIKE ?)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    order = {"priority": "priority_score DESC", "recent": "created_at DESC",
             "affected": "affected_people DESC"}.get(sort, "priority_score DESC")
    sql += f" ORDER BY {order} LIMIT ?"; params.append(limit)
    return query(sql, tuple(params))


@router.get("/incidents/{incident_id}")
def incident_detail(incident_id: str, user: dict = Depends(current_user)):
    inc = None
    if incident_id.isdigit():
        inc = query("SELECT * FROM incidents WHERE id=?", (int(incident_id),), one=True)
    if not inc:
        inc = query("SELECT * FROM incidents WHERE public_id=?", (incident_id,), one=True)
    if not inc:
        raise HTTPException(404, "Incident not found")

    inc["investigation"] = _safe_json(inc.get("investigation"))
    inc["complaints"] = query(
        """SELECT c.*, u.name AS citizen_name FROM complaints c
           JOIN incident_complaints ic ON ic.complaint_id=c.id
           LEFT JOIN users u ON u.id=c.user_id
           WHERE ic.incident_id=? ORDER BY c.created_at""", (inc["id"],))
    inc["evidence"] = query("SELECT * FROM evidence WHERE incident_id=? ORDER BY id", (inc["id"],))
    inc["actions"] = query("SELECT * FROM actions WHERE incident_id=? ORDER BY id", (inc["id"],))
    for a in inc["actions"]:
        a["checklist"] = _safe_json(a.get("checklist"), default=[])
        a["proof_check"] = _safe_json(a.get("proof_check"))
    inc["resolution"] = query("SELECT * FROM resolutions WHERE incident_id=? ORDER BY id DESC LIMIT 1",
                              (inc["id"],), one=True)
    if inc["resolution"]:
        inc["resolution"]["proof_check"] = _safe_json(inc["resolution"].get("proof_check"))
        if inc["resolution"].get("resolved_by"):
            off = query("SELECT name FROM users WHERE id=?", (inc["resolution"]["resolved_by"],), one=True)
            inc["resolution"]["officer_name"] = off["name"] if off else None
    inc["timeline"] = query("SELECT * FROM activity WHERE incident_id=? ORDER BY created_at DESC LIMIT 30",
                            (inc["id"],))
    return inc


@router.post("/incidents/detect")
def detect(user: dict = Depends(current_user)):
    if user["role"] not in ("officer", "admin"):
        raise HTTPException(403, "Only officers/admins can run incident detection")
    created = clustering.detect_incidents()
    execute("INSERT INTO activity (actor, action, detail) VALUES (?,?,?)",
            (user["name"], "detection_run", f"Detected {len(created)} new incident(s)"))
    return {"detected": len(created), "incidents": created}


@router.post("/incidents/{incident_id}/investigate")
def investigate(incident_id: int, user: dict = Depends(current_user)):
    inc = query("SELECT * FROM incidents WHERE id=?", (incident_id,), one=True)
    if not inc:
        raise HTTPException(404, "Incident not found")
    members = query("""SELECT * FROM complaints c JOIN incident_complaints ic
                       ON ic.complaint_id=c.id WHERE ic.incident_id=?""", (incident_id,))
    cats = sorted({m["category"] for m in members})
    facts = {"category": inc["category"], "categories": cats, "report_count": inc["report_count"],
             "spread_km": inc["spread_km"], "duration_hours": inc["duration_hours"],
             "ward": inc["ward"], "zone": inc["zone"], "severity": inc["severity"],
             "affected_people": inc["affected_people"], "confidence": inc["confidence"],
             "impact": f"Approx. {inc['affected_people']} citizens affected in {inc['ward']}"}
    inv = ai.investigate_incident(facts)
    execute("UPDATE incidents SET investigation=?, summary=?, probable_cause=?, updated_at=datetime('now') WHERE id=?",
            (json.dumps(inv), inv.get("summary"), inv.get("probable_cause"), incident_id))
    execute("INSERT INTO activity (actor, action, detail, incident_id) VALUES (?,?,?,?)",
            (user["name"], "investigation_run", f"AI investigation re-run ({inv.get('engine')})", incident_id))
    return inv


@router.post("/incidents/{incident_id}/action")
def regenerate_action(incident_id: int, user: dict = Depends(current_user)):
    inc = query("SELECT * FROM incidents WHERE id=?", (incident_id,), one=True)
    if not inc:
        raise HTTPException(404, "Incident not found")
    facts = {"category": inc["category"], "ward": inc["ward"], "report_count": inc["report_count"],
             "affected_people": inc["affected_people"], "priority_label": inc["priority_label"]}
    plan = ai.recommend_action(facts)
    aid = execute("""INSERT INTO actions (incident_id, action_text, assigned_team, department,
                     eta_hours, checklist, status) VALUES (?,?,?,?,?,?, 'pending')""",
                  (incident_id, plan["action_text"], plan.get("assigned_team"),
                   plan.get("department"), plan.get("eta_hours", 24),
                   json.dumps(plan.get("checklist", []))))
    return {"action_id": aid, "plan": plan}


# --- map data --------------------------------------------------------------
@router.get("/map/complaints")
def map_complaints(user: dict = Depends(current_user)):
    return query("""SELECT id, public_id, category, severity, status, latitude, longitude,
                    ward, incident_id, created_at FROM complaints
                    WHERE status != 'rejected' ORDER BY created_at DESC LIMIT 1000""")


@router.get("/map/incidents")
def map_incidents(user: dict = Depends(current_user)):
    rows = query("""SELECT id, public_id, title, category, severity, priority_score,
                    priority_label, affected_people, status, ward, zone, centroid_lat,
                    centroid_lng, spread_km, report_count, confidence FROM incidents""")
    for r in rows:
        r["members"] = query("""SELECT c.latitude, c.longitude, c.category, c.public_id
                                FROM complaints c JOIN incident_complaints ic
                                ON ic.complaint_id=c.id WHERE ic.incident_id=?""", (r["id"],))
    return rows


@router.get("/wards")
def wards():
    return [{"ward": w, "lat": v[0], "lng": v[1], "zone": v[2]} for w, v in geo.WARDS.items()]


def _safe_json(val, default=None):
    if val is None:
        return default
    try:
        return json.loads(val)
    except Exception:
        return default if default is not None else val
