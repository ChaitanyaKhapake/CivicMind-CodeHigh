"""
CivicMind — real-time status stream (Server-Sent Events).

The citizen dashboard subscribes to /api/stream?token=<jwt> and receives live
updates whenever any of their complaints or notifications change — so a
citizen watches their report move from submitted -> clustered -> in_progress
-> resolved in real time, without refreshing.

The client also falls back to polling if SSE is unavailable.
"""
import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from auth import decode_token
from database import query

router = APIRouter(prefix="/api", tags=["realtime"])


def _snapshot(user_id):
    complaints = query(
        """SELECT public_id, status, incident_id, updated_at FROM complaints
           WHERE user_id=? ORDER BY id DESC LIMIT 50""", (user_id,))
    notifs = query(
        """SELECT id, title, message, type, created_at FROM notifications
           WHERE user_id=? ORDER BY id DESC LIMIT 10""", (user_id,))
    return {"complaints": complaints, "notifications": notifs,
            "unread": query("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0",
                            (user_id,), one=True)["c"]}


@router.get("/stream")
async def stream(request: Request, token: str = ""):
    data = decode_token(token)
    if not data:
        async def denied():
            yield "event: error\ndata: {\"detail\":\"unauthorized\"}\n\n"
        return StreamingResponse(denied(), media_type="text/event-stream")

    user_id = data["uid"]

    async def gen():
        last = None
        yield "retry: 4000\n\n"
        for _ in range(300):  # ~10 min max per connection; client reconnects
            if await request.is_disconnected():
                break
            snap = _snapshot(user_id)
            blob = json.dumps(snap, sort_keys=True)
            if blob != last:
                last = blob
                yield f"event: update\ndata: {blob}\n\n"
            else:
                yield ": keep-alive\n\n"
            await asyncio.sleep(3)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
