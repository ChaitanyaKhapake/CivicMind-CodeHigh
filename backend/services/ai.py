"""
CivicMind — AI connectivity layer (Sarvam AI).

All language-model reasoning goes through Sarvam AI's Chat Completions API
(https://api.sarvam.ai/v1/chat/completions, model `sarvam-105b`).

Design principle (from the CivicMind blueprint):
  * numeric detection, clustering and priority scoring stay deterministic in
    Python, so the system is predictable and demonstrable;
  * the LLM adds classification, investigation narrative, priority rationale
    and response planning.

If SARVAM_API_KEY is absent (or the API errors), every function falls back to
a transparent rule-based engine, so the app is fully functional offline and
during a demo. The `engine` field on results tells you which path ran —
handy when debugging.
"""
import json
import re

import requests

from config import (SARVAM_API_KEY, SARVAM_BASE_URL, SARVAM_CHAT_MODEL,
                    SARVAM_TIMEOUT, CATEGORIES, DEPARTMENT_MAP)

# ---------------------------------------------------------------------------
# Domain knowledge (shared by the rule-based engine and the LLM prompts).
# CATEGORIES and DEPARTMENT_MAP come from data/civicmind_config.json — nothing
# is hardcoded here. The keyword/severity tables below are classification logic
# (not configuration) and are intentionally kept in code.
# ---------------------------------------------------------------------------

CATEGORY_KEYWORDS = {
    "Water Leakage": ["leak", "pipe", "pipeline", "burst", "seepage", "flowing water", "wet road"],
    "Low Water Pressure": ["pressure", "no water", "low pressure", "weak flow", "dry tap"],
    "Garbage Accumulation": ["garbage", "trash", "waste", "dump", "litter", "rotten", "smell", "kuda"],
    "Pothole": ["pothole", "pit", "hole in road", "gadda"],
    "Road Damage": ["road damage", "broken road", "crack", "road broken", "pavement", "damaged road"],
    "Streetlight Failure": ["streetlight", "street light", "lamp", "light not working", "dark street", "pole"],
    "Drainage Issue": ["drain", "drainage", "waterlogging", "overflow", "gutter", "clog", "blocked"],
    "Fallen Tree": ["tree", "fallen", "branch", "uprooted"],
    "Traffic Signal Failure": ["traffic signal", "traffic light", "signal not working"],
    "Air/Noise Pollution": ["pollution", "smoke", "dust", "noise", "air quality", "burning"],
    "Sewage Overflow": ["sewage", "sewer", "toilet overflow", "faecal"],
    "Encroachment": ["encroach", "illegal", "hawker", "construction on footpath"],
}

# Base severity (1..5) by category
CATEGORY_SEVERITY = {
    "Water Leakage": 4, "Low Water Pressure": 3, "Garbage Accumulation": 3,
    "Pothole": 4, "Road Damage": 3, "Streetlight Failure": 2,
    "Drainage Issue": 4, "Sewage Overflow": 5, "Fallen Tree": 4,
    "Traffic Signal Failure": 4, "Air/Noise Pollution": 3, "Encroachment": 2,
    "Other": 2,
}

# Categories considered "related" for incident fusion
CATEGORY_GROUPS = [
    {"Water Leakage", "Low Water Pressure", "Drainage Issue", "Sewage Overflow", "Road Damage", "Pothole"},
    {"Garbage Accumulation", "Drainage Issue", "Sewage Overflow"},
    {"Pothole", "Road Damage"},
    {"Streetlight Failure", "Traffic Signal Failure"},
    {"Fallen Tree", "Road Damage", "Traffic Signal Failure"},
    {"Air/Noise Pollution", "Garbage Accumulation"},
]

URGENCY_WORDS = ["urgent", "emergency", "dangerous", "accident", "hospital",
                 "school", "children", "injury", "fire", "collapse", "severe"]


