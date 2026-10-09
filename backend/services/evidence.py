"""
CivicMind — evidence verification.

Every complaint must carry a photo of the issue, and every resolution must
carry a photo of the fix. This module:

  1. saves the image and computes simple forensic metadata (size, resolution,
     brightness variance, SHA-256);
  2. runs deterministic legitimacy checks (blank/uniform image, tiny file,
     low resolution, duplicate/re-used image, proof identical to the issue
     photo);
  3. asks Sarvam AI to reason over the description + the forensic checks and
     return a verdict.

If a vision model is configured (SARVAM_VISION_MODEL) the image itself is
sent to the model; otherwise the verdict combines forensics + AI reasoning.
The result always reports which engine ran, so nothing is over-claimed.

Pillow is used for the image forensics. If it is not installed the module
degrades gracefully: it still saves the file and runs the size + duplicate
checks, and simply skips the pixel-level checks (so a missing dependency can
never take the whole app down).
"""
import base64
import hashlib
import io
import os
import uuid

try:
    from PIL import Image, ImageStat
    _PIL_AVAILABLE = True
except Exception:  # noqa: BLE001
    _PIL_AVAILABLE = False

from config import UPLOAD_DIR, SARVAM_VISION_MODEL
from database import query
from services import ai


# ---------------------------------------------------------------------------
# Save + forensic metadata
# ---------------------------------------------------------------------------
def save_image(data_url: str, prefix="img"):
    """Decode a data URL, write it to uploads/, return (path, meta)."""
    if not data_url:
        return None, None
    try:
        raw = data_url.split(",", 1)[-1]
        blob = base64.b64decode(raw)
    except Exception:
        return None, None
    if len(blob) > 6 * 1024 * 1024:
        return None, None
    name = f"{prefix}-{uuid.uuid4().hex}.jpg"
    path = os.path.join(UPLOAD_DIR, name)
    with open(path, "wb") as f:
        f.write(blob)
    return f"/uploads/{name}", _meta(blob)


def _meta(blob: bytes):
    meta = {"bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
            "analyzed": _PIL_AVAILABLE}
    if not _PIL_AVAILABLE:
        meta["width"] = meta["height"] = 0
        meta["mean"] = meta["std"] = 0
        return meta
    try:
        im = Image.open(io.BytesIO(blob))
        meta["width"], meta["height"] = im.size
        stat = ImageStat.Stat(im.convert("L"))
        meta["mean"] = round(stat.mean[0], 2)
        meta["std"] = round(stat.stddev[0], 2)   # low std => flat / blank image
    except Exception:
        meta["width"] = meta["height"] = 0
        meta["mean"] = meta["std"] = 0
    return meta


# ---------------------------------------------------------------------------
# Deterministic legitimacy checks
# ---------------------------------------------------------------------------
def _forensic_flags(meta, kind, issue_hash=None):
    flags, hard_fail = [], False
    if not meta:
        return ["No image could be read"], True

    # Pixel-level checks (need Pillow).
    if meta.get("analyzed"):
        if meta.get("width", 0) < 200 or meta.get("height", 0) < 200:
            flags.append("Very low resolution — hard to verify")
        if meta.get("std", 0) < 8:
            flags.append("Image looks blank or uniform")
            hard_fail = True

    # Checks that always run.
    if meta.get("bytes", 0) < 8000:
        flags.append("Image file is unusually small")
    if kind == "issue" and _image_seen_before(meta["sha256"]):
        flags.append("This exact image was already submitted before")
        hard_fail = True
    if kind == "resolution" and issue_hash and meta["sha256"] == issue_hash:
        flags.append("Proof photo is identical to the original issue photo")
        hard_fail = True
    return flags, hard_fail


def _image_seen_before(image_hash):
    row = query("SELECT id FROM complaints WHERE image_hash=? LIMIT 1", (image_hash,), one=True)
    if row:
        return True
    row = query("SELECT id FROM resolutions WHERE image_hash=? LIMIT 1", (image_hash,), one=True)
    return bool(row)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def verify(kind, description, category, data_url, issue_hash=None):
    """kind = 'issue' (citizen proof) or 'resolution' (officer proof)."""
    path, meta = save_image(data_url, prefix="proof")
    if not path:
        return {"ok": False, "verdict": "missing", "verified": False, "confidence": 0.0,
                "reasons": ["No proof image was provided."],
                "note": "A photo is required.", "engine": "rules",
                "image_path": None, "image_hash": None}

    flags, hard_fail = _forensic_flags(meta, kind, issue_hash)
    result = ai.verify_evidence(kind, description, category, meta, flags, hard_fail,
                                data_url=data_url if SARVAM_VISION_MODEL else None)

    verified = result.get("verdict") == "verified"
    return {
        "ok": True,
        "verdict": result.get("verdict", "needs_review"),
        "verified": verified,
        "confidence": result.get("confidence", 0.5),
        "reasons": result.get("reasons", flags),
        "note": result.get("note", ""),
        "engine": result.get("engine", "rules"),
        "image_path": path,
        "image_hash": meta["sha256"],
        "meta": meta,
    }
