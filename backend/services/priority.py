"""
CivicMind — Priority Engine.

Prototype scoring model (configurable, presented as a prototype — not an
official municipal standard):

    priority = severity x population_factor x spread_factor
               x duration_factor x criticality

The raw value is scaled to a 0-100 score and bucketed into
Critical / High / Medium / Low. Every factor is returned so the officer
dashboard can show *why* an incident ranked where it did.
"""
from config import (PRIORITY_CRITICAL_THRESHOLD, PRIORITY_HIGH_THRESHOLD,
                    PRIORITY_MEDIUM_THRESHOLD)

# Infrastructure criticality weight by category
CRITICALITY = {
    "Water Leakage": 1.30, "Low Water Pressure": 1.15, "Garbage Accumulation": 1.05,
    "Pothole": 1.15, "Road Damage": 1.10, "Streetlight Failure": 0.90,
    "Drainage Issue": 1.25, "Sewage Overflow": 1.40, "Fallen Tree": 1.20,
    "Traffic Signal Failure": 1.30, "Air/Noise Pollution": 1.00,
    "Encroachment": 0.85, "Other": 0.80,
}


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def estimate_affected(report_count, spread_km, severity):
    """Rough population-impact estimate for the prototype."""
    raw = report_count * 45 + spread_km * 300 + severity * 80
    return int(round(raw / 50.0) * 50)


def compute_priority(severity, report_count, spread_km, duration_hours,
                     category, affected_people=None):
    severity = _clamp(int(severity), 1, 5)
    if affected_people is None:
        affected_people = estimate_affected(report_count, spread_km, severity)

    population_factor = _clamp(affected_people / 2500.0, 0.5, 3.0)
    spread_factor = _clamp(1 + spread_km / 1.5, 0.8, 2.5)
    duration_factor = _clamp(1 + duration_hours / 24.0, 0.8, 2.5)
    criticality = CRITICALITY.get(category, 0.8)

    raw = severity * population_factor * spread_factor * duration_factor * criticality
    score = round(min(100.0, raw * 5.5), 1)

    if score >= PRIORITY_CRITICAL_THRESHOLD:
        label = "Critical"
    elif score >= PRIORITY_HIGH_THRESHOLD:
        label = "High"
    elif score >= PRIORITY_MEDIUM_THRESHOLD:
        label = "Medium"
    else:
        label = "Low"

    return {
        "priority_score": score,
        "priority_label": label,
        "affected_people": affected_people,
        "spread_km": round(spread_km, 2),
        "duration_hours": round(duration_hours, 1),
        "severity": severity,
        "report_count": report_count,
        "category": category,
        "factors": {
            "severity": severity,
            "population_factor": round(population_factor, 2),
            "spread_factor": round(spread_factor, 2),
            "duration_factor": round(duration_factor, 2),
            "criticality": criticality,
            "raw": round(raw, 2),
        },
    }
