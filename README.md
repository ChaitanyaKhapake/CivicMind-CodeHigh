# CivicMind

**Civic complaint intelligence for municipal teams.** CivicMind turns scattered citizen complaints into
incidents, links them to the infrastructure behind them (a specific streetlight, road segment or drain),
flags infrastructure risks with explainable rules, ranks the work with a transparent score, and tracks each
response through an accountable, proof-backed workflow.

Built for **Build with भारत 4.0** · Team **CodeHigh** (MIT ADT Pune) · Sustainability & Social Impact.
This is a hackathon prototype. It is not connected to any municipal system.

---

## Quick start

Requires Python 3.11+. Verified locally on Python 3.14; the Docker image uses 3.12 (image build not tested here).

### Demo (fictional data, recommended for presentations)

```powershell
run_demo.bat            # Windows
./run_demo.sh           # macOS / Linux
```

This installs dependencies, builds an **isolated** demo database at `data/demo/civicmind_demo.db`
(your regular database is never touched), and starts the app at **http://localhost:8000**.

- Demo logins (generated locally, never served by the API): `data/demo/demo_credentials.txt`
- A synthetic proof photo for the officer step: `data/demo/sample_proof_photo.jpg`
- Rebuild the demo from scratch: `run_demo.bat --reset` / `./run_demo.sh --reset`
- Set `CIVICMIND_DEMO_PASSWORD=<8+ chars>` **before the first seed** if you want one shared demo password.

Everything in the demo is fictional and shown with a **Synthetic** tag. See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

### Regular use

