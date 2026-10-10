"""
CivicMind — work orders, contractors and officer verification of completed work.

A work order is the execution layer under an APPROVED response plan (action):

  assigned ──start──> in_progress ──submit (needs an accepted AFTER photo)──> awaiting_verification
                          ^                                                        │
                          └───────────── officer rejects (reason required) ────────┤
                                                                                   └─ officer accepts ─> verified
  assigned | in_progress ──cancel (reason)──> cancelled

Rules (enforced here, never by the UI):
  * one open work order per plan (no contradictory assignments);
  * every transition re-checks the current state in a write-locked transaction;
  * completion evidence is validated content (evidence.process), stored privately,
    and must not be the original issue photo or any earlier photo;
  * acceptance completes the linked plan with that evidence, which runs the
    existing workflow verification (recurrence check) — a photo alone never
    "proves" a physical repair, and the record says so;
  * every change is written to work_order_updates and the activity log;
    nothing is deleted when work is rejected or an incident reopens.
"""
import json
from datetime import datetime, timedelta

from database import query, db, now, insert_with_public_id, parse_ts, utcnow
from services import actions as action_svc, evidence

OPEN = ("assigned", "in_progress", "awaiting_verification")
PRIORITIES = ("low", "medium", "high", "critical")
CITIZEN_EVENTS = {"created": "Work order issued to the responsible team",
                  "started": "Work started on site",
                  "estimate_changed": "Estimated completion updated",
                  "submitted": "Work reported complete — awaiting officer verification",
                  "rejected": "Completion not accepted yet — work continues",
                  "accepted": "Completed work verified by an officer"}


class WorkOrderError(Exception):
    def __init__(self, message, status=409, extra=None):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra or {}


def _clean(v, n):
    v = " ".join(str(v or "").split())
    return v[:n] or None


def _ts(value, field):
    """Accept 'YYYY-MM-DD HH:MM[:SS]' or ISO; store SQLite UTC text."""
    if value in (None, ""):
        return None
    d = parse_ts(str(value))
    if not d:
        raise WorkOrderError(f"{field} must be a date and time (YYYY-MM-DD HH:MM).", 422)
    if not datetime(2000, 1, 1) <= d <= utcnow() + timedelta(days=3650):
        raise WorkOrderError(f"{field} is out of range.", 422)
    return d.strftime("%Y-%m-%d %H:%M:%S")


def _log(conn, wo_id, kind, actor, frm=None, to=None, note=None, old=None, new=None):
    conn.execute("""INSERT INTO work_order_updates (work_order_id, kind, from_status, to_status, note, old_value,
                    new_value, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)""",
                 (wo_id, kind, frm, to, note, old, new, actor["id"], now()))


def _activity(conn, actor, action, detail, incident_id):
    conn.execute("""INSERT INTO activity (actor, actor_id, action, detail, incident_id, created_at)
                    VALUES (?,?,?,?,?,?)""", (actor["name"], actor["id"], action, detail[:300], incident_id, now()))


def _notify(conn, incident_id, title, message):
    for r in conn.execute("SELECT user_id, id FROM complaints WHERE incident_id=?", (incident_id,)).fetchall():
        conn.execute("""INSERT INTO notifications (user_id, complaint_id, incident_id, title, message, type, created_at)
                        VALUES (?,?,?,?,?, 'in_progress', ?)""", (r["user_id"], r["id"], incident_id, title, message, now()))


def _load(conn, wo_id):
    wo = conn.execute("SELECT * FROM work_orders WHERE id=?", (wo_id,)).fetchone()
    if not wo:
        raise WorkOrderError("Work order not found", 404)
    return dict(wo)


def _move(conn, wo, expected, to, extra=None):
    if wo["status"] not in expected:
        raise WorkOrderError(f"This work order is '{wo['status']}'; this step needs it to be "
                             f"{' or '.join(expected)}. Refresh to see the current state.")
    fields = {"status": to, "updated_at": now(), **(extra or {})}
    cols = ", ".join(f"{k}=?" for k in fields)
    cur = conn.execute(f"UPDATE work_orders SET {cols} WHERE id=? AND status=?", (*fields.values(), wo["id"], wo["status"]))
    if cur.rowcount != 1:
        raise WorkOrderError("The work order changed while you were working. Refresh and try again.")


