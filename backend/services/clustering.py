"""
CivicMind — Incident Fusion (complaint clustering).

Turns multiple weak signals (individual complaints) into one explainable
incident. Rule-based and deterministic: two complaints are linked when they
are (a) geographically close, (b) inside the same time window, and
(c) of related categories. Connected components become incidents.

This is the prototype of the DBSCAN approach described in the blueprint —
swap `_build_edges` for scikit-learn DBSCAN later without touching callers.
"""
import json
from datetime import datetime

from config import (CLUSTER_RADIUS_KM, CLUSTER_TIME_WINDOW_HOURS,
                    MIN_CLUSTER_SIZE)
from database import query, execute, next_public_id, db
from services import ai, geo, priority


def _parse(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "").strip())
    except Exception:
        return datetime.utcnow()


def _hours_between(a, b):
    return abs((_parse(a) - _parse(b)).total_seconds()) / 3600.0


def _build_edges(complaints):
    """Adjacency: i-j linked when close in space, time and category."""
    n = len(complaints)
    adj = {i: set() for i in range(n)}
    for i in range(n):
        for j in range(i + 1, n):
            a, b = complaints[i], complaints[j]
            if not ai.categories_related(a["category"], b["category"]):
                continue
            if geo.haversine_km(a["latitude"], a["longitude"],
                                b["latitude"], b["longitude"]) > CLUSTER_RADIUS_KM:
                continue
            if _hours_between(a["created_at"], b["created_at"]) > CLUSTER_TIME_WINDOW_HOURS:
                continue
            adj[i].add(j)
            adj[j].add(i)
    return adj


def _components(adj):
    seen, comps = set(), []
    for start in adj:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in adj[cur]:
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        comps.append(comp)
    return comps


def _dominant_category(members):
    counts = {}
    for m in members:
        counts[m["category"]] = counts.get(m["category"], 0) + 1
    return max(counts, key=counts.get)


def detect_incidents(limit=None):
    """
    Find clusters among complaints not yet attached to an incident and
    materialise them as incidents. Returns the list of created incidents.
    """
    complaints = query(
        """SELECT * FROM complaints
           WHERE incident_id IS NULL AND status NOT IN ('resolved','rejected')
           ORDER BY created_at"""
    )
    if len(complaints) < MIN_CLUSTER_SIZE:
        return []

    adj = _build_edges(complaints)
    comps = [c for c in _components(adj) if len(c) >= MIN_CLUSTER_SIZE]
    # Biggest clusters first
    comps.sort(key=len, reverse=True)

    created = []
    for comp in comps:
        members = [complaints[i] for i in comp]
        incident = _create_incident(members)
        created.append(incident)
        if limit and len(created) >= limit:
            break
    return created


def _create_incident(members):
    category = _dominant_category(members)
    points = [(m["latitude"], m["longitude"]) for m in members]
    clat, clng = geo.centroid(points)
    spread = geo.spread_km(points)
    area = geo.map_area(clat, clng)

    times = [_parse(m["created_at"]) for m in members]
    duration = (max(times) - min(times)).total_seconds() / 3600.0
    avg_sev = round(sum(m["severity"] for m in members) / len(members))
    report_count = len(members)
    cats = sorted({m["category"] for m in members})

    prio = priority.compute_priority(
        severity=avg_sev, report_count=report_count, spread_km=spread,
        duration_hours=duration, category=category,
    )

    # confidence grows with cluster size and tightness
    confidence = round(min(0.95, 0.55 + 0.03 * report_count + (0.1 if spread < 1 else 0)), 2)

    facts = {
        "category": category, "categories": cats, "report_count": report_count,
        "spread_km": spread, "duration_hours": round(duration, 1),
        "ward": area["ward"], "zone": area["zone"], "severity": avg_sev,
        "affected_people": prio["affected_people"], "confidence": confidence,
        "priority_score": prio["priority_score"], "priority_label": prio["priority_label"],
        "impact": f"Approx. {prio['affected_people']} citizens potentially affected in {area['ward']}",
    }

    investigation = ai.investigate_incident(facts)
    reason = ai.priority_rationale({**facts, **prio})
    plan = ai.recommend_action(facts)

    title = f"Probable {category} — {area['ward']}"
    public_id = next_public_id("incidents", "INC")

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO incidents
               (public_id, title, type, category, confidence, severity, priority_score,
                priority_label, affected_people, spread_km, duration_hours, status, ward,
                zone, centroid_lat, centroid_lng, report_count, summary, probable_cause,
                priority_reason, investigation)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (public_id, title, category, category, confidence, avg_sev,
             prio["priority_score"], prio["priority_label"], prio["affected_people"],
             spread, round(duration, 1), "active", area["ward"], area["zone"],
             clat, clng, report_count, investigation.get("summary"),
             investigation.get("probable_cause"), reason, json.dumps(investigation)),
        )
        incident_id = cur.lastrowid

        for m in members:
            conn.execute("UPDATE complaints SET incident_id=?, status='clustered', "
                         "updated_at=datetime('now') WHERE id=?", (incident_id, m["id"]))
            conn.execute("INSERT OR IGNORE INTO incident_complaints (incident_id, complaint_id) "
                         "VALUES (?,?)", (incident_id, m["id"]))

        # Evidence rows
        for label, val in [
            ("report_count", f"{report_count} linked reports"),
            ("geographic_spread", f"{spread} km radius"),
            ("time_window", f"{round(duration,1)} hours"),
            ("categories", ", ".join(cats)),
            ("confidence", f"{int(confidence*100)}% incident confidence"),
        ]:
            conn.execute("INSERT INTO evidence (incident_id, evidence_type, value, source) "
                         "VALUES (?,?,?,?)", (incident_id, label, val, "incident-fusion"))

        # Draft (unapproved) response plan
        conn.execute(
            """INSERT INTO actions (incident_id, action_text, assigned_team, department,
                                    eta_hours, checklist, status)
               VALUES (?,?,?,?,?,?, 'pending')""",
            (incident_id, plan["action_text"], plan.get("assigned_team"),
             plan.get("department"), plan.get("eta_hours", 24),
             json.dumps(plan.get("checklist", []))),
        )

        conn.execute("INSERT INTO activity (actor, action, detail, incident_id) "
                     "VALUES (?,?,?,?)",
                     ("CivicMind AI", "incident_detected",
                      f"{public_id}: {title} ({report_count} reports fused)", incident_id))

        # Notify every reporter that their report joined an incident
        for m in members:
            conn.execute(
                """INSERT INTO notifications (user_id, complaint_id, incident_id, title, message, type)
                   VALUES (?,?,?,?,?, 'incident')""",
                (m["user_id"], m["id"], incident_id, "Incident detected",
                 f"Your report {m['public_id']} is part of incident {public_id} "
                 f"({title}). A response team is being assigned."),
            )

    return query("SELECT * FROM incidents WHERE id=?", (incident_id,), one=True)
