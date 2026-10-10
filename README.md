# CivicMind

**Civic operations intelligence.** Citizens report problems in English, हिन्दी or मराठी. CivicMind groups related
reports into incidents, connects them to the **recorded underground utility network** (pipes, cables, valves,
switches), traces what the affected asset connects to, shows the operator contact and candidate isolation points,
and takes each case through an accountable, proof-backed response workflow.

Built for **Build with भारत 4.0** · Team **CodeHigh** (MIT ADT Pune). This is a hackathon prototype. It is **not
connected to any municipal system**; demo data is fictional and labelled as such everywhere.

---

## Three portals, one application

| Portal | Entry | For | Highlights |
|---|---|---|---|
| Citizen | `/citizen` → `citizen.html` | residents | report in EN/HI/MR with a review-first assistant, map pin, photo, private tracking code, status timeline in your language, notifications |
| Officer | `/officer` → `dashboard.html`, `map.html`, `incident.html` | municipal staff | priority queue, live map with **utility layers**, asset panel with **network tracing**, isolation candidates, **Utility Copilot**, incident briefing, operator coordination, plans, evidence, verification |
| Admin | `/admin` → `admin.html`, `data-sources.html` | administrators | users and roles, utility data overview, **GeoJSON/CSV import with preview → confirm**, TinyFish public-source discovery, findings, audit log |

Sign-in sends each user to the portal of their **server-side** role. Pages re-check the role with the server, and
every API call is authorised on the server regardless of which page is open.

## Technology

Python 3.11+ · FastAPI · SQLite (WAL) · HTML/CSS/vanilla JavaScript · Leaflet + OpenStreetMap tiles · Chart.js ·
optional Sarvam AI · TinyFish Search/Fetch/Agent (server-side). One modular monolith, one database.

## Quick start (Windows)

```powershell
run_demo.bat            # installs dependencies, builds/updates the isolated DEMO database, starts the app
```

Open **http://localhost:8000**. Demo logins are generated locally into `data/demo/demo_credentials.txt`
(never served by the API). `run_demo.bat --reset` rebuilds the demo data. macOS/Linux: `./run_demo.sh`.

Regular (non-demo) use:

