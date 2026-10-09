"""CivicMind — dashboard metrics and chart data."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from auth import current_user
from database import query
from services import priority

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def officer_dashboard(user: dict = Depends(current_user)):
    total = query("SELECT COUNT(*) c FROM complaints", one=True)["c"]
    open_complaints = query("SELECT COUNT(*) c FROM complaints WHERE status NOT IN ('resolved','rejected')", one=True)["c"]
    resolved_complaints = query("SELECT COUNT(*) c FROM complaints WHERE status='resolved'", one=True)["c"]
    active = query("SELECT COUNT(*) c FROM incidents WHERE status IN ('active','investigating','action_pending','in_progress','reopened')", one=True)["c"]
    critical = query("SELECT COUNT(*) c FROM incidents WHERE priority_label='Critical' AND status NOT IN ('resolved')", one=True)["c"]
    resolved = query("SELECT COUNT(*) c FROM incidents WHERE status='resolved'", one=True)["c"]
    total_incidents = query("SELECT COUNT(*) c FROM incidents", one=True)["c"]
    # Affected citizens estimate is based on OPEN complaints, so it falls as issues get resolved.
    affected = sum(priority.estimate_affected(1, 0, r["severity"])
                   for r in query("SELECT severity FROM complaints WHERE status NOT IN ('resolved','rejected')"))

    # Average response time: incident creation -> action approval (hours)
    rows = query("""SELECT i.created_at AS ic, a.approved_at AS ap FROM actions a
                    JOIN incidents i ON i.id=a.incident_id WHERE a.approved_at IS NOT NULL""")
    gaps = []
    for r in rows:
        try:
            ic = datetime.fromisoformat(r["ic"]); ap = datetime.fromisoformat(r["ap"])
            gaps.append((ap - ic).total_seconds() / 3600)
        except Exception:
            pass
    avg_response = round(sum(gaps) / len(gaps), 1) if gaps else 0

    # Resolution rate = share of citizen complaints that have been resolved.
    resolution_rate = round(resolved_complaints / total * 100, 1) if total else 0

    # Repeat incident rate: share of incidents whose ward has >1 incident
    ward_counts = query("SELECT ward, COUNT(*) c FROM incidents GROUP BY ward")
    repeated = sum(w["c"] for w in ward_counts if w["c"] > 1)
    repeat_rate = round(repeated / total_incidents * 100, 1) if total_incidents else 0

    queue = query("""SELECT id, public_id, title, category, priority_score, priority_label,
                     affected_people, ward, status, report_count, confidence, created_at
                     FROM incidents WHERE status NOT IN ('resolved')
                     ORDER BY priority_score DESC LIMIT 12""")

    recent = query("""SELECT actor, action, detail, incident_id, created_at FROM activity
                      ORDER BY id DESC LIMIT 15""")

    return {
        "metrics": {
            "total_complaints": total,
            "open_complaints": open_complaints,
            "resolved_complaints": resolved_complaints,
            "active_incidents": active,
            "critical_incidents": critical,
            "resolved_incidents": resolved,
            "affected_citizens": affected,
            "avg_response_hours": avg_response,
            "resolution_rate": resolution_rate,
            "repeat_rate": repeat_rate,
            "total_incidents": total_incidents,
        },
        "recent_reports": _recent_reports(),
        "priority_queue": queue,
        "recent_activity": recent,
        "alerts": [q for q in queue if q["priority_label"] in ("Critical", "High")][:5],
    }


@router.get("/charts")
def charts(user: dict = Depends(current_user)):
    categories = query("""SELECT category, COUNT(*) c FROM complaints GROUP BY category
                          ORDER BY c DESC""")
    statuses = query("SELECT status, COUNT(*) c FROM complaints GROUP BY status")
    priorities = query("SELECT priority_label label, COUNT(*) c FROM incidents GROUP BY priority_label")
    incident_status = query("SELECT status, COUNT(*) c FROM incidents GROUP BY status")
    by_ward = query("SELECT ward, COUNT(*) c FROM complaints GROUP BY ward ORDER BY c DESC LIMIT 10")

    # 7-day trend: complaints created vs incidents resolved
    trend = []
    for i in range(6, -1, -1):
        day = (datetime.utcnow() - timedelta(days=i)).date().isoformat()
        created = query("SELECT COUNT(*) c FROM complaints WHERE date(created_at)=?", (day,), one=True)["c"]
        resolved = query("SELECT COUNT(*) c FROM complaints WHERE date(resolved_at)=?", (day,), one=True)["c"]
        trend.append({"day": day, "created": created, "resolved": resolved})

    return {"categories": categories, "statuses": statuses, "priorities": priorities,
            "incident_status": incident_status, "by_ward": by_ward, "trend": trend}


@router.get("/citizen")
def citizen_dashboard(user: dict = Depends(current_user)):
    mine = query("SELECT COUNT(*) c FROM complaints WHERE user_id=?", (user["id"],), one=True)["c"]
    resolved = query("SELECT COUNT(*) c FROM complaints WHERE user_id=? AND status='resolved'",
                     (user["id"],), one=True)["c"]
    in_progress = query("""SELECT COUNT(*) c FROM complaints WHERE user_id=?
                           AND status IN ('clustered','in_progress')""", (user["id"],), one=True)["c"]
    unread = query("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0",
                   (user["id"],), one=True)["c"]
    # City-wide impact the citizen is part of
    joined = query("""SELECT COUNT(DISTINCT i.id) c FROM incidents i
                      JOIN incident_complaints ic ON ic.incident_id=i.id
                      JOIN complaints c ON c.id=ic.complaint_id WHERE c.user_id=?""",
                   (user["id"],), one=True)["c"]
    return {"my_complaints": mine, "resolved": resolved, "in_progress": in_progress,
            "unread_notifications": unread, "incidents_joined": joined}


def _recent_reports():
    """Latest complaints for the officer dashboard, including resolution info."""
    rows = query("""
        SELECT c.id AS complaint_id, c.public_id, c.category, c.ward, c.status,
               c.severity, c.created_at, c.incident_id, c.proof_verified,
               c.resolved_by, c.resolved_at, c.resolution_proof_check, c.resolution_proof_path,
               u.name AS citizen_name, o.name AS officer_name
        FROM complaints c
        LEFT JOIN users u ON u.id = c.user_id
        LEFT JOIN users o ON o.id = c.resolved_by
        ORDER BY c.created_at DESC LIMIT 25""")
    for r in rows:
        r["resolution_proof_check"] = _safe_json(r.get("resolution_proof_check"))
    return rows


def _safe_json(val, default=None):
    if val is None:
        return default
    try:
        import json
        return json.loads(val)
    except Exception:
        return default if default is not None else val