# --------------------------------------------------------------------------- contractors
def contractor_view(c, staff=True):
    if not c:
        return None
    out = {"id": c["id"], "contractor_code": c["contractor_code"], "name": c["name"], "department": c["department"],
           "verification_status": c["verification_status"], "is_synthetic": bool(c["is_synthetic"]),
           "is_active": bool(c["is_active"])}
    if staff:
        out.update({k: c[k] for k in ("contact_person", "contact_role", "phone", "email", "office_address")})
        out["label"] = ("FICTIONAL demo contractor — not a real business" if c["is_synthetic"] else
                        "Verified contractor record" if c["verification_status"] == "verified" else
                        "Unverified contractor record")
    return out


def create_contractor(actor, data):
    name = _clean(data.get("name"), 120)
    code = _clean(data.get("contractor_code"), 32)
    if not name or len(name) < 3:
        raise WorkOrderError("Contractor name is required (3+ characters).", 422)
    if not code or not code.replace("-", "").isalnum():
        raise WorkOrderError("Contractor code must be letters, digits and hyphens.", 422)
    with db(immediate=True) as conn:
        if conn.execute("SELECT 1 FROM contractors WHERE contractor_code=?", (code,)).fetchone():
            raise WorkOrderError("A contractor with that code already exists.", 409)
        cur = conn.execute("""INSERT INTO contractors (contractor_code, name, department, contact_person, contact_role, phone,
                              email, office_address, verification_status, is_synthetic, created_by, created_at)
                              VALUES (?,?,?,?,?,?,?,?, 'unverified', ?,?,?)""",
                           (code, name, _clean(data.get("department"), 120), _clean(data.get("contact_person"), 120),
                            _clean(data.get("contact_role"), 120), _clean(data.get("phone"), 40),
                            _clean(data.get("email"), 120), _clean(data.get("office_address"), 300),
                            1 if data.get("is_synthetic") else 0, actor["id"], now()))
        _activity(conn, actor, "contractor_created", f"Contractor {code} ({name}) registered as unverified", None)
    return contractor_view(query("SELECT * FROM contractors WHERE id=?", (cur.lastrowid,), one=True))


# --------------------------------------------------------------------------- views
def view(wo, staff=True):
    c = query("SELECT * FROM contractors WHERE id=?", (wo["contractor_id"],), one=True) if wo["contractor_id"] else None
    ev = query("SELECT id, kind, check_json, note, created_at FROM work_order_evidence WHERE work_order_id=? ORDER BY id",
               (wo["id"],))
    est = parse_ts(wo["est_completion"])
    overdue = bool(est and wo["status"] in ("assigned", "in_progress") and est < utcnow())
    out = {k: wo[k] for k in ("id", "public_id", "incident_id", "action_id", "department", "team_name", "task",
                              "priority", "status", "est_start", "est_completion", "actual_start",
                              "actual_completion", "required_evidence", "verified_at", "created_at", "updated_at")}
    out.update({"utility_asset_ids": json.loads(wo["utility_asset_ids"] or "[]"), "overdue": overdue,
                "contractor": contractor_view(c, staff),
                "evidence": [{"id": e["id"], "kind": e["kind"], "note": e["note"], "created_at": e["created_at"],
                              "check": evidence.public_check(json.loads(e["check_json"]))} for e in ev]})
    if staff:
        out["verification_note"] = wo["verification_note"]
        out["history"] = query("""SELECT u.kind, u.from_status, u.to_status, u.note, u.old_value, u.new_value,
                                  u.created_at, us.name AS actor FROM work_order_updates u
                                  LEFT JOIN users us ON us.id=u.actor_id WHERE u.work_order_id=? ORDER BY u.id""",
                               (wo["id"],))
    return out


def for_incident(incident_id, staff=True):
    return [view(w, staff) for w in query("SELECT * FROM work_orders WHERE incident_id=? ORDER BY id DESC", (incident_id,))]


def get(wo_id):
    wo = query("SELECT * FROM work_orders WHERE id=?", (wo_id,), one=True)
    return view(wo) if wo else None


