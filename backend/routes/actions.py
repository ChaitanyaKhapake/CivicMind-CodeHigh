"""CivicMind — officer action lifecycle routes."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import current_user
from services import actions as svc

router = APIRouter(prefix="/api", tags=["actions"])


class ApproveIn(BaseModel):
    action_text: str | None = None
    assigned_team: str | None = None
    department: str | None = None
    eta_hours: float | None = None
    checklist: list[str] | None = None


class RejectIn(BaseModel):
    reason: str | None = None


class CompleteIn(BaseModel):
    notes: str | None = None
    proof: str | None = None   # data URL — REQUIRED proof-of-resolution photo


def _officer(user):
    if user["role"] not in ("officer", "admin"):
        raise HTTPException(403, "Officer or admin role required")


@router.post("/actions/{action_id}/approve")
def approve(action_id: int, body: ApproveIn = ApproveIn(), user: dict = Depends(current_user)):
    _officer(user)
    res = svc.approve_action(action_id, user["id"], edits=body.dict(exclude_none=True))
    if not res:
        raise HTTPException(404, "Action not found")
    return res


@router.post("/actions/{action_id}/reject")
def reject(action_id: int, body: RejectIn = RejectIn(), user: dict = Depends(current_user)):
    _officer(user)
    res = svc.reject_action(action_id, user["id"], body.reason or "")
    if not res:
        raise HTTPException(404, "Action not found")
    return res


@router.post("/actions/{action_id}/start")
def start(action_id: int, user: dict = Depends(current_user)):
    _officer(user)
    res = svc.start_action(action_id)
    if not res:
        raise HTTPException(404, "Action not found")
    return res


@router.post("/actions/{action_id}/complete")
def complete(action_id: int, body: CompleteIn = CompleteIn(), user: dict = Depends(current_user)):
    """Complete the work. A proof-of-resolution photo is mandatory and is
    verified by the AI evidence engine before the incident is closed."""
    _officer(user)
    res = svc.complete_action(action_id, user["id"], body.notes or "", body.proof)
    if res is None:
        raise HTTPException(404, "Action not found")
    if isinstance(res, dict) and res.get("error"):
        raise HTTPException(422, detail=res)
    return {"ok": True, "resolution": res}


@router.post("/incidents/{incident_id}/verify")
def verify(incident_id: int, user: dict = Depends(current_user)):
    _officer(user)
    res = svc.verify_incident(incident_id, resolved_by=user["id"],
                              officer_name=user.get("name"))
    if not res:
        raise HTTPException(404, "Incident not found")
    return res
