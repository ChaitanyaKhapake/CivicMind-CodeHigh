"""CivicMind — authentication routes."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import authenticate, create_token, create_user, current_user
from database import query
from config import ROLE_HOME

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    name: str
    email: str
    password: str
    phone: str | None = None
    ward: str | None = None


@router.post("/login")
def login(body: LoginIn):
    user = authenticate(body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {k: user[k] for k in ("id", "name", "email", "role", "department", "ward")},
        "home": ROLE_HOME.get(user["role"], "/"),
    }


@router.post("/register")
def register(body: RegisterIn):
    if query("SELECT id FROM users WHERE email=?", (body.email.lower().strip(),), one=True):
        raise HTTPException(status_code=409, detail="Email already registered")
    uid = create_user(body.name, body.email, body.password, role="citizen",
                      phone=body.phone, ward=body.ward)
    token = create_token(uid, "citizen")
    return {"token": token, "user": {"id": uid, "name": body.name,
            "email": body.email.lower().strip(), "role": "citizen"},
            "home": ROLE_HOME["citizen"]}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user