# --------------------------------------------------------------------------- transitions
def create(incident_id, actor, data):
    task = _clean(data.get("task"), 400)
    if not task or len(task) < 5:
        raise WorkOrderError("Describe the task (5+ characters).", 422)
    priority = data.get("priority") or "medium"
    if priority not in PRIORITIES:
        raise WorkOrderError("Unknown priority.", 422)
    est_start, est_done = _ts(data.get("est_start"), "Estimated start"), _ts(data.get("est_completion"), "Estimated completion")
    if est_start and est_done and est_done < est_start:
        raise WorkOrderError("Estimated completion is before the estimated start.", 422)
    assets = [str(a)[:64] for a in (data.get("utility_asset_ids") or [])][:10]
    with db(immediate=True) as conn:
        inc = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if not inc:
            raise WorkOrderError("Incident not found", 404)
        if inc["status"] == "resolved":
            raise WorkOrderError("This incident is resolved.")
        action = conn.execute("""SELECT * FROM actions WHERE incident_id=? AND status IN ('approved','in_progress')
                                 ORDER BY id DESC LIMIT 1""", (incident_id,)).fetchone()
        if not action:
            raise WorkOrderError("Approve the response plan before issuing a work order.")
        if conn.execute(f"SELECT 1 FROM work_orders WHERE action_id=? AND status IN {OPEN}", (action["id"],)).fetchone():
            raise WorkOrderError("This plan already has an open work order. Update or cancel it instead.")
        contractor = None
        if data.get("contractor_id"):
            contractor = conn.execute("SELECT * FROM contractors WHERE id=? AND is_active=1",
                                      (int(data["contractor_id"]),)).fetchone()
            if not contractor:
                raise WorkOrderError("Contractor not found or inactive.", 404)
        team = _clean(data.get("team_name"), 120)
        if not contractor and not team:
            raise WorkOrderError("Assign a contractor or name the internal team.", 422)
        for a in assets:
            if not conn.execute("SELECT 1 FROM utility_assets WHERE asset_id=?", (a,)).fetchone():
                raise WorkOrderError(f"Utility asset {a} not found.", 404)
        wo_id, public_id = insert_with_public_id(
            conn, "work_orders", "WO",
            ["incident_id", "action_id", "utility_asset_ids", "department", "contractor_id", "team_name", "task",
             "priority", "status", "est_start", "est_completion", "created_by", "created_at", "updated_at"],
            [incident_id, action["id"], json.dumps(assets), _clean(data.get("department"), 120) or action["department"],
             contractor["id"] if contractor else None, team, task, priority, "assigned", est_start, est_done,
             actor["id"], now(), now()])
        _log(conn, wo_id, "created", actor, None, "assigned",
             f"Assigned to {contractor['name'] if contractor else team}", None, est_done)
        _activity(conn, actor, "wo_created", f"{public_id} issued to {contractor['name'] if contractor else team}"
                  + (f", estimated completion {est_done[:16]} UTC" if est_done else ""), incident_id)
        _notify(conn, incident_id, "Work order issued",
                "A work order was issued for the issue you reported."
                + (f" Scheduled completion: {est_done[:16]} UTC." if est_done else ""))
    return get(wo_id)


def start(wo_id, actor):
    with db(immediate=True) as conn:
        wo = _load(conn, wo_id)
        _move(conn, wo, ("assigned",), "in_progress", {"actual_start": now()})
        action = conn.execute("SELECT status FROM actions WHERE id=?", (wo["action_id"],)).fetchone()
        _log(conn, wo_id, "started", actor, "assigned", "in_progress")
        _activity(conn, actor, "wo_started", f"{wo['public_id']} started", wo["incident_id"])
    if action and action["status"] == "approved":
        try:
            action_svc.start_action(wo["action_id"], actor)
        except action_svc.WorkflowError:
            pass  # the plan may already have been started by another officer
    return get(wo_id)


def progress(wo_id, actor, note, est_completion=None):
    note = _clean(note, 500)
    new_est = _ts(est_completion, "Estimated completion") if est_completion else None
    if not note and not new_est:
        raise WorkOrderError("Add a progress note or a new estimated completion.", 422)
    with db(immediate=True) as conn:
        wo = _load(conn, wo_id)
        if wo["status"] not in ("assigned", "in_progress"):
            raise WorkOrderError(f"Progress can only be recorded on open work (this one is '{wo['status']}').")
        if note:
            _log(conn, wo_id, "progress", actor, note=note)
        if new_est and new_est != wo["est_completion"]:
            conn.execute("UPDATE work_orders SET est_completion=?, updated_at=? WHERE id=?", (new_est, now(), wo_id))
            _log(conn, wo_id, "estimate_changed", actor, note=note, old=wo["est_completion"], new=new_est)
            _activity(conn, actor, "wo_estimate_changed",
                      f"{wo['public_id']} estimated completion changed to {new_est[:16]} UTC", wo["incident_id"])
            _notify(conn, wo["incident_id"], "Estimated completion updated",
                    f"The scheduled completion for the issue you reported is now {new_est[:16]} UTC.")
    return get(wo_id)


