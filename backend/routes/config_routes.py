"""
CivicMind — public configuration endpoint.

The frontend reads categories, departments, wards and the city centre from
here, so nothing is hardcoded in the browser either. Safe to expose (contains
no secrets).
"""
from fastapi import APIRouter

from config import (CATEGORIES, DEPARTMENT_MAP, WARDS_RAW, CITY_NAME,
                    CITY_CENTER, EXPOSE_DEMO_CREDENTIALS, DEMO_ACCOUNTS,
                    CLUSTER_RADIUS_KM, CLUSTER_TIME_WINDOW_HOURS)

router = APIRouter(prefix="/api", tags=["config"])


@router.get("/config")
def get_config():
    return {
        "city_name": CITY_NAME,
        "city_center": CITY_CENTER,
        "categories": CATEGORIES,
        "departments": sorted(set(DEPARTMENT_MAP.values())),
        "department_map": DEPARTMENT_MAP,
        "wards": WARDS_RAW,
        "cluster": {"radius_km": CLUSTER_RADIUS_KM,
                    "window_hours": CLUSTER_TIME_WINDOW_HOURS},
    }


@router.get("/demo-credentials")
def demo_credentials():
    """Only returned when explicitly enabled in the config file."""
    if not EXPOSE_DEMO_CREDENTIALS:
        return {"enabled": False, "accounts": []}
    return {
        "enabled": True,
        "accounts": [{"role": a.get("role"), "email": a.get("email"),
                      "password": a.get("password")} for a in DEMO_ACCOUNTS],
    }
