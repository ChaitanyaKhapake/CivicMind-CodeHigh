"""
CivicMind — Response execution and Resolution Verification.

Officer workflow: approve / edit / reject a response plan, track execution,
then submit a proof-of-resolution photo which the AI verifies before the
incident can be closed. Every resolution notifies the affected citizens with
the name of the officer who resolved it.
"""
import json
from datetime import datetime

from database import query, execute, db
from services import ai, evidence


# ---------------------------------------------------------------------------
# Action lifecycle
# ---------------------------------------------------------------------------
def approve_action(action_id, officer_id, edits=None):
    action = query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)
    if not action:
        return None
    fields = {"status": "approved", "approved_by": officer_id,
              "approved_at": _now()}
    if edits:
        for k in ("action_text", "assigned_team", "department", "eta_hours"):
            if edits.get(k) is not None:
                fields[k] = edits[k]
        if edits.get("checklist") is not None:
            fields["checklist"] = json.dumps(edits["checklist"])
    _update("actions", fields, action_id)
    _update("incidents", {"status": "in_progress", "updated_at": _now()}, action["incident_id"])
    _log("Officer", "action_approved", f"Action {action_id} approved", action["incident_id"])
    _notify_incident(action["incident_id"], "Action approved",
                     "A response team has been assigned and work is scheduled.", "approved")
    return query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)


def reject_action(action_id, officer_id, reason=""):
    action = query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)
    if not action:
        return None
    _update("actions", {"status": "rejected", "approved_by": officer_id,
                        "notes": reason, "approved_at": _now()}, action_id)
    _log("Officer", "action_rejected", f"Action {action_id} rejected: {reason}",
         action["incident_id"])
    return query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)


def start_action(action_id):
    action = query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)
    if not action:
        return None
    _update("actions", {"status": "in_progress", "started_at": _now()}, action_id)
    _update("incidents", {"status": "in_progress", "updated_at": _now()}, action["incident_id"])
    _log("Field team", "action_started", f"Work started on action {action_id}", action["incident_id"])
    _notify_incident(action["incident_id"], "Work in progress",
                     "The assigned team has started working on your reported issue.", "in_progress")
    return query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)


def complete_action(action_id, officer_id, notes="", proof_image=None):
    """
    Mark work complete. A proof-of-resolution photo is MANDATORY and is
    verified by the AI evidence engine before the incident can be closed.
    Returns {"error": ...} on a rejected proof, else the resolution row.
    """
    action = query("SELECT * FROM actions WHERE id=?", (action_id,), one=True)
    if not action:
        return None
    if not proof_image:
        return {"error": "A proof-of-resolution photo is required to close this incident."}

    officer = query("SELECT id, name FROM users WHERE id=?", (officer_id,), one=True)
    officer_name = officer["name"] if officer else "an officer"

    # Baseline photo hash from the original citizen reports (to stop re-use).
    row = query("""SELECT image_hash FROM complaints
                   WHERE incident_id=? AND image_hash IS NOT NULL LIMIT 1""",
                (action["incident_id"],), one=True)
    issue_hash = row["image_hash"] if row else None

    incident = query("SELECT category, title FROM incidents WHERE id=?",
                     (action["incident_id"],), one=True)
    proof = evidence.verify("resolution",
                            action["action_text"],
                            (incident or {}).get("category", "Other"),
                            proof_image, issue_hash=issue_hash)

    if not proof["ok"]:
        return {"error": "The proof photo could not be read. Please upload a clear photo."}
    if proof["verdict"] == "flagged":
        return {"error": "The AI evidence check rejected the proof photo.",
                "reasons": proof["reasons"], "note": proof["note"]}

    _update("actions", {
        "status": "completed", "completed_at": _now(), "notes": notes,
        "proof_path": proof["image_path"], "proof_check": json.dumps(proof),
        "image_hash": proof["image_hash"],
    }, action_id)
    _log(officer_name, "action_completed",
         f"Work completed and proof submitted for action {action_id}", action["incident_id"])

    return verify_incident(action["incident_id"], resolved_by=officer_id,
                           officer_name=officer_name, proof=proof)


