"""
CivicMind — reverse geocoding for "Use my current location" (server-side, opt-in).

Disabled unless CIVICMIND_REVERSE_GEOCODER=nominatim. When enabled it follows
the public Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
one lookup per explicit user click, at most 1 request per second for the
whole application, an identifying User-Agent, a result cache, attribution,
and a single switch to turn it off. Coordinates outside the service area are
never sent. The result is a suggestion the citizen can edit; the map pin
remains the authoritative location.
"""
import threading
import time

import requests

import config
from services import geo

ATTRIBUTION = "Address © OpenStreetMap contributors, via Nominatim (ODbL)"
_cache, _lock, _last = {}, threading.Lock(), [0.0]


def available():
    return config.REVERSE_GEOCODER == "nominatim"


def _landmark(data):
    a = data.get("address") if isinstance(data.get("address"), dict) else {}
    name = data.get("name") if isinstance(data.get("name"), str) else ""
    parts = [name] if name else []
    for k in ("road", "neighbourhood", "suburb"):
        v = a.get(k)
        if isinstance(v, str) and v and v not in parts:
            parts.append(v)
    return ", ".join(parts[:3])[:200] or None


def reverse(lat, lng):
    """Return {available, address, landmark, attribution} — never raises."""
    if not available():
        return {"available": False, "reason": "not_configured",
                "message": "Address lookup is not enabled on this server. Please type a landmark or address."}
    if not geo.valid_coordinates(lat, lng) or not geo.in_service_area(lat, lng):
        return {"available": False, "reason": "outside_service_area",
                "message": "That location is outside the service area."}
    key = (round(lat, 4), round(lng, 4))
    with _lock:
        if key in _cache:
            return dict(_cache[key], cached=True)
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)      # stay under 1 request/second for the whole application
        _last[0] = time.time()
        try:
            resp = requests.get(config.REVERSE_GEOCODER_URL, timeout=6, allow_redirects=False,
                                params={"lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "format": "jsonv2",
                                        "zoom": 18, "addressdetails": 1, "accept-language": "en"},
                                headers={"User-Agent": config.REVERSE_GEOCODER_USER_AGENT})
            data = resp.json() if resp.status_code == 200 else None
        except (requests.RequestException, ValueError):
            data = None
        if not isinstance(data, dict) or not isinstance(data.get("display_name"), str):
            return {"available": False, "reason": "lookup_failed",
                    "message": "Could not find an address for this point. Please type a landmark."}
        out = {"available": True, "address": " ".join(data["display_name"].split())[:300],
               "landmark": _landmark(data), "attribution": ATTRIBUTION, "provider": "nominatim"}
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = out
        return out
