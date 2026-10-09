"""
CivicMind — geospatial helpers and area (ward/zone) mapping.

The ward reference table is loaded from data/civicmind_config.json (via
config.WARDS) — edit that file to change the city, not this code. If no wards
are configured, area mapping gracefully returns "Unmapped".
"""
import math

from config import WARDS, ZONES, CLUSTER_RADIUS_KM


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    """Great-circle distance in kilometres."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_ward(lat, lng):
    """Return (ward_name, zone) for the closest configured ward, or (None, None)."""
    if not WARDS:
        return None, None
    best, best_d = None, 1e9
    for name, (wlat, wlng, zone) in WARDS.items():
        d = haversine_km(lat, lng, wlat, wlng)
        if d < best_d:
            best, best_d = (name, zone), d
    return best


def map_area(lat, lng):
    """Public area-mapping helper -> {ward, zone, distance_km}."""
    ward, zone = nearest_ward(lat, lng)
    if not ward:
        return {"ward": None, "zone": None, "distance_km": None}
    d = haversine_km(lat, lng, WARDS[ward][0], WARDS[ward][1])
    return {"ward": ward, "zone": zone, "distance_km": round(d, 2)}


def centroid(points):
    """Average lat/lng of a list of (lat, lng) tuples."""
    if not points:
        return (0.0, 0.0)
    return (sum(p[0] for p in points) / len(points),
            sum(p[1] for p in points) / len(points))


def spread_km(points):
    """Max distance from the centroid, in km (approximate geographic spread)."""
    if len(points) < 2:
        return 0.0
    clat, clng = centroid(points)
    return round(max(haversine_km(clat, clng, p[0], p[1]) for p in points), 2)


def within_radius(a, b, radius_km=CLUSTER_RADIUS_KM) -> bool:
    return haversine_km(a[0], a[1], b[0], b[1]) <= radius_km
