"""
CivicMind — deterministic SYNTHETIC utility network for demonstrations.

Everything here is fictional: provenance `synthetic_demo`, is_synthetic=1,
"(fictional)" in names, and contacts that cannot be dialled. It is written
only by the explicit demo seed command (seed_demo.py) into the isolated demo
database, never on application start-up. Re-running it changes nothing.

Water scenario (around a fictional leak at ~18.5013, 73.8131):
  SRC-DEMO-01 reservoir → WM-DEMO-01 trunk → J-DEMO-01 → V-DEMO-01 → WM-DEMO-02 → J-DEMO-02
     J-DEMO-02 → V-DEMO-02 → WM-DEMO-03 (leak segment) → J-DEMO-03 → V-DEMO-04 → WM-DEMO-07 → END-DEMO-01
     J-DEMO-02 → WM-DEMO-04 → V-DEMO-03 → WM-DEMO-05 → J-DEMO-04
     J-DEMO-03 – WM-DEMO-06 – J-DEMO-04   (loop; flow direction unknown)
  Second component WM-DEMO-101 → WM-DEMO-102 has NO recorded upstream link,
  although WM-DEMO-101 ends a few metres from J-DEMO-03 on the map.
Plus small electricity, sewer, gas and telecom examples for the map layers.
"""
import json
from datetime import datetime, timedelta, timezone

from services.utility_network import geometry, model

SOURCE_CODE = "SRC-SYNTHETIC-DEMO"
ORG_WATER = "Fictional Water Utility (demo)"
ORG_POWER = "Fictional Power Utility (demo)"


def _ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def P(lat, lng):
    return {"type": "Point", "coordinates": [lng, lat]}


def L(*pts):
    return {"type": "LineString", "coordinates": [[lng, lat] for lat, lng in pts]}


SRC, J1, V1, J2, V2 = (18.50480, 73.80980), (18.50380, 73.81120), (18.50370, 73.81135), (18.50220, 73.81250), (18.50205, 73.81262)
J3, V3, J4, V4, END = (18.50060, 73.81360), (18.50240, 73.81330), (18.50150, 73.81450), (18.49990, 73.81400), (18.49900, 73.81450)