def add_evidence(wo_id, actor, kind, photo, note=None):
    if kind not in ("before", "after"):
        raise WorkOrderError("Evidence kind must be before or after.", 422)
    pre = query("SELECT * FROM work_orders WHERE id=?", (wo_id,), one=True)
    if not pre:
        raise WorkOrderError("Work order not found", 404)
    if pre["status"] not in ("assigned", "in_progress"):
        raise WorkOrderError(f"Evidence can only be added to open work (this one is '{pre['status']}').")
    issue_hashes = [r["image_hash"] for r in query(
        "SELECT image_hash FROM complaints WHERE incident_id=? AND image_hash IS NOT NULL", (pre["incident_id"],))]
    try:
        proof = evidence.process(photo, "resolution" if kind == "after" else "before", None,
                                 issue_hashes=issue_hashes if kind == "after" else [])
    except evidence.EvidenceError as e:
        raise WorkOrderError(e.message, e.status) from None
    if proof["verdict"] == "rejected":
        raise WorkOrderError("The photo did not pass the automated checks.", 422, {"reasons": proof["reasons"]})
    try:
        with db(immediate=True) as conn:
            wo = _load(conn, wo_id)
            if wo["status"] not in ("assigned", "in_progress"):
                raise WorkOrderError("The work order changed meanwhile. Refresh.")
            conn.execute("""INSERT INTO work_order_evidence (work_order_id, kind, stored_name, image_hash, check_json,
                            note, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)""",
                         (wo_id, kind, proof["stored_name"], proof["image_hash"],
                          json.dumps({k: v for k, v in proof.items() if k != "stored_name"}), _clean(note, 300),
                          actor["id"], now()))
            _log(conn, wo_id, "evidence", actor, note=f"{kind} photo — {proof['verdict']}")
    except Exception:
        evidence.discard(proof["stored_name"])
        raise
    return get(wo_id)


def submit(wo_id, actor, note=None):
    with db(immediate=True) as conn:
        wo = _load(conn, wo_id)
        if wo["status"] != "in_progress":
            raise WorkOrderError(f"Only work in progress can be submitted (this one is '{wo['status']}').")
        after = conn.execute("""SELECT 1 FROM work_order_evidence WHERE work_order_id=? AND kind='after'""",
                             (wo_id,)).fetchone()
        if not after:
            raise WorkOrderError("Upload at least one 'after' completion photo before submitting the work.", 422)
        _move(conn, wo, ("in_progress",), "awaiting_verification", {"actual_completion": now()})
        _log(conn, wo_id, "submitted", actor, "in_progress", "awaiting_verification", _clean(note, 500))
        _activity(conn, actor, "wo_submitted", f"{wo['public_id']} reported complete; awaiting verification",
                  wo["incident_id"])
    return get(wo_id)


