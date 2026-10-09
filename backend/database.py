"""
CivicMind — SQLite persistence layer.

A single-file SQLite database keeps the prototype zero-setup while the
schema stays PostgreSQL-ready. Every helper opens a short-lived connection,
which is safe under uvicorn's threadpool and trivial to reason about.
"""
import sqlite3
import contextlib
from config import DB_PATH

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'citizen',   -- citizen | officer | admin
    phone         TEXT,
    department    TEXT,
    ward          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaints (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id     TEXT NOT NULL UNIQUE,              -- CMP-000123
    user_id       INTEGER REFERENCES users(id),
    category      TEXT NOT NULL,
    description   TEXT NOT NULL,
    latitude      REAL NOT NULL,
    longitude     REAL NOT NULL,
    address       TEXT,
    ward          TEXT,
    zone          TEXT,
    image_path    TEXT,
    image_hash    TEXT,                              -- sha256 of the proof-of-issue photo
    proof_verified INTEGER,                          -- 1 verified | 0 flagged | NULL unchecked
    proof_check   TEXT,                              -- JSON evidence-check result
    status        TEXT NOT NULL DEFAULT 'submitted', -- submitted|clustered|in_progress|resolved|rejected
    severity      INTEGER NOT NULL DEFAULT 3,        -- 1..5
    ai_category   TEXT,
    ai_confidence REAL,
    ai_summary    TEXT,
    ai_engine     TEXT,                              -- sarvam | rules
    incident_id   INTEGER REFERENCES incidents(id),
    -- direct officer resolution of a single complaint
    resolution_proof_path  TEXT,
    resolution_proof_check TEXT,
    resolution_image_hash  TEXT,
    resolved_by            INTEGER REFERENCES users(id),
    resolved_at            TEXT,
    resolution_notes       TEXT,
    resolution_plan        TEXT,     -- AI-generated resolution plan (JSON)
    eta_hours              REAL,     -- estimated resolution time
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id          TEXT NOT NULL UNIQUE,         -- INC-00042
    title              TEXT NOT NULL,
    type               TEXT NOT NULL,
    category           TEXT NOT NULL,
    confidence         REAL NOT NULL DEFAULT 0,
    severity           INTEGER NOT NULL DEFAULT 3,
    priority_score     REAL NOT NULL DEFAULT 0,
    priority_label     TEXT NOT NULL DEFAULT 'Medium',
    affected_people    INTEGER NOT NULL DEFAULT 0,
    spread_km          REAL NOT NULL DEFAULT 0,
    duration_hours     REAL NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'active',
    ward               TEXT,
    zone               TEXT,
    centroid_lat       REAL NOT NULL,
    centroid_lng       REAL NOT NULL,
    report_count       INTEGER NOT NULL DEFAULT 0,
    summary            TEXT,
    probable_cause     TEXT,
    priority_reason    TEXT,
    investigation      TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incident_complaints (
    incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    PRIMARY KEY (incident_id, complaint_id)
);

CREATE TABLE IF NOT EXISTS actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id   INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    action_text   TEXT NOT NULL,
    assigned_team TEXT,
    department    TEXT,
    eta_hours     REAL DEFAULT 24,
    checklist     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending|approved|in_progress|completed|rejected
    approved_by   INTEGER REFERENCES users(id),
    notes         TEXT,
    proof_path    TEXT,                              -- officer's proof-of-resolution photo
    proof_check   TEXT,                              -- JSON evidence-check result
    image_hash    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at   TEXT,
    started_at    TEXT,
    completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id   INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    evidence_type TEXT,
    value         TEXT,
    source        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resolutions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id          INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    before_metric        REAL,
    after_metric         REAL,
    reduction_pct        REAL,
    resolution_confidence REAL,
    summary              TEXT,
    proof_path           TEXT,
    proof_check          TEXT,
    image_hash           TEXT,
    resolved_by          INTEGER REFERENCES users(id),
    status               TEXT DEFAULT 'verified',
    verified_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id),
    complaint_id INTEGER REFERENCES complaints(id),
    incident_id  INTEGER REFERENCES incidents(id),
    title        TEXT NOT NULL,
    message      TEXT,
    type         TEXT DEFAULT 'info',
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor      TEXT,
    action     TEXT,
    detail     TEXT,
    incident_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Columns added after v2 — applied automatically to existing databases.
MIGRATIONS = {
    "complaints":  [("image_hash", "TEXT"), ("proof_verified", "INTEGER"), ("proof_check", "TEXT"),
                    ("resolution_proof_path", "TEXT"), ("resolution_proof_check", "TEXT"),
                    ("resolution_image_hash", "TEXT"), ("resolved_by", "INTEGER"),
                    ("resolved_at", "TEXT"), ("resolution_notes", "TEXT"),
                    ("resolution_plan", "TEXT"), ("eta_hours", "REAL")],
    "actions":     [("proof_path", "TEXT"), ("proof_check", "TEXT"), ("image_hash", "TEXT")],
    "resolutions": [("proof_path", "TEXT"), ("proof_check", "TEXT"), ("image_hash", "TEXT"),
                    ("resolved_by", "INTEGER"), ("complaint_id", "INTEGER")],
}


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextlib.contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query(sql, params=(), one=False):
    with db() as conn:
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        return (dict(rows[0]) if rows else None) if one else [dict(r) for r in rows]


def execute(sql, params=()):
    with db() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid


def _migrate(conn):
    for table, cols in MIGRATIONS.items():
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for name, coltype in cols:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {coltype}")


def init_db():
    with db() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)


def next_public_id(table, prefix, width=5):
    with db() as conn:
        row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
        return f"{prefix}-{row['c'] + 1:0{width}d}"