# (asset_id, utility, asset_type, name, geometry, extra)
ASSETS = [
    ("SRC-DEMO-01", "water", "reservoir", "Hill reservoir R-1 (fictional)", P(*SRC), {"criticality": "critical"}),
    ("WM-DEMO-01", "water", "main", "Trunk main from reservoir (fictional)", L(SRC, (18.50430, 73.81050), J1),
     {"criticality": "critical", "attributes": {"diameter_mm": 450, "material": "ductile iron"}}),
    ("J-DEMO-01", "water", "junction", "Junction J-1 (fictional)", P(*J1), {}),
    ("V-DEMO-01", "water", "valve", "Sluice valve V-1 (fictional)", P(*V1), {}),
    ("WM-DEMO-02", "water", "main", "Distribution main, College Road (fictional)", L(V1, (18.50300, 73.81190), J2),
     {"criticality": "high", "attributes": {"diameter_mm": 300}}),
    ("J-DEMO-02", "water", "junction", "Junction J-2 (fictional)", P(*J2), {}),
    ("V-DEMO-02", "water", "valve", "Sluice valve V-2 (fictional)", P(*V2), {}),
    ("WM-DEMO-03", "water", "main", "Distribution main, Lane 7 (fictional)", L(V2, (18.50130, 73.81312), J3),
     {"criticality": "high", "attributes": {"diameter_mm": 200, "material": "cast iron", "install_year": 1994}}),
    ("J-DEMO-03", "water", "junction", "Junction J-3 (fictional)", P(*J3), {}),
    ("WM-DEMO-04", "water", "branch", "Branch to east colony (fictional)", L(J2, V3), {}),
    ("V-DEMO-03", "water", "valve", "Branch valve V-3 (fictional)", P(*V3), {"verification_status": "unverified"}),
    ("WM-DEMO-05", "water", "branch", "East colony branch (fictional)", L(V3, (18.50200, 73.81400), J4), {}),
    ("J-DEMO-04", "water", "junction", "Junction J-4 (fictional)", P(*J4), {}),
    ("WM-DEMO-06", "water", "branch", "Loop link J-3 to J-4 (fictional)", L(J3, (18.50100, 73.81410), J4),
     {"verification_status": "unverified", "provenance": "approximate_unverified"}),
    ("V-DEMO-04", "water", "valve", "Sluice valve V-4 (fictional)", P(*V4), {}),
    ("WM-DEMO-07", "water", "branch", "Branch to south lane (fictional)", L(V4, END), {}),
    ("END-DEMO-01", "water", "endpoint", "Service area endpoint (fictional)", P(*END), {}),
    ("WM-DEMO-101", "water", "main", "Old main, unrecorded feed (fictional)", L((18.49950, 73.81200), (18.50052, 73.81352)),
     {"verification_status": "unverified", "provenance": "approximate_unverified"}),
    ("WM-DEMO-102", "water", "branch", "Branch off old main (fictional)", L((18.49950, 73.81200), (18.49880, 73.81150)),
     {"verification_status": "unverified", "provenance": "approximate_unverified"}),
    # Electricity near the streetlight demo cluster
    ("SUB-DEMO-01", "electric", "substation", "Substation S-1 (fictional)", P(18.50800, 73.80600), {"criticality": "critical"}),
    ("CB-DEMO-01", "electric", "cable", "11 kV cable S-1 to switch (fictional)", L((18.50800, 73.80600), (18.50700, 73.80720)),
     {"attributes": {"voltage_kv": 11}}),
    ("SW-DEMO-01", "electric", "ring_main_unit", "Ring main unit RMU-1 (fictional)", P(18.50700, 73.80720), {}),
    ("CB-DEMO-02", "electric", "cable", "LT feeder to streetlights (fictional)", L((18.50700, 73.80720), (18.50630, 73.80800)), {}),
    ("TR-DEMO-01", "electric", "transformer", "Feeder pillar FP-1 (fictional)", P(18.50630, 73.80800), {}),
    # Sewer
    ("SWR-DEMO-01", "sewer", "sewer_line", "Sewer line, Lane 4 (fictional)", L((18.50400, 73.81100), (18.50300, 73.81250)), {}),
    ("MH-DEMO-01", "sewer", "manhole", "Manhole MH-1 (fictional)", P(18.50300, 73.81250), {}),
    ("SWR-DEMO-02", "sewer", "trunk_sewer", "Trunk sewer to outfall (fictional)", L((18.50300, 73.81250), (18.50150, 73.81500)), {}),
    ("OUT-DEMO-01", "sewer", "outfall", "Outfall to treatment (fictional)", P(18.50150, 73.81500), {}),
    # Gas (restricted)
    ("GM-DEMO-01", "gas", "gas_main", "Medium-pressure gas main (fictional)", L((18.50000, 73.80900), (18.50100, 73.81150)), {}),
    ("GV-DEMO-01", "gas", "valve", "Gas isolation valve GV-1 (fictional)", P(18.50000, 73.80900), {}),
    # Telecom
    ("FB-DEMO-01", "telecom", "fibre", "Fibre route F-1 (fictional)", L((18.50500, 73.81000), (18.50250, 73.81450)), {}),
    ("CAB-DEMO-01", "telecom", "cabinet", "Street cabinet C-1 (fictional)", P(18.50250, 73.81450), {}),
]

