"""
CivicMind — central configuration.

Everything tunable is loaded here so NOTHING is hardcoded in the application
code:

  * domain data (city, categories, departments, wards, asset rules) lives in
    ../data/civicmind_config.json  — edit that file, not the code;
  * secrets & environment values come from a .env file or real environment
    variables (see .env.example).

Import order is deliberately dependency-free so this module can be imported
from anywhere without cycles.
"""
import json
import os
import secrets

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
DATA_DIR = os.path.join(PROJECT_ROOT, "data")


# ---------------------------------------------------------------------------
# Minimal .env loader (no external dependency)
# ---------------------------------------------------------------------------
def _load_dotenv():
    if os.environ.get("CIVICMIND_SKIP_DOTENV") == "1":
        return
    for path in (os.path.join(PROJECT_ROOT, ".env"), os.path.join(BASE_DIR, ".env")):
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key, val = key.strip(), val.strip().strip('"').strip("'")
                    # real environment variables win over the .env file
                    if key and val and key not in os.environ:
                        os.environ[key] = val
        except Exception:
            pass


_load_dotenv()


def _env(key, default=""):
    return os.environ.get(key, default)


def _env_bool(key, default=False):
    val = os.environ.get(key)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


CONFIG_FILE = _env("CIVICMIND_CONFIG", os.path.join(DATA_DIR, "civicmind_config.json"))
DB_PATH = os.path.abspath(_env("CIVICMIND_DB", os.path.join(BASE_DIR, "civicmind.db")))
# Legacy public upload folder (no longer served). Kept only so evidence written
# by older versions can still be found and served through the authorised API.
LEGACY_UPLOAD_DIR = os.path.join(PROJECT_ROOT, "uploads")
# Private evidence store — NOT mounted as static files. Served only via
# authorised API endpoints.
EVIDENCE_DIR = os.path.abspath(_env("CIVICMIND_EVIDENCE_DIR", os.path.join(PROJECT_ROOT, "private", "evidence")))
SECRET_FILE = os.path.join(BASE_DIR, ".secret_key")

