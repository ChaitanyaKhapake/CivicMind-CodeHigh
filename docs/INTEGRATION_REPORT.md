# CivicMind — integration report (Claude track)

Status date: 2026-10-10 · Branch `claude-platform` (from baseline `7abba6d` on `master`) · not pushed.

## Summary

| Gate | Status | Evidence |
|---|---|---|
| Baseline | **PASS** | Baseline suite 86 passed before any change; startup/test commands below; work isolated on `claude-platform`; no database reset (smoke run used a throwaway DB). |
| TinyFish configured | **PASS (mocked)** · live **BLOCKED** | Search `GET` / Fetch `POST` built from docs.tinyfish.ai (verified 2026-10-10), `X-API-Key` server-side only. 65 mocked tests. No `TINYFISH_API_KEY` in this environment, so no live call was made. |
| Data import safety | **PASS (TinyFish side)** · preview/confirm **PENDING Astra** | Results stored as candidates; fetched text stored as untrusted snapshots pending review; tests assert no `assets`/`utility_*` writes. Source metadata only for reviewed snapshots. |
| Portal integration | **PASS** | Role-based home from server, `/citizen` `/officer` `/admin` `/login` redirects, page role re-check against `/api/auth/me`, existing complaint flow intact (all baseline tests pass). |
| Utility integration | **BLOCKED** | Astra handoff not received in this workspace; nothing to register or mount yet. Wiring steps below. |
| Water-leak scenario | **PARTIAL** | Workflow side done and tested end-to-end (report → incident → operator contacted → isolation confirmed by operator → plan → crew dispatched → proof → verified). Trace / candidate controls / contact panel need Astra's module. |
| Final quality | **PASS for available scope** | 168 passed, 0 skipped. No secrets committed (`.env` ignored; `.env.example` placeholders only). |

## How to run

```bash
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Demo without a TinyFish key: set `TINYFISH_MOCK_MODE=true` (results are labelled Mock/fictional).
Live: set `TINYFISH_API_KEY` in `.env`, restart, follow the README "manual live smoke test".

## Test results (executed)

`python -m pytest` on Windows, Python 3.14.3, Node 25.8.1 → **168 passed in ~11 s, 0 skipped**.

| File | Tests | Covers |
|---|---|---|
| `test_tinyfish.py` (new) | 65 | Search success/normalization; missing key; invalid key (no retry); timeout (Search retried, Fetch not); 400/402/403/429/5xx mapping; free-allowance exhausted; malformed JSON/shape; provider redirect not followed; key only sent to `https://*.tinyfish.ai`; Fetch mixed success/failure, unsafe redirect discarded, unrequested results ignored, domain-change + truncation warnings, >10 URL cap before any call, unsafe URLs never sent, missing results; cache; Agent bounded + never retried; mock mode labelled; key never logged; 26 URL-safety rejections + 5 normalizations + DNS-rebinding checks; routes admin-only (citizen/officer 403, anon 401); not-configured 503 while app keeps working; discover → select → fetch → review → source-metadata flow with **no asset/utility writes**; fetch limits; provider errors without key leakage; Agent disabled by default; Agent domain restriction + daily cap. |
| `test_multilingual.py` (new) | 12 | Honest capabilities without AI; Hindi and Marathi rule-based classification and detection; original text preserved byte-for-byte; no translation faked; English needs none; validation/access/throttle; mocked provider output validated (clamping, unknown keys dropped, unsupported category → rules); provider failure fallback; submission stores original + reviewed translation separately; language preference. |
| `test_coordination_portals.py` (new) | 5 | Portal redirects; server-chosen home per role; full water-leak coordination sequence with prerequisite 409s; staff-only access; no write route operates field equipment. |
| `test_frontend.py` (extended) | 2 | Every JS API path exists; Node XSS harness now also renders the coordination card and translations with hostile strings. |
| Baseline files | 84 | Unchanged, all passing. |

### Manual smoke run (browser pane, isolated temp DB, AI off, TinyFish mock)

- Admin sign-in → Admin portal; Data sources page: mock badge, usage counters, discovery of 3 labelled mock
  candidates, select 2 → fetch → open → plain-text content + provenance → approve → source metadata shows
  `provenance_class: synthetic_demo` (mock content never becomes `official_unverified`).
- Citizen sign-in → citizen portal; switched to मराठी (labels switched, preference persisted); Marathi leak report →
  *Check my report* → Water Leakage suggestion, Marathi follow-up questions, honest "translation unavailable"
  notice; applied category explicitly; submitted. DB: description stored exactly as typed, `original_language=mr`,
  no translation, `assistant_engine=rules`.
- Officer sign-in → Operations portal; incident page coordination card recorded "operator contacted"; attempting
  "crew dispatched" first was refused with the prerequisite message. Officer opening `/admin` was sent back to
  Operations. No server errors; the only console error was the expected 409.

## What changed on `claude-platform`