# (connection_id, from, to, type, direction, extra)
CONNECTIONS = [
    ("UC-DEMO-01", "SRC-DEMO-01", "WM-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-02", "WM-DEMO-01", "J-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-03", "J-DEMO-01", "V-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-04", "V-DEMO-01", "WM-DEMO-02", "feeds", "downstream", {}),
    ("UC-DEMO-05", "WM-DEMO-02", "J-DEMO-02", "feeds", "downstream", {"verification_status": "unverified"}),
    ("UC-DEMO-06", "J-DEMO-02", "V-DEMO-02", "feeds", "downstream", {}),
    ("UC-DEMO-07", "V-DEMO-02", "WM-DEMO-03", "feeds", "downstream", {}),
    ("UC-DEMO-08", "WM-DEMO-03", "J-DEMO-03", "feeds", "downstream", {}),
    ("UC-DEMO-09", "J-DEMO-02", "WM-DEMO-04", "feeds", "downstream", {}),
    ("UC-DEMO-10", "WM-DEMO-04", "V-DEMO-03", "feeds", "downstream", {}),
    ("UC-DEMO-11", "V-DEMO-03", "WM-DEMO-05", "feeds", "downstream", {}),
    ("UC-DEMO-12", "WM-DEMO-05", "J-DEMO-04", "feeds", "downstream", {}),
    ("UC-DEMO-13", "J-DEMO-03", "WM-DEMO-06", "links", "unknown", {"verification_status": "unverified",
                                                                     "notes": "Loop; flow direction not recorded"}),
    ("UC-DEMO-14", "WM-DEMO-06", "J-DEMO-04", "links", "unknown", {"verification_status": "unverified"}),
    ("UC-DEMO-15", "J-DEMO-03", "V-DEMO-04", "feeds", "downstream", {}),
    ("UC-DEMO-16", "V-DEMO-04", "WM-DEMO-07", "feeds", "downstream", {}),
    ("UC-DEMO-17", "WM-DEMO-07", "END-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-18", "WM-DEMO-101", "WM-DEMO-102", "feeds", "downstream", {"verification_status": "unverified"}),
    ("UC-DEMO-21", "SUB-DEMO-01", "CB-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-22", "CB-DEMO-01", "SW-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-23", "SW-DEMO-01", "CB-DEMO-02", "feeds", "downstream", {}),
    ("UC-DEMO-24", "CB-DEMO-02", "TR-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-31", "SWR-DEMO-01", "MH-DEMO-01", "drains_to", "downstream", {}),
    ("UC-DEMO-32", "MH-DEMO-01", "SWR-DEMO-02", "drains_to", "downstream", {}),
    ("UC-DEMO-33", "SWR-DEMO-02", "OUT-DEMO-01", "drains_to", "downstream", {}),
    ("UC-DEMO-41", "GV-DEMO-01", "GM-DEMO-01", "feeds", "downstream", {}),
    ("UC-DEMO-51", "FB-DEMO-01", "CAB-DEMO-01", "links", "bidirectional", {}),
]

CONTACTS = [
    ("CT-DEMO-01", "Water Supply Control Room — FICTIONAL", "24×7 control room (demo)",
     "DEMO-ONLY · not a real number", "water", ORG_WATER, True, "verified"),
    ("CT-DEMO-02", "Ward water engineer — FICTIONAL", "Section engineer (demo)",
     "DEMO-ONLY · not a real number", "water", ORG_WATER, False, "unverified"),
    ("CT-DEMO-03", "Power distribution desk — FICTIONAL", "Outage desk (demo)",
     "DEMO-ONLY · not a real number", "electric", ORG_POWER, True, "verified"),
]

MAINTENANCE = [
    ("MR-DEMO-01", "WM-DEMO-03", "repair", 25, "Leaking joint repaired near Lane 7 (fictional)", "WO-DEMO-118"),
    ("MR-DEMO-02", "V-DEMO-02", "inspection", 200, "Valve exercised, operable (fictional)", "WO-DEMO-064"),
    ("MR-DEMO-03", "SW-DEMO-01", "inspection", 120, "RMU inspected (fictional)", "WO-DEMO-090"),
]