os.makedirs(EVIDENCE_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Domain configuration (from data/civicmind_config.json)
# ---------------------------------------------------------------------------
_DEFAULTS = {
    "city_name": "Pune",
    "city_center": {"lat": 18.5204, "lng": 73.8567},
    "service_radius_km": 60,
    "categories": [],
    "departments": {},
    "wards": [],
    "demo_accounts": [],
    "require_issue_photo": False,
    "priority_thresholds": {"critical": 80, "high": 60, "medium": 40},
    "cluster": {"radius_km": 1.5, "window_hours": 48, "min_size": 3},
    "category_groups": [],
    "asset_types": {},
    "category_asset_types": {},
    "asset_match": {"radius_m": 150},
    "risk_rules": {},
}


def _load_config():
    data = dict(_DEFAULTS)
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
            data.update(json.load(fh))
    except FileNotFoundError:
        print(f"[CivicMind] Config file not found at {CONFIG_FILE}; using defaults.")
    except Exception as exc:  # noqa: BLE001
        print(f"[CivicMind] Could not read config file: {exc}")
    return data


CFG = _load_config()

CITY_NAME = CFG.get("city_name", "Pune")
CITY_CENTER = CFG.get("city_center", _DEFAULTS["city_center"])
SERVICE_RADIUS_KM = float(CFG.get("service_radius_km", 60))
CATEGORIES = CFG.get("categories", [])
DEPARTMENT_MAP = CFG.get("departments", {})
WARDS_RAW = CFG.get("wards", [])
# Demo account *identities* (role / name / email). Passwords are never stored
# in config — the explicit demo seeding command generates them locally.
DEMO_ACCOUNTS = CFG.get("demo_accounts", [])
REQUIRE_ISSUE_PHOTO = bool(CFG.get("require_issue_photo", False))
CATEGORY_GROUPS = [set(g) for g in CFG.get("category_groups", [])]

# ward lookup: name -> (lat, lng, zone)
WARDS = {w["ward"]: (w["lat"], w["lng"], w.get("zone", "")) for w in WARDS_RAW}
ZONES = sorted({w.get("zone", "") for w in WARDS_RAW if w.get("zone")})

_thr = CFG.get("priority_thresholds", {})
PRIORITY_CRITICAL_THRESHOLD = float(_env("CIVICMIND_CRITICAL", _thr.get("critical", 80)))
PRIORITY_HIGH_THRESHOLD = float(_env("CIVICMIND_HIGH", _thr.get("high", 60)))
PRIORITY_MEDIUM_THRESHOLD = float(_env("CIVICMIND_MEDIUM", _thr.get("medium", 40)))

_cl = CFG.get("cluster", {})
CLUSTER_RADIUS_KM = float(_env("CIVICMIND_CLUSTER_RADIUS_KM", _cl.get("radius_km", 1.5)))
CLUSTER_TIME_WINDOW_HOURS = float(_env("CIVICMIND_CLUSTER_WINDOW_H", _cl.get("window_hours", 48)))
MIN_CLUSTER_SIZE = int(_env("CIVICMIND_MIN_CLUSTER", _cl.get("min_size", 3)))

# Infrastructure intelligence
ASSET_TYPES = CFG.get("asset_types", {})                    # type -> {label, department}
CATEGORY_ASSET_TYPES = CFG.get("category_asset_types", {})  # category -> [asset types]
ASSET_MATCH_RADIUS_M = float(CFG.get("asset_match", {}).get("radius_m", 150))
RISK_RULES = CFG.get("risk_rules", {})

# ---------------------------------------------------------------------------
# Runtime mode
# ---------------------------------------------------------------------------
# Demo mode is switched on explicitly (run_demo.* sets it) and only changes
# what the login page shows (demo account e-mails, never passwords).
DEMO_MODE = _env_bool("CIVICMIND_DEMO_MODE", False)
# Comma-separated list of allowed cross-origin callers. Empty = same-origin only.
CORS_ORIGINS = [o.strip() for o in _env("CIVICMIND_CORS_ORIGINS", "").split(",") if o.strip()]
MAX_REQUEST_BYTES = int(_env("CIVICMIND_MAX_REQUEST_BYTES", str(9 * 1024 * 1024)))
MAX_IMAGE_BYTES = int(_env("CIVICMIND_MAX_IMAGE_BYTES", str(5 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(_env("CIVICMIND_MAX_IMAGE_PIXELS", str(40_000_000)))


# ---------------------------------------------------------------------------
# Security — never ship a hardcoded secret.
# Priority: env var  ->  persisted .secret_key file  ->  freshly generated.
# ---------------------------------------------------------------------------
def _resolve_secret():
    env_secret = _env("CIVICMIND_SECRET").strip()
    if env_secret:
        return env_secret
    try:
        if os.path.isfile(SECRET_FILE):
            with open(SECRET_FILE, "r", encoding="utf-8") as fh:
                existing = fh.read().strip()
            if existing:
                return existing
        generated = secrets.token_urlsafe(48)
        with open(SECRET_FILE, "w", encoding="utf-8") as fh:
            fh.write(generated)
        try:
            os.chmod(SECRET_FILE, 0o600)
        except OSError:
            pass
        return generated
    except Exception:
        # last resort — still unique per process, just not persistent
        return secrets.token_urlsafe(48)


SECRET_KEY = _resolve_secret()
TOKEN_TTL_HOURS = int(_env("CIVICMIND_TOKEN_TTL_HOURS", "12"))
PBKDF2_ITERATIONS = int(_env("CIVICMIND_PBKDF2_ITERATIONS", "310000"))

# ---------------------------------------------------------------------------
# Sarvam AI
# ---------------------------------------------------------------------------
SARVAM_API_KEY = "" if _env_bool("CIVICMIND_DISABLE_AI") else _env("SARVAM_API_KEY").strip()
SARVAM_BASE_URL = _env("SARVAM_BASE_URL", "https://api.sarvam.ai")
SARVAM_CHAT_MODEL = _env("SARVAM_CHAT_MODEL", "sarvam-105b")
SARVAM_TIMEOUT = float(_env("SARVAM_TIMEOUT", "25"))
# Optional vision model for an *observation note* on photos (never a verdict).
SARVAM_VISION_MODEL = _env("SARVAM_VISION_MODEL", "").strip()

# Role -> home dashboard
ROLE_HOME = {
    "citizen": "/citizen.html",
    "officer": "/dashboard.html",
    "admin": "/admin.html",
}
ROLES = ("citizen", "officer", "admin")
