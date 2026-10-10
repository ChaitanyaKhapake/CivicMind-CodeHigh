"""
CivicMind — short voice descriptions for complaints.

Pipeline: the browser records up to 15 s and encodes 16-bit PCM WAV (mono,
16 kHz). The server, not the browser, enforces the rules:

  * strict data-URL decoding and a byte limit;
  * a real RIFF/WAVE parse: PCM format 1, 16-bit, 1–2 channels, 8–48 kHz;
  * duration computed from the data chunk and capped at 15 s (+0.5 s slack);
  * private storage under a server-generated name (never served statically);
  * transcription by Sarvam speech-to-text (POST {base}/speech-to-text,
    multipart `file`, `model`, `language_code` — verified against
    docs.sarvam.ai on 2026-10-10). Without a key the result is
    `unavailable`; on error `failed`. Nothing is ever invented.

The transcript is AI output and is stored apart from the citizen's own text.
Retention: unlinked recordings are deleted after VOICE_UNLINKED_TTL_HOURS;
audio of complaints resolved more than VOICE_RETENTION_DAYS ago is deleted
(the transcript stays as part of the record).
"""
import base64
import binascii
import os
import re
import secrets
import struct
import uuid
from datetime import timedelta

import requests

import config
from database import query, db, now, parse_ts, utcnow

LANG_CODES = {"en": "en-IN", "hi": "hi-IN", "mr": "mr-IN"}
_DATA_URL_RE = re.compile(r"^data:audio/(wav|wave|x-wav|vnd\.wave);base64,", re.I)
_NAME_RE = re.compile(r"^voice-[0-9a-f]{32}\.wav$")
DISCLOSURE = ("Your recording is stored privately with your complaint and is only available to you and municipal "
              "staff. It is transcribed by the configured speech service (Sarvam AI) when available. Audio is "
              f"deleted {config.VOICE_RETENTION_DAYS} days after the complaint is resolved; the transcript is kept "
              "with the complaint.")


class VoiceError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, {}


def _voice_dir():
    path = os.path.join(config.EVIDENCE_DIR, "voice")
    os.makedirs(path, exist_ok=True)
    return path


