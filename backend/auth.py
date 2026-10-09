"""
CivicMind — lightweight auth.

Prototype-grade, token-based auth with PBKDF2 password hashing.
Tokens are signed with HMAC-SHA256 (no external JWT dependency) so the
project stays dependency-light and easy to debug. Swap for real OAuth /
municipal SSO in production (see the blueprint's Security section).
"""
import hmac
import hashlib
import base64
import json
import os
import time

from config import SECRET_KEY, TOKEN_TTL_HOURS
from database import query, execute

_ITERATIONS = 120_000


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(),
                                 bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Token helpers  (payload.signature, base64url)
# ---------------------------------------------------------------------------
def _sign(payload: str) -> str:
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode().rstrip("=")


def create_token(user_id: int, role: str) -> str:
    payload = json.dumps({
        "uid": user_id, "role": role,
        "exp": int(time.time()) + TOKEN_TTL_HOURS * 3600,
    })
    body = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def decode_token(token: str):
    try:
        body, sig = token.split(".")
        if not hmac.compare_digest(_sign(body), sig):
            return None
        padded = body + "=" * (-len(body) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------
from fastapi import Header, HTTPException  # noqa: E402


def current_user(authorization: str = Header(default="")) -> dict:
    """Resolve the caller from the Bearer token."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    data = decode_token(authorization[7:].strip())
    if not data:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = query("SELECT id, name, email, role, department, ward FROM users WHERE id=?",
                 (data["uid"],), one=True)
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


def require_role(*roles):
    def _dep(user: dict = None):
        # FastAPI injects via Depends; kept explicit for readability.
        if user is None or user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user
    return _dep


def authenticate(email: str, password: str):
    user = query("SELECT * FROM users WHERE email=?", (email.lower().strip(),), one=True)
    if not user or not verify_password(password, user["password_hash"]):
        return None
    return user


def create_user(name, email, password, role="citizen", phone=None,
                department=None, ward=None):
    return execute(
        """INSERT INTO users (name, email, password_hash, role, phone, department, ward)
           VALUES (?,?,?,?,?,?,?)""",
        (name, email.lower().strip(), hash_password(password), role,
         phone, department, ward),
    )