def verify(wo_id, actor, decision, reason=None):
    reason = _clean(reason, 500)
    wo = query("SELECT * FROM work_orders WHERE id=?", (wo_id,), one=True)
    if not wo:
        raise WorkOrderError("Work order not found", 404)
    if wo["status"] != "awaiting_verification":
        raise WorkOrderError(f"Only work awaiting verification can be reviewed (this one is '{wo['status']}').")
    if decision == "reject":
        if not reason or len(reason) < 5:
            raise WorkOrderError("Give a reason for rejecting the completed work (5+ characters).", 422)
        with db(immediate=True) as conn:
            wo = _load(conn, wo_id)
            _move(conn, wo, ("awaiting_verification",), "in_progress",
                  {"actual_completion": None, "verification_note": reason})
            _log(conn, wo_id, "rejected", actor, "awaiting_verification", "in_progress", reason)
            _activity(conn, actor, "wo_rejected", f"{wo['public_id']} completion not accepted: {reason}", wo["incident_id"])
            _notify(conn, wo["incident_id"], "Work continues",
                    "An officer reviewed the completed work and asked the team to continue.")
        return get(wo_id)
    if decision != "accept":
        raise WorkOrderError("Decision must be accept or reject.", 422)
    ev = query("""SELECT * FROM work_order_evidence WHERE work_order_id=? AND kind='after' ORDER BY id DESC LIMIT 1""",
               (wo_id,), one=True)
    if not ev or not evidence.resolve_path(ev["stored_name"]):
        raise WorkOrderError("The completion photo is no longer on file; upload it again.", 409)
    action = query("SELECT status FROM actions WHERE id=?", (wo["action_id"],), one=True)
    if action and action["status"] == "approved":
        action_svc.start_action(wo["action_id"], actor)

    def mark(conn):
        cur = conn.execute("""UPDATE work_orders SET status='verified', verified_by=?, verified_at=?, verification_note=?,
                              updated_at=? WHERE id=? AND status='awaiting_verification'""",
                           (actor["id"], now(), reason, now(), wo_id))
        if cur.rowcount != 1:
            raise action_svc.WorkflowError("The work order changed while you were working. Refresh and try again.")
        _log(conn, wo_id, "accepted", actor, "awaiting_verification", "verified", reason)
        _activity(conn, actor, "wo_accepted", f"{wo['public_id']} completed work accepted by {actor['name']}",
                  wo["incident_id"])

    result = action_svc.complete_action(
        wo["action_id"], actor, f"{wo['public_id']} accepted: {reason or 'completion photo reviewed'}", None,
        accepted_proof={"stored_name": ev["stored_name"], "image_hash": ev["image_hash"], "check": ev["check_json"]},
        on_complete=mark)
    return get(wo_id) | {"incident_outcome": "resolved" if result["status"] == "verified" else "reopened"}


def cancel(wo_id, actor, reason):
    reason = _clean(reason, 300)
    if not reason or len(reason) < 5:
        raise WorkOrderError("Give a reason for cancelling (5+ characters).", 422)
    with db(immediate=True) as conn:
        wo = _load(conn, wo_id)
        _move(conn, wo, ("assigned", "in_progress"), "cancelled", {"verification_note": reason})
        _log(conn, wo_id, "cancelled", actor, wo["status"], "cancelled", reason)
        _activity(conn, actor, "wo_cancelled", f"{wo['public_id']} cancelled: {reason}", wo["incident_id"])
    return get(wo_id)


# --------------------------------------------------------------------------- citizen-facing estimate
def estimate_for_incident(incident):
    """Estimated / scheduled / actual completion with its basis — or an honest 'pending'."""
    if incident is None:
        return {"kind": "pending", "at": None, "basis": "Not yet grouped into an incident."}
    if incident["status"] == "resolved" and incident.get("resolved_at"):
        return {"kind": "actual", "at": incident["resolved_at"], "basis": "Recorded resolution time."}
    wo = query(f"""SELECT est_completion, public_id FROM work_orders WHERE incident_id=? AND status IN {OPEN}
                   AND est_completion IS NOT NULL ORDER BY id DESC LIMIT 1""", (incident["id"],), one=True)
    if wo:
        return {"kind": "scheduled", "at": wo["est_completion"], "basis": "Work-order schedule set by the department."}
    a = query("""SELECT approved_at, eta_hours FROM actions WHERE incident_id=? AND status IN ('approved','in_progress')
                 AND approved_at IS NOT NULL ORDER BY id DESC LIMIT 1""", (incident["id"],), one=True)
    if a and a["eta_hours"]:
        start = parse_ts(a["approved_at"])
        if start:
            return {"kind": "estimated", "at": (start + timedelta(hours=float(a["eta_hours"]))).strftime("%Y-%m-%d %H:%M:%S"),
                    "basis": f"Approved plan's time estimate ({a['eta_hours']:g} h from approval)."}
    return {"kind": "pending", "at": None, "basis": "No schedule has been set yet."}


def overdue_count():
    return query(f"""SELECT COUNT(*) c FROM work_orders WHERE status IN ('assigned','in_progress')
                     AND est_completion IS NOT NULL AND est_completion < ?""", (now(),), one=True)["c"]