def parse_wav(blob):
    """Return (channels, sample_rate, duration_s). Raises VoiceError for anything that is not plain PCM WAV."""
    if len(blob) < 44 or blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        raise VoiceError("The recording is not a WAV file.", 415)
    pos, fmt, data_len = 12, None, None
    while pos + 8 <= len(blob):
        cid, size = blob[pos:pos + 4], struct.unpack("<I", blob[pos + 4:pos + 8])[0]
        body = blob[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            if len(body) < 16:
                raise VoiceError("The recording header is damaged.")
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            data_len = min(size, len(blob) - pos - 8)
            break
        pos += 8 + size + (size & 1)
    if not fmt or data_len is None:
        raise VoiceError("The recording header is damaged.")
    audio_format, channels, rate, byte_rate, block_align, bits = fmt
    if audio_format != 1 or bits != 16 or channels not in (1, 2) or not 8000 <= rate <= 48000:
        raise VoiceError("Unsupported recording format (16-bit PCM WAV, 8–48 kHz, mono or stereo).", 415)
    if block_align != channels * 2 or byte_rate != rate * block_align:
        raise VoiceError("The recording header is inconsistent.")
    duration = data_len / byte_rate
    if duration < 0.5:
        raise VoiceError("The recording is too short.")
    if duration > config.VOICE_MAX_SECONDS + 0.5:
        raise VoiceError(f"Recordings can be at most {config.VOICE_MAX_SECONDS:g} seconds.")
    return channels, rate, round(duration, 2)


def _decode(data_url):
    if not isinstance(data_url, str):
        raise VoiceError("No recording was provided.")
    m = _DATA_URL_RE.match(data_url[:40])
    if not m:
        raise VoiceError("Upload the recording as WAV audio.", 415)
    payload = data_url[m.end():]
    if len(payload) > config.VOICE_MAX_BYTES * 4 // 3 + 8:
        raise VoiceError("The recording is too large.", 413)
    try:
        blob = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise VoiceError("The recording data is corrupted.") from None
    if len(blob) > config.VOICE_MAX_BYTES:
        raise VoiceError("The recording is too large.", 413)
    return blob


def stt_available():
    return bool(config.SARVAM_API_KEY)


def transcribe(blob, language):
    """Return (status, transcript, detected_language, engine, error_code). Never raises."""
    if not stt_available():
        return "unavailable", None, None, None, "not_configured"
    try:
        resp = requests.post(f"{config.SARVAM_BASE_URL}/speech-to-text",
                             headers={"api-subscription-key": config.SARVAM_API_KEY},
                             files={"file": ("voice.wav", blob, "audio/wav")},
                             data={"model": config.SARVAM_STT_MODEL,
                                   "language_code": LANG_CODES.get(language, "unknown")},
                             timeout=config.SARVAM_STT_TIMEOUT, allow_redirects=False)
        if resp.status_code != 200:
            return "failed", None, None, "sarvam", f"http_{resp.status_code}"
        data = resp.json()
        text = " ".join(str(data.get("transcript") or "").split())[:2000]
        detected = data.get("language_code")
        detected = detected if isinstance(detected, str) and len(detected) <= 12 else None
        if not text:
            return "empty", None, detected, "sarvam", None
        return "transcribed", text, detected, "sarvam", None
    except requests.Timeout:
        return "failed", None, None, "sarvam", "timeout"
    except (requests.RequestException, ValueError):
        return "failed", None, None, "sarvam", "provider_error"


def create(user, data_url, language):
    if language not in LANG_CODES:
        raise VoiceError("Choose English, Hindi or Marathi for the recording.")
    blob = _decode(data_url)
    channels, rate, duration = parse_wav(blob)
    purge()
    status, text, detected, engine, err = transcribe(blob, language)
    name = f"voice-{uuid.uuid4().hex}.wav"
    path = os.path.join(_voice_dir(), name)
    with open(path + ".part", "wb") as fh:
        fh.write(blob)
    os.replace(path + ".part", path)
    token = secrets.token_urlsafe(18)
    try:
        with db() as conn:
            conn.execute("""INSERT INTO voice_recordings (token, user_id, stored_name, mime, duration_s, sample_rate,
                            bytes, language, detected_language, transcript, transcript_status, transcript_engine,
                            error_code, created_at) VALUES (?,?,?, 'audio/wav', ?,?,?,?,?,?,?,?,?,?)""",
                         (token, user["id"], name, duration, rate, len(blob), language, detected, text, status,
                          engine, err, now()))
    except Exception:
        os.remove(path)
        raise
    return {"voice_id": token, "duration_s": duration, "language": language, "detected_language": detected,
            "transcript": text, "transcription_status": status, "engine": engine,
            "message": {"transcribed": "Transcript ready — check and edit it before submitting.",
                        "empty": "No speech was recognised. Type your description instead.",
                        "unavailable": "Speech-to-text is not configured. Your recording is kept; please type the "
                                       "description.",
                        "failed": "Transcription failed. Your recording is kept; please type the description."}[status],
            "disclosure": DISCLOSURE}


def claim(conn, user, token, complaint_id):
    """Link an uploaded recording to a new complaint (same user, unused, recent)."""
    r = conn.execute("SELECT * FROM voice_recordings WHERE token=?", (token,)).fetchone()
    if not r or r["user_id"] != user["id"] or r["complaint_id"] is not None or not r["stored_name"]:
        raise VoiceError("That recording is not available. Record it again.", 409)
    created = parse_ts(r["created_at"])
    if not created or utcnow() - created > timedelta(hours=config.VOICE_UNLINKED_TTL_HOURS):
        raise VoiceError("That recording has expired. Record it again.", 409)
    conn.execute("UPDATE voice_recordings SET complaint_id=?, linked_at=? WHERE id=?", (complaint_id, now(), r["id"]))
    return r["id"]


def resolve_path(stored):
    if not stored or not _NAME_RE.match(stored):
        return None
    base = os.path.realpath(_voice_dir())
    path = os.path.realpath(os.path.join(base, stored))
    return path if path.startswith(base + os.sep) and os.path.isfile(path) else None


def view(row):
    if not row:
        return None
    return {"has_audio": bool(row["stored_name"]), "duration_s": row["duration_s"], "language": row["language"],
            "detected_language": row["detected_language"], "transcript": row["transcript"],
            "transcription_status": row["transcript_status"], "engine": row["transcript_engine"],
            "error_code": row["error_code"], "audio_deleted_at": row["audio_deleted_at"],
            "label": "AI-generated transcript (unedited)"}


def for_complaint(complaint_id):
    return view(query("SELECT * FROM voice_recordings WHERE complaint_id=? ORDER BY id DESC LIMIT 1",
                      (complaint_id,), one=True))


def _delete_audio(conn, row):
    path = resolve_path(row["stored_name"])
    if path:
        try:
            os.remove(path)
        except OSError:
            return
    conn.execute("UPDATE voice_recordings SET stored_name=NULL, audio_deleted_at=? WHERE id=?", (now(), row["id"]))


def purge():
    """Apply the retention policy. Returns the number of audio files removed."""
    removed = 0
    unlinked_cut = (utcnow() - timedelta(hours=config.VOICE_UNLINKED_TTL_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
    resolved_cut = (utcnow() - timedelta(days=config.VOICE_RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    with db() as conn:
        rows = conn.execute("""SELECT v.id, v.stored_name FROM voice_recordings v
                               LEFT JOIN complaints c ON c.id = v.complaint_id
                               WHERE v.stored_name IS NOT NULL AND (
                                 (v.complaint_id IS NULL AND v.created_at < ?) OR
                                 (c.status='resolved' AND c.resolved_at IS NOT NULL AND c.resolved_at < ?))""",
                            (unlinked_cut, resolved_cut)).fetchall()
        for r in rows:
            _delete_audio(conn, r)
            removed += 1
        conn.execute("DELETE FROM voice_recordings WHERE complaint_id IS NULL AND stored_name IS NULL")
    return removed