```powershell
cd backend
python -m pip install -r requirements.txt
python manage.py create-user --email you@example.org --name "Your Name" --role admin   # once
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Always open the app through the server, not by double-clicking HTML files.

## Configuration

- `.env` (gitignored; template in `.env.example`, placeholders only):
  - `SARVAM_API_KEY` — optional AI. Without it, rule-based engines handle everything.
  - `TINYFISH_API_KEY` — public data-source discovery. Without it the Data sources page says "not configured".
  - `TINYFISH_MOCK_MODE=true` — fictional, clearly labelled TinyFish responses for demos/tests only.
  - `TINYFISH_ENABLE_AGENT` — off by default (metered browser automation).
  - `CIVICMIND_SECRET` — token signing secret (auto-generated locally if empty).
- `data/civicmind_config.json` — city, wards, categories, departments, grouping and risk-rule thresholds.
  This configuration is read-only in the admin UI (edit the file and restart).

## Database and migrations

`init_db()` runs on every start and is **additive only**: it creates missing tables, adds missing columns and
indexes, and never drops or rewrites data. The utility network tables are all prefixed `utility_` and created by
`services/utility_network/schema.py::init_schema` inside the same transaction. Demo data is **never** written at
start-up — only by `seed_demo.py`, which refuses to touch a database that is not marked as a demo database.

## Utility network model

- **Assets** (`utility_assets`): water, sewer, storm, electricity, gas, telecom, road; Point assets (sources,
  junctions, valves, switches, transformers…) double as network nodes, LineString assets are mains/cables/sewers.
  Technical attributes are stored only when a source provides them — unknown values stay unknown.
- **Connections** (`utility_connections`) are explicit records with a direction (`downstream` = flow from→to,
  `bidirectional`, `unknown`). **Geometry is never used to create a connection** — lines touching on the map are
  not connected unless a record says so.
- **Provenance** on every record: `verified_as_built`, `official_unverified`, `planned_design`,
  `approximate_unverified`, `synthetic_demo`; plus `verification_status` (verified / unverified / disputed).
- **Tracing** (`services/utility_network/graph.py`): deterministic BFS over recorded connections; upstream,
  downstream or both; hop/node limits; loop detection; unknown-direction links and missing links reported as gaps.
- **Isolation candidates**: the nearest recorded control device on each traced branch, with the path and whether
  every record on it is verified. They are **candidates** — the authorised operator confirms the actual control
  point. CivicMind never operates or instructs anyone to operate valves, switches or gas controls.
- **Incident context**: compatible assets (category → utility type) whose recorded geometry lies within 120 m of a
  report, with distance and reason. Officers confirm or reject; proximity is never presented as cause.
- **Findings** (`utility_findings`, rules U1–U6): repeated reports on an asset, recurrence after recorded work,
  critical asset in a severe incident, isolation candidates relying on unverified records, no recorded source
  upstream, conflicting open plans. Each finding names its rule and triggering records.
- **Utility Copilot / incident briefing**: answers are assembled from records with cited IDs. If Sarvam is
  configured it may only rephrase those facts; its text is rejected if it mentions any ID not in the evidence.
  Fictional contacts are never treated as usable operator contacts.

## GIS import formats

Admin → *Import utility records* (preview first, then confirm):

- **GeoJSON** FeatureCollection in EPSG:4326 (`[longitude, latitude]`), Point and LineString features with
  `asset_id, utility_type, asset_type, name` (+ optional `operational_status, operator_org, criticality,
  diameter_mm, material, install_year, depth_m, voltage_kv, …`). Optional top-level `connections` list of
  `{from_asset_id, to_asset_id, connection_type, direction}`. Other CRSs are rejected — re-project first.
- **CSV** of point assets (`asset_id, utility_type, asset_type, name, lat, lng, …`) or of connections
  (`from_asset_id, to_asset_id, connection_type, direction`).

The preview reports accepted, duplicate (never overwritten), rejected, possibly swapped-coordinate and
missing-relationship records. Confirmed records are stored as **unverified**; an admin records verification
separately. Shapefile/KML/PDF extraction are not implemented.

## Public data-source discovery (TinyFish)

Admin → **Data sources**: TinyFish Search finds candidate public sources; TinyFish Fetch extracts up to 10 selected
pages; the admin reads the extracted text and approves or rejects it; an approved source can be used as the
provenance of a utility import ("Use as the source of a utility import"). Web content is untrusted, is never
imported as geometry automatically, and is at best `official_unverified`.

1. Put your key in `.env` (never in code or Git): `TINYFISH_API_KEY=...`
2. Restart — the server log shows `TinyFish: configured (live)`.
3. Live check: Data sources → search *Pune Municipal Corporation / water supply network* → select → *Fetch
   selected* → open → approve → *Show import source metadata*. Results must be tagged **Live**, not Mock.

## Multilingual reporting

Citizens pick English, हिन्दी or मराठी (saved to their profile). The report form, progress steps, status names and
"what happens next" follow the language. *Check my report* suggests a category, severity and follow-up questions
(rule-based with Hindi/Marathi keywords, or Sarvam AI when configured) and — only with an AI provider — an English
translation the citizen can edit. Suggestions are applied only by the citizen; the translation is stored separately
and only if they tick that they reviewed it. Voice input is **not implemented**.

## Tests

```powershell
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest
```

Every test uses a fresh temporary database; Sarvam and TinyFish are mocked; two Node-based checks verify that every
API path used by the JavaScript exists and that renderers escape hostile text (skipped if Node is missing).
There is no automated real-browser test; the browser walkthrough below was done manually.

## Demo walkthrough (fictional data)

1. Landing page → sign in as the demo **citizen** → switch to मराठी → describe a leak → *Check my report* → apply
   the category → pin the map → submit; note the tracking code.
2. Sign in as the demo **officer** → Operations shows *Utility network findings* (repeated reports, leak 25 days
   after a recorded repair) → open the water-leak incident (*Probable Water Leakage — Kothrud*).
3. *Utility network context*: `WM-DEMO-03` is the nearest candidate (≈3 m) → *Confirm relevant* → *Generate incident
   briefing* (facts with record IDs, hypotheses, data gaps, checklist).
4. *Open on utility map* → asset panel → *Find isolation candidates*: `V-DEMO-02` upstream and `V-DEMO-04`
   downstream, both on verified paths; the loop link `UC-DEMO-13` has unknown direction and is flagged.
   Ask the Copilot "What is the upstream source?". Click `WM-DEMO-102` to show a branch with **no recorded source**.
5. Back on the incident → *Utility operator coordination*: record *operator contacted* → *isolation confirmed by
   operator* (reference required) → approve the plan → *crew dispatched* → start → complete with
   `data/demo/sample_proof_photo.jpg` → the incident is verified and the timeline updated.
6. Sign in as the demo **admin** → utility data overview, findings, audit log → *Import utility records* preview
   (duplicates and missing relationships are reported) → Data sources (TinyFish; Mock unless a key is set).

Fallbacks: without Sarvam everything is rule/record-based; without TinyFish the page states it is not configured
(or use mock mode); if map tiles fail, markers and panels still work; uploads that fail checks are rejected with
reasons.

## Security notes

Server-side authorisation on every route (see [docs/SECURITY.md](docs/SECURITY.md)); citizens never receive
utility topology, contacts or other residents' data; private evidence store with content validation and EXIF
removal; HMAC tokens with revocation; login throttling; CSP and security headers; structured errors without stack
traces; API keys only on the server. Rotate any credential that was ever shared in an archive or chat.

## Known limitations

- Ward assignment uses the nearest ward centre, not official boundaries.
- Utility data in the demo is synthetic; no official GIS dataset is connected.
- The Copilot waits for Sarvam (up to its 25 s timeout) before falling back to the record-based answer.
- Voice input, Shapefile/KML import and PDF extraction are not implemented.
- In-process throttles and caches assume a single server instance; SQLite only.
- Hindi/Marathi interface strings should be reviewed by native speakers.
- `CivicMind_Deployment_Guide.docx` describes an older version.

## Project structure

```
civicmind/
├─ backend/
│  ├─ main.py · config.py · database.py · auth.py · manage.py · seed_demo.py
│  ├─ routes/      auth, complaints, incidents, actions, infrastructure, dashboard, admin, realtime, config,
│  │               data_sources (TinyFish), assistant, coordination, utility_network
│  ├─ services/    complaints, clustering, priority, assets, risk, actions, evidence, ai, assistant, coordination,
│  │               geo, bootstrap, tinyfish/ (client, URL safety, mock), utility_network/ (schema, model, geometry,
│  │               registry, graph, matching, findings, importer, copilot, demo_data)
│  └─ tests/
├─ frontend/       index, citizen, dashboard, incident, map, assets, admin, data-sources (+ js/, css/)
├─ data/           civicmind_config.json · demo/ (gitignored)
└─ docs/           SECURITY.md · CIVICMIND_INTEGRATION_CONTRACT.md · INTEGRATION_REPORT.md · DEMO_SCRIPT.md
```

## Deployment notes

Docker: `docker build -t civicmind .` then `docker run -p 8000:8000 -v civicmind-data:/data -e CIVICMIND_SECRET=... civicmind`.
Serve behind HTTPS. Render's free plan has an ephemeral disk (data lost on restart). OpenStreetMap's public tile
servers are for light use only — use a tile provider for production.

## Team

Spparsh Mansuke · Chaitanya Khapake — MIT ADT University, Pune.