def seed(conn):
    """Idempotent: inserts only rows whose IDs are missing. Returns counts of new rows."""
    ts = _ago(0)
    row = conn.execute("SELECT id FROM utility_data_sources WHERE source_code=?", (SOURCE_CODE,)).fetchone()
    if row:
        source_id = row["id"]
    else:
        source_id = conn.execute(
            """INSERT INTO utility_data_sources (source_code, name, source_type, authority, license_notes, crs,
               provenance_class, is_synthetic, created_at) VALUES (?,?, 'synthetic', ?,?, 'EPSG:4326',
               'synthetic_demo', 1, ?)""",
            (SOURCE_CODE, "CivicMind synthetic demo network (fictional)", "None — fictional dataset",
             "Generated for demonstrations. Not real infrastructure.", ts)).lastrowid
    new = {"assets": 0, "connections": 0, "contacts": 0, "maintenance": 0}
    for aid, ut, at, name, geom, extra in ASSETS:
        if conn.execute("SELECT 1 FROM utility_assets WHERE asset_id=?", (aid,)).fetchone():
            continue
        gtype, gnorm, (min_lat, min_lng, max_lat, max_lng) = geometry.validate(geom)
        org = ORG_WATER if ut == "water" else ORG_POWER if ut == "electric" else f"Fictional {ut} operator (demo)"
        conn.execute(
            """INSERT INTO utility_assets (asset_id, utility_type, asset_type, name, geometry_type, geometry, min_lat,
               min_lng, max_lat, max_lng, operational_status, operator_org, criticality, attributes, is_control_device,
               is_source, sensitivity, source_id, provenance_class, verification_status, is_synthetic,
               last_verified_at, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?, 'in_service', ?,?,?,?,?,?,?,?,?, 1, ?,?,?)""",
            (aid, ut, at, name, gtype, json.dumps(gnorm), min_lat, min_lng, max_lat, max_lng, org,
             extra.get("criticality"), json.dumps(extra.get("attributes", {})), int(model.is_control(ut, at)),
             int(model.is_source(ut, at)), "restricted" if ut in ("gas", "electric") else "internal", source_id,
             extra.get("provenance", "synthetic_demo"), extra.get("verification_status", "verified"),
             _ago(60) if extra.get("verification_status", "verified") == "verified" else None, ts, ts))
        new["assets"] += 1
    ids = {r["asset_id"]: r["id"] for r in conn.execute("SELECT id, asset_id FROM utility_assets")}
    for cid, f, t, ctype, direction, extra in CONNECTIONS:
        if conn.execute("SELECT 1 FROM utility_connections WHERE connection_id=?", (cid,)).fetchone():
            continue
        conn.execute(
            """INSERT INTO utility_connections (connection_id, from_asset, to_asset, connection_type, direction,
               source_id, provenance_class, verification_status, is_synthetic, notes, created_at)
               VALUES (?,?,?,?,?,?, 'synthetic_demo', ?, 1, ?, ?)""",
            (cid, ids[f], ids[t], ctype, direction, source_id, extra.get("verification_status", "verified"),
             extra.get("notes"), ts))
        new["connections"] += 1
    for cid, org, role, phone, ut, operator, emergency, status in CONTACTS:
        if conn.execute("SELECT 1 FROM utility_contacts WHERE contact_id=?", (cid,)).fetchone():
            continue
        conn.execute(
            """INSERT INTO utility_contacts (contact_id, organization, role, phone, is_emergency, hours, utility_type,
               operator_org, source_id, verification_status, last_verified_at, visibility_level, is_synthetic, created_at)
               VALUES (?,?,?,?,?, '24×7 (demo)', ?,?,?,?,?, 'officer', 1, ?)""",
            (cid, org, role, phone, int(emergency), ut, operator, source_id, status,
             _ago(30) if status == "verified" else None, ts))
        new["contacts"] += 1
    for rid, aid, work, days, outcome, ref in MAINTENANCE:
        if conn.execute("SELECT 1 FROM utility_maintenance WHERE record_id=?", (rid,)).fetchone():
            continue
        conn.execute(
            """INSERT INTO utility_maintenance (record_id, asset_id, work_type, performed_on, outcome, reference,
               department, source_id, provenance_class, is_synthetic, created_at)
               VALUES (?,?,?,?,?,?, 'Fictional crew (demo)', ?, 'synthetic_demo', 1, ?)""",
            (rid, ids[aid], work, _ago(days), outcome, ref, source_id, ts))
        new["maintenance"] += 1
    return new


# Fictional water-leak reports for the scenario: (citizen index, description, lat, lng, hours ago)
LEAK_REPORTS = [
    (0, "Water is gushing out of the road on Lane 7 near the tea stall. The road is flooding.", 18.50128, 73.81309, 6),
    (1, "Big water leak from under the road in Lane 7, water flowing towards the main road.", 18.50140, 73.81322, 4),
    (2, "लेन 7 मध्ये रस्त्याखालून पाणी वाहत आहे, पाईप फुटली आहे असे वाटते.", 18.50118, 73.81298, 2),
]