def categories_related(a: str, b: str) -> bool:
    if a == b:
        return True
    return any(a in g and b in g for g in CATEGORY_GROUPS)


def department_for(category: str) -> str:
    return DEPARTMENT_MAP.get(category, "General Grievance Cell")


# ---------------------------------------------------------------------------
# Sarvam AI transport
# ---------------------------------------------------------------------------
def ai_available() -> bool:
    return bool(SARVAM_API_KEY)


def _chat(messages, temperature=0.2, max_tokens=2500):
    """Call Sarvam Chat Completions. Raises on any failure.

    `sarvam-105b` is a reasoning model: it emits a `reasoning_content` trace
    and the final answer in `content`. If the token budget is too small the
    answer can be null — so we use a generous budget and fall back to the
    reasoning trace if needed.
    """
    url = f"{SARVAM_BASE_URL}/v1/chat/completions"
    headers = {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "model": SARVAM_CHAT_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=SARVAM_TIMEOUT)
    resp.raise_for_status()
    msg = resp.json()["choices"][0]["message"]
    content = msg.get("content") or msg.get("reasoning_content")
    if not content:
        raise ValueError("empty model response (token budget exhausted)")
    return content


def _extract_json(text: str):
    """Pull the first JSON object out of an LLM reply."""
    if not text:
        return None
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Rule-based fallback engine
# ---------------------------------------------------------------------------
def _rules_classify(description: str, hint: str = None):
    text = (description or "").lower()
    scores = {}
    for cat, words in CATEGORY_KEYWORDS.items():
        s = sum(text.count(w) for w in words)
        if s:
            scores[cat] = s
    if hint and hint in CATEGORIES:
        scores[hint] = scores.get(hint, 0) + 1.5
    category = max(scores, key=scores.get) if scores else (hint or "Other")
    severity = CATEGORY_SEVERITY.get(category, 2)
    if any(w in text for w in URGENCY_WORDS):
        severity = min(5, severity + 1)
    confidence = 0.55 + min(0.4, 0.1 * scores.get(category, 0))
    return {
        "category": category,
        "severity": severity,
        "department": department_for(category),
        "confidence": round(min(0.97, confidence), 2),
        "summary": f"Classified as {category} based on report keywords.",
        "engine": "rules",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def classify_complaint(description: str, hint: str = None):
    """Classify a citizen complaint -> category, severity, department, summary."""
    if not ai_available():
        return _rules_classify(description, hint)
    system = (
        "You are CivicMind's complaint classification agent for an Indian "
        "municipal corporation. Classify the citizen complaint and respond with "
        "STRICT JSON only, no prose. Schema: "
        '{"category": one of ' + json.dumps(CATEGORIES) + ', '
        '"severity": integer 1-5, "department": string, '
        '"confidence": float 0-1, "summary": one short sentence}. '
        "Severity 5 = life-threatening/urgent, 1 = cosmetic. "
        "Use Indian municipal department names."
    )
    user = f"Complaint: {description}"
    if hint:
        user += f"\nCitizen-selected category (may be wrong): {hint}"
    try:
        out = _extract_json(_chat([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], temperature=0.1, max_tokens=2500))
        if not out or not out.get("category"):
            raise ValueError("bad model output")
        # Coerce the model's category onto our allowed list.
        raw = str(out.get("category", "")).strip()
        match = next((c for c in CATEGORIES if c.lower() == raw.lower()), None)
        if not match:
            match = next((c for c in CATEGORIES if c.lower() in raw.lower()
                          or raw.lower() in c.lower()), None)
        out["category"] = match or _rules_classify(description, hint)["category"]
        out["severity"] = max(1, min(5, int(out.get("severity", 3))))
        out["confidence"] = float(out.get("confidence", 0.8))
        out["department"] = department_for(out["category"])
        out["engine"] = "sarvam"
        return out
    except Exception as e:  # noqa: BLE001
        fallback = _rules_classify(description, hint)
        fallback["ai_error"] = str(e)[:200]
        return fallback


def investigate_incident(facts: dict):
    """Produce an explainable investigation for a fused incident."""
    fallback = _rules_investigate(facts)
    if not ai_available():
        return fallback
    system = (
        "You are CivicMind's incident investigation agent. You receive structured "
        "facts about a fused civic incident (many citizen reports grouped by "
        "location, time and category). Respond with STRICT JSON only: "
        '{"summary": string, "probable_cause": string, "why_linked": [string], '
        '"supporting_evidence": [string], "conflicting_evidence": [string], '
        '"impact": string, "next_checks": [string], "confidence": float 0-1}. '
        "Use confidence language ('probable', 'likely'). Never state uncertain "
        "findings as fact. Base everything strictly on the supplied facts."
    )
    try:
        out = _extract_json(_chat([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(facts)},
        ], temperature=0.2, max_tokens=3200))
        if not out or "summary" not in out:
            raise ValueError("bad model output")
        out["engine"] = "sarvam"
        return out
    except Exception as e:  # noqa: BLE001
        fallback["ai_error"] = str(e)[:200]
        return fallback