# ---------------------------------------------------------------------------
# Resolution verification
# ---------------------------------------------------------------------------
def verify_incident(incident_id, resolved_by=None, officer_name=None, proof=None):
    inc = query("SELECT * FROM incidents WHERE id=?", (incident_id,), one=True)
    if not inc:
        return None

    before = inc["report_count"] or 0
    after_rows = query(
        """SELECT id FROM complaints
           WHERE ward=? AND created_at > ? AND incident_id IS NULL
             AND status NOT IN ('rejected')""",
        (inc["ward"], inc["updated_at"]),
    )
    after = len(after_rows)
    reduction = 0.0 if not before else round((before - after) / before * 100, 1)

    facts = {"before_metric": before, "after_metric": after,
             "reduction_pct": reduction, "category": inc["category"],
             "ward": inc["ward"], "report_count": before,
             "proof_verified": bool(proof and proof.get("verified")),
             "proof_note": (proof or {}).get("note")}
    verdict = ai.verify_resolution(facts)
    status = "resolved" if verdict.get("verdict") == "resolved" else (
        "reopened" if verdict.get("verdict") == "reopen" else "in_progress")

    with db() as conn:
        conn.execute(
            """INSERT INTO resolutions (incident_id, before_metric, after_metric,
                                        reduction_pct, resolution_confidence, summary,
                                        proof_path, proof_check, image_hash, resolved_by, status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (incident_id, before, after, reduction, verdict.get("confidence", 0.8),
             verdict.get("summary"),
             (proof or {}).get("image_path"), json.dumps(proof) if proof else None,
             (proof or {}).get("image_hash"), resolved_by,
             "reopened" if status == "reopened" else "verified"),
        )
        conn.execute("UPDATE incidents SET status=?, updated_at=? WHERE id=?",
                     (status, _now(), incident_id))
        if status == "resolved":
            conn.execute("UPDATE complaints SET status='resolved', resolved_at=?, resolved_by=?, "
                         "updated_at=? WHERE incident_id=?",
                         (_now(), resolved_by, _now(), incident_id))
        conn.execute("INSERT INTO activity (actor, action, detail, incident_id) "
                     "VALUES (?,?,?,?)",
                     ("Verification Agent", "resolution_verified",
                      f"{inc['public_id']}: {reduction}% reduction, verdict={verdict.get('verdict')}",
                      incident_id))

        # Notify each affected citizen — naming the officer who resolved it.
        people = conn.execute(
            "SELECT DISTINCT user_id, id AS complaint_id, public_id FROM complaints "
            "WHERE incident_id=?", (incident_id,)).fetchall()
        who = officer_name or "the municipal team"
        for p in people:
            if status == "resolved":
                title = "Problem resolved"
                message = (f"Your reported issue {p['public_id']} has been resolved by "
                           f"officer {who}. Thank you for helping improve the city.")
                ntype = "resolved"
            elif status == "reopened":
                title = "Incident reopened"
                message = (f"Officer {who} updated your issue {p['public_id']}, but remaining "
                           f"signals suggest it is not fully resolved. It has been reopened.")
                ntype = "incident"
            else:
                title = "Incident updated"
                message = (f"Officer {who} has updated the status of your issue {p['public_id']}.")
                ntype = "in_progress"
            conn.execute(
                """INSERT INTO notifications (user_id, complaint_id, incident_id, title, message, type)
                   VALUES (?,?,?,?,?,?)""",
                (p["user_id"], p["complaint_id"], incident_id, title, message, ntype))

    return query("SELECT * FROM resolutions WHERE incident_id=? ORDER BY id DESC LIMIT 1",
                 (incident_id,), one=True)


# ---------------------------------------------------------------------------
# Direct resolution of a single complaint (officer acts without needing a fused incident)
# ---------------------------------------------------------------------------
def resolve_complaint(complaint_id, officer_id, notes="", proof_image=None,
                      plan=None, eta_hours=None):
    """
    Officer resolves one complaint directly. A proof-of-resolution photo is
    MANDATORY and is verified by the AI evidence engine before the complaint
    is marked resolved. The citizen is notified, naming the officer.
    Returns {"error": ...} on a rejected proof, else a result dict.
    """
    c = query("SELECT * FROM complaints WHERE id=?", (complaint_id,), one=True)
    if not c:
        return None
    if c["status"] == "resolved":
        return {"error": "This complaint is already resolved."}
    if not proof_image:
        return {"error": "A proof-of-resolution photo is required to mark this issue solved."}

    officer = query("SELECT id, name FROM users WHERE id=?", (officer_id,), one=True)
    officer_name = officer["name"] if officer else "an officer"

    # AI legitimacy check: the proof must be a NEW photo, not the original issue photo.
    proof = evidence.verify("resolution", c["description"], c["category"],
                            proof_image, issue_hash=c.get("image_hash"))
    if not proof["ok"]:
        return {"error": "The proof photo could not be read. Please upload a clear photo."}
    if proof["verdict"] == "flagged":
        return {"error": "The AI evidence check rejected the proof photo.",
                "reasons": proof["reasons"], "note": proof["note"]}

    now = _now()
    with db() as conn:
        conn.execute(
            """UPDATE complaints
               SET status='resolved', resolution_proof_path=?, resolution_proof_check=?,
                   resolution_image_hash=?, resolved_by=?, resolved_at=?, resolution_notes=?,
                   resolution_plan=?, eta_hours=?, updated_at=?
               WHERE id=?""",
            (proof["image_path"], json.dumps(proof), proof["image_hash"],
             officer_id, now, notes, json.dumps(plan) if plan else None,
             eta_hours, now, complaint_id))

        conn.execute(
            """INSERT INTO notifications (user_id, complaint_id, incident_id, title, message, type)
               VALUES (?,?,?,?,?, 'resolved')""",
            (c["user_id"], complaint_id, c["incident_id"], "Problem resolved",
             f"Your reported issue {c['public_id']} has been resolved by officer {officer_name}. "
             "Thank you for helping improve the city."))

        conn.execute("INSERT INTO activity (actor, action, detail, incident_id) VALUES (?,?,?,?)",
                     (officer_name, "complaint_resolved",
                      f"{c['public_id']} resolved with AI-verified proof", c["incident_id"]))

        incident_closed = False
        if c["incident_id"]:
            remaining = conn.execute(
                "SELECT COUNT(*) n FROM complaints WHERE incident_id=? AND status!='resolved'",
                (c["incident_id"],)).fetchone()["n"]
            if remaining == 0:
                incident = conn.execute("SELECT * FROM incidents WHERE id=?",
                                        (c["incident_id"],)).fetchone()
                before = incident["report_count"] if incident else 0
                conn.execute("UPDATE incidents SET status='resolved', updated_at=? WHERE id=?",
                             (now, c["incident_id"]))
                conn.execute(
                    """INSERT INTO resolutions (incident_id, complaint_id, before_metric, after_metric,
                          reduction_pct, resolution_confidence, summary, proof_path, proof_check,
                          image_hash, resolved_by, status)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'verified')""",
                    (c["incident_id"], complaint_id, before, 0, 100.0,
                     proof.get("confidence", 0.8),
                     f"All {before} linked reports resolved by officer {officer_name}; "
                     "resolution proof AI-verified.",
                     proof["image_path"], json.dumps(proof), proof["image_hash"], officer_id))
                incident_closed = True

    return {"complaint_id": complaint_id, "public_id": c["public_id"], "status": "resolved",
            "officer_name": officer_name, "proof": proof, "incident_closed": incident_closed}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _now():
    return datetime.utcnow().isoformat(timespec="seconds")


def _update(table, fields, row_id):
    cols = ", ".join(f"{k}=?" for k in fields)
    execute(f"UPDATE {table} SET {cols} WHERE id=?", (*fields.values(), row_id))


def _log(actor, action, detail, incident_id=None):
    execute("INSERT INTO activity (actor, action, detail, incident_id) VALUES (?,?,?,?)",
            (actor, action, detail, incident_id))


def _notify_incident(incident_id, title, message, ntype):
    rows = query("SELECT DISTINCT user_id, id AS complaint_id FROM complaints WHERE incident_id=?",
                 (incident_id,))
    for r in rows:
        execute("""INSERT INTO notifications (user_id, complaint_id, incident_id, title, message, type)
                   VALUES (?,?,?,?,?,?)""",
                (r["user_id"], r["complaint_id"], incident_id, title, message, ntype))
