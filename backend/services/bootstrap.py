"""
CivicMind — first-run bootstrap.

The platform ships EMPTY: no synthetic complaints or incidents. On startup we
only ensure the demo accounts (defined in data/civicmind_config.json) exist so
that a reviewer can sign in. Every complaint and incident on the dashboards is
created by real user activity — nothing is pre-populated.

`reset_data()` clears all civic data (complaints, incidents, actions, ...)
while keeping user accounts, for a clean demo reset.
"""
from config import DEMO_ACCOUNTS
from database import query, execute, db
from auth import create_user, hash_password


def bootstrap():
    """Create any missing demo accounts. Safe to call on every startup."""
    created = []
    for acc in DEMO_ACCOUNTS:
        email = (acc.get("email") or "").lower().strip()
        if not email:
            continue
        if query("SELECT id FROM users WHERE email=?", (email,), one=True):
            continue
        create_user(
            name=acc.get("name") or email.split("@")[0],
            email=email,
            password=acc.get("password") or "changeme123",
            role=acc.get("role", "citizen"),
            phone=acc.get("phone"),
            department=acc.get("department"),
            ward=acc.get("ward"),
        )
        created.append(email)
    return {"created_accounts": created}


def reset_data():
    """Delete all civic data, keep user accounts."""
    with db() as conn:
        # Order matters: children before parents (complaints reference incidents).
        for t in ["notifications", "activity", "resolutions", "evidence",
                  "actions", "incident_complaints", "complaints", "incidents"]:
            conn.execute(f"DELETE FROM {t}")
        # Clear the dangling incident links defensively.
        conn.execute("UPDATE complaints SET incident_id=NULL")
    return {"reset": True}


def ensure_admin(email, password, name="Admin"):
    """Create (or update) an admin account — handy for real deployments."""
    email = email.lower().strip()
    existing = query("SELECT id FROM users WHERE email=?", (email,), one=True)
    if existing:
        execute("UPDATE users SET role='admin', password_hash=? WHERE id=?",
                (hash_password(password), existing["id"]))
        return existing["id"]
    return create_user(name, email, password, role="admin")