def recommend_action(facts: dict):
    """Generate a response plan for an incident."""
    fallback = _rules_action(facts)
    if not ai_available():
        return fallback
    system = (
        "You are CivicMind's municipal response-planning agent. Given incident "
        "facts, respond with STRICT JSON only: "
        '{"action_text": string, "assigned_team": string, "department": string, '
        '"eta_hours": number, "checklist": [string], '
        '"citizen_notification": string}. '
        "Be specific and actionable for an Indian municipal corporation."
    )
    try:
        out = _extract_json(_chat([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(facts)},
        ], temperature=0.3, max_tokens=2400))
        if not out or "action_text" not in out:
            raise ValueError("bad model output")
        out.setdefault("department", department_for(facts.get("category", "Other")))
        out.setdefault("eta_hours", 24)
        out.setdefault("checklist", [])
        out["engine"] = "sarvam"
        return out
    except Exception as e:  # noqa: BLE001
        fallback["ai_error"] = str(e)[:200]
        return fallback


def verify_resolution(facts: dict):
    """Verify whether an incident actually improved."""
    fallback = _rules_verify(facts)
    if not ai_available():
        return fallback
    system = (
        "You are CivicMind's resolution-verification agent. Given before/after "
        "signals for a civic incident, respond with STRICT JSON only: "
        '{"summary": string, "confidence": float 0-1, "verdict": '
        '"resolved" | "partially_resolved" | "reopen"}. '
        "If complaints remain high, recommend reopen."
    )
    try:
        out = _extract_json(_chat([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(facts)},
        ], temperature=0.1, max_tokens=2400))
        if not out or "summary" not in out:
            raise ValueError("bad model output")
        out["engine"] = "sarvam"
        return out
    except Exception as e:  # noqa: BLE001
        fallback["ai_error"] = str(e)[:200]
        return fallback


def priority_rationale(facts: dict):
    """Explain, in words, why an incident got its priority."""
    if not ai_available():
        return _rules_priority_reason(facts)
    system = (
        "You are CivicMind's priority agent. Given a priority score and the "
        "factors behind it, write ONE concise sentence (max 40 words) explaining "
        "the priority to a municipal officer. Plain text only."
    )
    try:
        text = _chat([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(facts)},
        ], temperature=0.3, max_tokens=1400).strip()
        return text or _rules_priority_reason(facts)
    except Exception:  # noqa: BLE001
        return _rules_priority_reason(facts)


