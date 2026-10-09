"""Frontend checks that run without a browser.

1. Every API path referenced by the JavaScript exists on the backend.
2. XSS regression: the incident/dashboard renderers are executed in Node with
   hostile strings; the output must contain them only in escaped form.
These are NOT a substitute for end-to-end browser testing.
"""
import json
import os
import re
import shutil
import subprocess

import pytest

import config
import main

JS_DIR = os.path.join(config.FRONTEND_DIR, "js")


def _route_patterns():
    pats = []
    for r in main.app.routes:
        path = getattr(r, "path", None)
        if path and path.startswith("/api/"):
            pats.append(re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", path) + "$"))
    return pats


def test_every_frontend_api_call_has_a_backend_route():
    pats = _route_patterns()
    missing = []
    for name in os.listdir(JS_DIR):
        src = open(os.path.join(JS_DIR, name), encoding="utf-8").read()
        for m in re.finditer(r"""['"`](/?api/[^'"`\s]*)""", src):
            raw = m.group(1)
            path = "/" + raw.lstrip("/")
            path = re.sub(r"\$\{[^}]*\}", "X", path).split("?")[0]
            if path.endswith("/"):
                path += "X"  # concatenated id, e.g. '/api/complaints/' + id
            if not any(p.match(path) for p in pats):
                missing.append(f"{name}: {raw}")
    assert not missing, missing


NODE = shutil.which("node")
EVIL = '</textarea><img src=x onerror=alert(1)>"\'<script>alert(2)</script>'

HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const ctx = { console, setTimeout, setInterval, clearInterval, URLSearchParams, encodeURIComponent,
  location: { protocol: 'http:', search: '?id=1', pathname: '/incident.html', href: '' },
  localStorage: { getItem: (k) => k === 'cm_user' ? JSON.stringify({ role: 'officer', name: 'O' }) : 't', setItem(){}, removeItem(){} },
  document: { addEventListener(){}, getElementById(){ return null; }, querySelectorAll(){ return []; } },
  navigator: {}, L: undefined };
vm.createContext(ctx);
for (const f of ['api.js', 'common.js', 'incident.js']) vm.runInContext(fs.readFileSync(process.argv[2] + '/' + f, 'utf8'), ctx);
const data = JSON.parse(process.argv[3]);
vm.runInContext('inc = ' + JSON.stringify(data), ctx);
process.stdout.write(vm.runInContext('staffView(inc) + citizenView(' + JSON.stringify(data.citizen) + ')', ctx));
"""


@pytest.mark.skipif(not NODE, reason="node not installed")
def test_incident_renderer_escapes_untrusted_text(tmp_path):
    action = {"id": 1, "status": "pending", "action_text": EVIL, "assigned_team": EVIL, "department": EVIL,
              "eta_hours": 24, "checklist": [EVIL, "ok"], "source": "rules", "has_proof": False,
              "rejection_reason": EVIL}
    inc = {
        "view": "staff", "id": 1, "public_id": "INC-1", "title": EVIL, "category": EVIL, "status": "active",
        "ward": EVIL, "created_at": "2026-01-01 00:00:00", "report_count": 1, "distinct_reporters": 1,
        "spread_km": 0, "priority": {"label": "High", "score": 61, "factors": [
            {"label": EVIL, "points": 10, "max": 35, "detail": EVIL}], "reasons": [EVIL], "model": EVIL},
        "investigation": {"summary": EVIL, "why_linked": [EVIL], "engine": "rules"},
        "complaints": [{"id": 1, "public_id": EVIL, "category": EVIL, "description": EVIL, "status": "clustered",
                        "severity": 3, "latitude": 18.5, "longitude": 73.8, "created_at": "2026-01-01 00:00:00",
                        "citizen_name": EVIL, "has_photo": False, "asset_match": None, "is_synthetic": False}],
        "actions": [action, {**action, "id": 0, "status": "rejected"}], "current_action": action,
        "can_generate_plan": False, "resolution": None,
        "asset": {"id": 1, "asset_code": EVIL, "criticality": "critical", "type_label": EVIL, "name": EVIL,
                  "criticality_reason": EVIL, "matched_reports": 1, "min_distance_m": 5, "is_synthetic": 1,
                  "recent_maintenance": [{"event_type": "repair", "performed_at": "2026-01-01", "outcome": EVIL,
                                          "data_source": EVIL, "is_synthetic": 1}]},
        "findings": [{"id": 1, "severity": "high", "rule_title": EVIL, "explanation": EVIL,
                      "recommended_step": EVIL, "status": "open", "is_synthetic": 0}],
        "timeline": [{"actor": EVIL, "detail": EVIL, "created_at": "2026-01-01 00:00:00"}],
        "grouping_basis": {"radius_km": 1.5, "window_hours": 48, "min_reports": 3, "categories": [EVIL]},
        "citizen": {"view": "citizen", "public_id": EVIL, "title": EVIL, "status": "active", "report_count": 2,
                    "priority": {"label": "High"}, "current_action": {"status": "approved", "action_text": EVIL,
                    "department": EVIL}, "resolution": None, "timeline": [{"action": EVIL, "created_at": ""}],
                    "my_reports": [{"public_id": EVIL, "status": "clustered"}]},
    }
    script = tmp_path / "h.js"
    script.write_text(HARNESS, encoding="utf-8")
    out = subprocess.run([NODE, str(script), JS_DIR, json.dumps(inc)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert out.returncode == 0, out.stderr
    html = out.stdout
    assert len(html) > 1000
    for raw in ("<img src=x", "<script>", "</textarea><img", "\" onerror"):
        assert raw not in html, raw
    assert "&lt;/textarea&gt;&lt;img src=x onerror=alert(1)&gt;" in html
    # the edit-form textareas specifically
    assert re.search(r'<textarea id="eCheck">&lt;/textarea&gt;', html)