New: `backend/services/tinyfish/{__init__,client,url_safety,mock}.py`, `backend/routes/data_sources.py`,
`backend/services/assistant.py`, `backend/routes/assistant.py`, `backend/services/coordination.py`,
`backend/routes/coordination.py`, `frontend/data-sources.html`, `frontend/js/data-sources.js`,
`frontend/js/i18n.js`, three test files, `docs/CIVICMIND_INTEGRATION_CONTRACT.md`, this report.

Changed: `backend/config.py` (TinyFish + language settings), `backend/database.py` (additive tables/columns,
schema_version 4), `backend/main.py` (routers, portal redirects, startup status line), `backend/auth.py`
(`preferred_language` in the current-user row), `backend/routes/{auth_routes,complaints,common,incidents}.py`,
`backend/services/{ai,complaints}.py` (Indic keywords; language metadata), `frontend/{citizen,admin}.html`,
`frontend/js/{api,common,citizen,incident}.js`, `frontend/css/style.css`, `.env.example`, `README.md`,
`docs/SECURITY.md`, `backend/tests/test_frontend.py`.

Schema changes are additive only (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`) and run
automatically on start; existing databases keep their data.

## Remaining issues (exact)

1. **Astra handoff not received.** Not done yet: router registration, schema initializer call, map module
   mount, `/api/incidents/{id}/utility-context` in the incident page, TinyFish source → import preview → confirm
   wiring, role-scoped utility tests, map-component test. Steps are in "Integration pass" below.
2. **Live TinyFish not verified (BLOCKED: no key).** First live run should confirm Search result fields
   (`position`, `site_name`, `title`, `snippet`, `url`, `date`) and Fetch `results`/`errors` shapes; the
   normalizer drops anything unexpected rather than failing.
3. **Contract proposals P1–P9** (`docs/CIVICMIND_INTEGRATION_CONTRACT.md` §B4) need the integrator's sign-off for
   both tracks — most importantly P1 (`utility_` table prefix, because `assets`, `asset_maintenance` and
   `risk_findings` already exist) and P5 (Python entry points for the merge).
4. Legacy `POST /api/assets/import` still persists point assets without a preview (pre-contract; P4).
5. Hindi/Marathi interface strings need native-speaker review; only the citizen report page and its metrics
   are translated (status names, notifications and other pages remain English).
6. Translation needs Sarvam AI; its assistant path is tested with a mocked transport only (no live AI call was
   made, to avoid paid calls).
7. The blueprint's light cool-grey theme is not applied yet — per the plan the consistency pass comes after
   feature integration; new screens reuse the existing design tokens.
8. In-process state: assistant throttle and TinyFish cache are per process (fine for the single-instance
   deployment documented in the README).
9. DNS safety checks are not pinned to the connection; CivicMind itself never connects to admin-entered URLs
   (TinyFish fetches them on its infrastructure), so this is defence in depth, documented in SECURITY.md.
10. A synchronous Agent run can hold a worker thread for up to `TINYFISH_AGENT_MAX_DURATION_SECONDS + 30` s.

## Integration pass (to run when Astra's branch arrives)

1. Review the file list against contract §B8; reject edits outside Astra-owned paths.
2. `git merge --no-ff astra-utility` (or cherry-pick) into `claude-platform`.
3. `backend/database.py::init_db()` → call Astra's idempotent `init_schema(conn)` inside the existing transaction.
4. `backend/main.py` → `from routes import utility_network`; include `utility_network.router`.
5. `frontend/map.html` → load `js/utility-network.js` after `map.js`; pass the existing Leaflet map and `CM.api`.
6. `frontend/js/incident.js` → staff view fetches `/api/incidents/{id}/utility-context`; show candidate assets,
   trace link, uncertainty; feed `asset_ref` / `contact_ref` into the coordination form (verified contacts only;
   synthetic ones labelled DEMO ONLY).
7. `frontend/js/data-sources.js` → for reviewed snapshots, send `source-metadata` + admin-supplied records to
   `/api/utility/import/preview`; show validation; `confirm` only on an explicit admin click.
8. Tests: router registered; schema on a temp DB; response shapes; civilian cannot read gas/electric topology or
   contacts; provenance + synthetic markers end-to-end; full water-leak scenario including trace.
9. Run the full suite; update this report.

## Demo runbook (current state)

1. `run_demo.bat` (or `TINYFISH_MOCK_MODE=true` + uvicorn) and sign in as admin → **Data sources** → search →
   fetch → review → source metadata. Point out the Mock badges and the untrusted-content notice.
2. Sign in as a citizen → switch to हिन्दी/मराठी → write a report → *Check my report* → apply the category →
   pin → submit. Show the stored original text.
3. Sign in as an officer → open the incident → record operator contacted → isolation confirmed by operator →
   approve plan → crew dispatched → start → complete with `data/demo/sample_proof_photo.jpg`.