def verify_evidence(kind, description, category, meta, flags, hard_fail, data_url=None):
    """
    Legitimacy check for a citizen's proof-of-issue photo or an officer's
    proof-of-resolution photo. Combines deterministic forensic checks with
    Sarvam AI reasoning; if a vision model is configured, the image is also
    sent to it.
    """
    fallback = _rules_verify_evidence(meta, flags, hard_fail)

    # Optional real image inspection (only when a vision model is configured).
    vision_note = None
    if data_url and SARVAM_VISION_MODEL:
        try:
            vision_note = _vision_check(data_url, kind, description, category)
        except Exception:
            vision_note = None

    if not ai_available():
        return fallback
    system = (
        "You are CivicMind's evidence-verification agent for an Indian municipal "
        "corporation. You decide whether a submitted photo is legitimate evidence. "
        "Respond with STRICT JSON only: "
        '{"verdict": "verified" | "needs_review" | "flagged", '
        '"confidence": float 0-1, "reasons": [short strings], '
        '"note": one short sentence}. '
        "Judge primarily from the provided automated_checks and whether the "
        "description is coherent with the stated category. "
        "If hard_check_failed is true, verdict MUST be 'flagged'. "
        "If automated_checks is empty and the description is coherent, verdict "
        "'verified'. If there are minor concerns, 'needs_review'. "
        "Do NOT say you cannot see the image — you are not asked to inspect pixels. "
        "Output only the JSON, no prose."
    )
    payload = {
        "evidence_type": kind,
        "description": description,
        "category": category,
        "image": {k: meta.get(k) for k in ("width", "height", "bytes", "mean", "std")},
        "automated_checks": flags,
        "hard_check_failed": hard_fail,
        "vision_observation": vision_note,
    }
    try:
        out = _extract_json(_chat([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload)},
        ], temperature=0.1, max_tokens=3000))
        if not out or out.get("verdict") not in ("verified", "needs_review", "flagged"):
            raise ValueError("bad model output")
        if hard_fail:
            out["verdict"] = "flagged"
        out.setdefault("reasons", flags)
        out.setdefault("confidence", 0.7)
        out["engine"] = "sarvam"
        return out
    except Exception as e:  # noqa: BLE001
        fallback["ai_error"] = str(e)[:200]
        return fallback


def _vision_check(data_url, kind, description, category):
    """Send the image to the configured vision model (best-effort)."""
    url = f"{SARVAM_BASE_URL}/v2/chat/completions"
    body = {
        "model": SARVAM_VISION_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": (
                f"A citizen submitted this photo as {kind} evidence for a "
                f"'{category}' civic report: {description}. In one or two "
                "sentences, describe what the image shows and whether it is "
                "consistent with that claim.")},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]}],
        "max_tokens": 400,
    }
    r = requests.post(url, headers={"api-subscription-key": SARVAM_API_KEY,
                                    "Content-Type": "application/json"},
                      json=body, timeout=SARVAM_TIMEOUT)
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    return (msg.get("content") or msg.get("reasoning_content") or "").strip()[:400]


# ---------------------------------------------------------------------------
# Rule-based fallbacks for the agent functions
# ---------------------------------------------------------------------------
def _rules_investigate(facts: dict):
    cats = facts.get("categories", [])
    n = facts.get("report_count", 0)
    spread = facts.get("spread_km", 0)
    dur = facts.get("duration_hours", 0)
    ward = facts.get("ward", "the area")
    cat = facts.get("category", "the reported issue")
    return {
        "summary": (f"{n} related reports of {', '.join(cats) or cat} were grouped "
                    f"within {spread} km in {ward} over about {dur:.0f} hours, "
                    f"pointing to one probable {cat.lower()} incident."),
        "probable_cause": f"Likely a shared underlying {cat.lower()} affecting the {ward} area.",
        "why_linked": [
            f"All reports fall within {spread} km of each other",
            f"Reported inside a {dur:.0f}-hour window",
            f"Categories are related: {', '.join(cats) or cat}",
        ],
        "supporting_evidence": [
            f"{n} independent citizen reports",
            f"Tight geographic spread ({spread} km)",
            "Consistent category/description signals",
        ],
        "conflicting_evidence": ["No sensor feed attached — evidence is report-based only"],
        "impact": facts.get("impact", f"Approx. {facts.get('affected_people', 0)} citizens potentially affected"),
        "next_checks": [
            "Inspect the site and confirm the root cause",
            "Check nearby infrastructure records for recent faults",
            "Collect field photos before and after repair",
        ],
        "confidence": facts.get("confidence", 0.75),
        "engine": "rules",
    }