```powershell
cd backend
python -m pip install -r requirements.txt
python manage.py create-user --email you@example.org --name "Your Name" --role admin   # once
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

`run.bat` / `run.sh` do the same. The database is `backend/civicmind.db`; private photos go to
`private/evidence/`. Both are created automatically and are gitignored. Citizens register themselves;
admins create officer accounts in the admin console or with `manage.py`.

> On Windows use `python`, not `python3`. Always open the app through the server (http://localhost:8000),
> not by double-clicking the HTML files.

### Tests

```powershell
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest
```

The suite uses a fresh temporary database per test, never calls the live AI provider or TinyFish (both are
mocked), and includes two browser-free frontend checks (API-path coverage and a Node-based XSS rendering
test; skipped if Node is not installed). There is no automated real-browser test.

### Portals

`/citizen`, `/officer` and `/admin` open the Civilian, Officer and Admin portals (`citizen.html`,
`dashboard.html`, `admin.html`). Sign-in sends each user to the portal of their **server-side** role; pages
re-check the role with the server, and every API call is authorised on the server regardless of the page.

### Public data-source discovery (TinyFish)

Admins open **Data sources** to find official public sources (GIS pages, open-data catalogues, contact
directories) with TinyFish Search, fetch up to 10 selected pages with TinyFish Fetch, read the extracted text
and approve or reject each one. Approved sources provide provenance metadata for the utility import preview.
Nothing found or fetched becomes an infrastructure record without that preview and an admin confirmation.

1. Put your key in `.env` (never in code or Git): `TINYFISH_API_KEY=...`
2. Restart; the server log shows `TinyFish: configured (live)`.
3. Manual live smoke test: Admin → Data sources → search for e.g. *Pune Municipal Corporation / water supply
   network*, select one result, *Fetch selected*, open it, approve it, *Show import source metadata*.
   Check that results are tagged **Live**, not Mock.

`TINYFISH_MOCK_MODE=true` returns fictional, clearly labelled results for demos without a key. The optional
Agent (`TINYFISH_ENABLE_AGENT`) is off by default; it is read-only, limited to domains of selected candidates,
capped per day and metered by TinyFish — check pricing first.

### Reporting in English, Hindi or Marathi

Citizens choose a language (saved to their profile); the report form's labels follow it. *Check my report*
suggests a category, severity and follow-up questions (rule-based, or Sarvam AI when configured) and — only
with an AI provider — an English translation the citizen can edit. The citizen applies suggestions explicitly;
the translation is included only if they tick that they reviewed it. The original words are always what is
stored as the description; the translation is kept separately for officers.

### Utility operator coordination

On an incident, officers record coordination with the utility operator: operator contacted, guidance received,
isolation confirmed by the operator (or not required), crew dispatched. Isolation steps need a prior contact
record; a dispatch needs the operator's isolation decision. CivicMind never operates valves, breakers or gas
controls — it records what the authorised operator confirmed.

See [docs/CIVICMIND_INTEGRATION_CONTRACT.md](docs/CIVICMIND_INTEGRATION_CONTRACT.md) for the shared contract
with the Utility Network subsystem and [docs/INTEGRATION_REPORT.md](docs/INTEGRATION_REPORT.md) for status.

---

## How it works

`Report → Group → Link to asset → Prioritise → Plan → Act → Verify`

1. **Report** — a citizen picks a category, describes the problem, pins the location and may add a photo.
   They receive a reference (`CMP-00012`) and a **private tracking code**.
2. **Classify** — Sarvam AI (if configured) or the rule-based engine suggests category and severity. The UI
   always shows which engine ran. AI output is schema-validated and cannot change any state.
3. **Group** — reports of the same or configured-related category within 1.5 km and 48 h are grouped into an
   incident (minimum 3). A new matching report joins the existing open incident instead of creating a duplicate.
4. **Link** — each report is matched to the nearest *compatible* asset within 150 m (e.g. a streetlight report
   only matches streetlights). No compatible asset nearby → no match.
5. **Prioritise** — a bounded 0–100 score: severity (35) + linked reports (20) + time unresolved (15) +
   category safety weight (15) + critical-asset link (15). Every factor is shown.
6. **Risk findings** — rules run over real records: repeated complaints on one asset (A), a report soon after
   a repair — *possible* recurrence (B), critical-asset incident (C), geographic concentration (D), overdue
   inspection (E), conflicting plans on one asset (F). Each finding shows its evidence and can be acknowledged
   or dismissed.
7. **Plan & act** — the officer approves, edits or rejects the drafted plan (only one open plan per incident),
   marks work started, then completes it with a **proof photo**. Completing records a maintenance event on the
   linked asset.
8. **Verify** — closing requires a completed plan and a proof photo that passed automated checks. A
   recurrence check counts new related reports since completion; officers can re-run it later, which reopens
   the incident if the problem came back. This is *workflow* verification, not a field inspection.

Officers can also resolve a single complaint directly (with its own proof photo).

---

## Security & privacy model

Enforced on the server for every request — see [docs/SECURITY.md](docs/SECURITY.md) for the route matrix.

- **Roles**: citizen, officer, admin. The role is re-read from the database on every request; a role sent by
  a client (registration body, tampered token) is ignored. Registration always creates a citizen.
- **Citizens** see only their own complaints, notifications and photos. For incidents they are part of, they
  get a reduced view (no other citizens' names, descriptions or exact points). Map data follows the same rules.
- **Public tracking** needs the private 10-character code and returns status only — no description, location,
  names or photos. Sequential `CMP-` numbers are not accepted.
- **Evidence**: photos are validated by content (JPEG/PNG/WebP only), size- and pixel-limited, re-encoded
  (EXIF/GPS removed), stored under server-generated names in a private folder, and served only through
  authorised endpoints. Rejected uploads leave no file behind.
- **Auth**: PBKDF2-SHA256 (310k iterations, older hashes upgraded on login), HMAC-signed tokens with expiry
  (12 h default), "sign out everywhere" and password change revoke old tokens, login throttling.
- **No published passwords**: nothing creates accounts with known passwords. Startup warns if an account still
  uses one of the old default passwords from earlier versions.
- **Hardening**: request-size limit, security headers and CSP, generic error messages (details only in server
  logs), tokens redacted from access logs, transactional state changes with conflict detection (HTTP 409).

---

## Configuration

- `data/civicmind_config.json` — city, wards, categories, departments, related-category groups, asset types,
  category → asset-type compatibility, match radius, risk-rule thresholds, priority thresholds.
- `.env` (gitignored) or environment variables — see `.env.example` (Sarvam key, secret, token lifetime, paths).

## Project structure

```
civicmind/
├─ backend/
│  ├─ main.py               app, middleware (size limit, headers), error handling
│  ├─ config.py · database.py · auth.py
│  ├─ manage.py             create-user / set-password / list-users
│  ├─ seed_demo.py          builds the isolated demo database
│  ├─ routes/               auth, complaints, incidents, actions, infrastructure, dashboard, admin, realtime, config,
│  │                        data_sources (TinyFish), assistant (multilingual), coordination (operator log)
│  ├─ services/             complaints (intake), clustering, priority, assets, risk, actions (state machine),
│  │                        evidence, ai, assistant, coordination, geo, bootstrap, tinyfish/ (client, URL safety, mock)
│  └─ tests/                pytest suite
├─ frontend/                index, citizen, dashboard, incident, map, assets (infrastructure), admin, data-sources
├─ data/civicmind_config.json
├─ docs/                    SECURITY.md, DEMO_SCRIPT.md
└─ run.bat · run.sh · run_demo.bat · run_demo.sh · Dockerfile · render.yaml · deploy/
```

## Deployment notes

- **Docker**: `docker build -t civicmind .` then
  `docker run -p 8000:8000 -v civicmind-data:/data -e CIVICMIND_SECRET=... civicmind`.
  The database and evidence live in `/data`; without a volume they are lost.
- **Render**: the free plan has an **ephemeral filesystem** — data is lost on every restart. Use a persistent
  disk for anything beyond a throwaway demo.
- Serve over HTTPS behind a reverse proxy (see `deploy/civicmind.service`). Set `CIVICMIND_SECRET` explicitly.
- Login throttling is in-process; with several workers or instances, put rate limiting at the proxy too.
- `CivicMind_Deployment_Guide.docx` describes the **previous** version: it lists the old default passwords and
  auto-seeded accounts, which no longer exist. Follow this README until the guide is updated.

## Known limitations

- Ward assignment uses the nearest configured ward **centre**, not official boundary polygons.
- Assets are points; road segments use a reference point.
- Photo checks detect invalid, blank, tiny and re-used images only. They do not prove a repair happened.
- Officers are not restricted by department or ward (the data model has no assignments yet).
- SQLite, single instance. The "PostgreSQL-ready" claim from earlier versions has not been tested.
- Real-time updates use SSE with a polling fallback; the stream polls the database every few seconds.
- Sarvam AI has a 25 s timeout; when it is slow, submissions wait for it before falling back.

## Team

Spparsh Mansuke · Chaitanya Khapake — MIT ADT University, Pune.