def _rules_action(facts: dict):
    cat = facts.get("category", "Other")
    ward = facts.get("ward", "the area")
    dept = department_for(cat)
    plans = {
        "Water Leakage": f"Repair the leaking main pipeline section in {ward}",
        "Low Water Pressure": f"Inspect and restore supply pressure in {ward}",
        "Garbage Accumulation": f"Clear the garbage hotspot in {ward} and schedule daily pickup",
        "Pothole": f"Fill and level the potholes on the affected stretch in {ward}",
        "Road Damage": f"Resurface the damaged road section in {ward}",
        "Streetlight Failure": f"Replace faulty streetlight units in {ward}",
        "Traffic Signal Failure": f"Repair the traffic signal at the affected junction in {ward}",
        "Drainage Issue": f"Clear the blocked drain and pump out water in {ward}",
        "Sewage Overflow": f"Clear the sewage blockage and sanitise the area in {ward}",
        "Fallen Tree": f"Remove the fallen tree and clear the road in {ward}",
        "Air/Noise Pollution": f"Inspect the pollution source and issue corrective notice in {ward}",
        "Encroachment": f"Conduct an anti-encroachment drive in {ward}",
        "Other": f"Dispatch an inspection team to {ward}",
    }
    return {
        "action_text": plans.get(cat, plans["Other"]),
        "assigned_team": f"{dept} field team",
        "department": dept,
        "eta_hours": 24 if cat not in ("Sewage Overflow", "Traffic Signal Failure") else 8,
        "checklist": [
            "Verify the reported issue on site",
            "Complete the repair / clearance work",
            "Capture before-and-after photos",
            "Update status and close the incident",
        ],
        "citizen_notification": (f"A repair team from the {dept} has been assigned to the "
                                 f"{cat.lower()} reported near {ward}."),
        "engine": "rules",
    }


def _rules_verify(facts: dict):
    before = facts.get("before_metric", 0)
    after = facts.get("after_metric", 0)
    reduction = 0 if not before else (before - after) / before * 100
    if reduction >= 70:
        verdict, conf = "resolved", 0.9
    elif reduction >= 30:
        verdict, conf = "partially_resolved", 0.7
    else:
        verdict, conf = "reopen", 0.6
    return {
        "summary": (f"Complaint volume fell from {before} to {after} "
                    f"({reduction:.0f}% reduction) after the intervention. "
                    f"Verdict: {verdict.replace('_', ' ')}."),
        "confidence": conf,
        "verdict": verdict,
        "engine": "rules",
    }


def _rules_priority_reason(facts: dict):
    return (f"Priority {facts.get('priority_label','Medium')} "
            f"(score {facts.get('priority_score',0)}): {facts.get('report_count',0)} reports, "
            f"{facts.get('affected_people',0)} citizens affected, "
            f"{facts.get('spread_km',0)} km spread.")


def _rules_verify_evidence(meta, flags, hard_fail):
    if hard_fail:
        return {"verdict": "flagged", "confidence": 0.9,
                "reasons": flags or ["Failed automated legitimacy checks"],
                "note": "The submitted photo did not pass the automated evidence checks.",
                "engine": "rules"}
    if flags:
        return {"verdict": "needs_review", "confidence": 0.6, "reasons": flags,
                "note": "Photo accepted but flagged for officer review.", "engine": "rules"}
    return {"verdict": "verified", "confidence": 0.85,
            "reasons": ["Photo passed the automated evidence checks"],
            "note": "Photo appears to be valid, unique evidence.", "engine": "rules"}
