# CivicMind — security model and route authorisation matrix

All checks are enforced on the server by FastAPI dependencies in `backend/auth.py`
(`current_user`, `require_citizen`, `require_officer`, `require_admin`) and by ownership checks in the
routes. The frontend only mirrors these rules for usability.

Legend: **C** citizen · **O** officer · **A** admin · **own** = only the caller's records · 404 is returned
instead of 403 where revealing existence would leak information.

| Method | Path | Who | Notes / state checks | Audit |
|---|---|---|---|---|
| POST | `/api/auth/register` | public | always creates a citizen; `role` in body ignored; email + password ≥ 8 validated; throttled | — |
| POST | `/api/auth/login` | public | 5 failures / 10 min per IP+email → 429; same message for unknown email | — |
| GET | `/api/auth/me` | any | current DB role, no secrets | — |
| POST | `/api/auth/logout-all` | any | bumps token version → all tokens revoked | — |
| POST | `/api/auth/password` | any | requires current password; revokes old tokens | — |
| GET | `/api/config`, `/api/wards`, `/api/health` | public | no secrets | — |
| GET | `/api/demo-info` | public | demo mode only; e-mails, never passwords | — |
| POST | `/api/complaints` | C | validated category/text/coords (finite, in service area); optional photo validated; duplicate guard | activity |
| GET | `/api/complaints` | C own · O · A | admins also see citizen e-mail | — |
| GET | `/api/complaints/{id}` | owner · O · A | others 404 | — |
| GET | `/api/complaints/{id}/photo`, `/resolution-photo` | owner · O · A | served from private store | — |
| GET | `/api/complaints/{id}/plan` | O · A | recommendation only | — |
| POST | `/api/complaints/{id}/resolve` | O · A | proof photo required & checked; open → resolved only (409 otherwise) | activity, notification |
| POST | `/api/complaints/{id}/asset-match` | O · A | confirm / reject an automatic match | — |
| GET | `/api/track/{code}` | public | private code only; status/category/ward/date; no PII | — |
| GET/POST | `/api/notifications`, `/read` | own | — | — |
| GET | `/api/incidents` | O · A | — | — |
| GET | `/api/incidents/{id}` | O · A full · C limited if linked | citizens: no other citizens' data, generalised location | — |
| POST | `/api/incidents/detect` | O · A | grouping run | activity |
| POST | `/api/incidents/{id}/investigate` | O · A | regenerates notes only | activity |
| POST | `/api/incidents/{id}/plans` | O · A | only if no open plan and not resolved | activity |
| POST | `/api/actions/{id}/approve` | O · A | pending → approved (edits validated) | activity, notification |
| POST | `/api/actions/{id}/reject` | O · A | pending → rejected, reason required | activity |
| POST | `/api/actions/{id}/start` | O · A | approved → in_progress | activity, notification |
| POST | `/api/actions/{id}/complete` | O · A | in_progress → completed; proof required; triggers verification | activity, notification, maintenance |
| POST | `/api/incidents/{id}/verify` | O · A | needs completed plan + accepted proof on disk; may reopen | activity, notification |
| GET | `/api/actions/{id}/proof` | O · A · linked C | private store | — |
| GET | `/api/map/complaints` | C own · O · A | — | — |
| GET | `/api/map/incidents` | C generalised · O · A | — | — |
| GET | `/api/assets`, `/api/assets/{id}`, `/api/map/assets`, `/api/assets/types` | O · A | — | — |
| POST | `/api/assets`, `/api/assets/import` | A | validated; existing codes never overwritten | activity |
| POST | `/api/assets/{id}/maintenance` | O · A | validated, past dates only | — |
| GET | `/api/risk/findings` | O · A | — | — |
| POST | `/api/risk/scan`, `/api/risk/findings/{id}/review` | O · A | — | activity |
| GET | `/api/dashboard`, `/charts` | O · A | — | — |
| GET | `/api/dashboard/citizen` | C | own counts | — |
| ALL | `/api/admin/*` | A | router-level dependency (reads included) | user creation logged |
| POST | `/api/admin/reset` | A | demo database only + typed `RESET` | — |
| GET | `/api/stream?token=` | own | SSE; token redacted from access logs | — |

## Other controls

- **Request limits**: 9 MB per request; 5 MB / 40 MP per image; text fields have max lengths.
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP
  (`script-src` still allows `'unsafe-inline'` because pages use inline scripts; external scripts are limited
  to unpkg / jsdelivr), `Cache-Control: no-store` on API responses.
- **Errors**: unhandled errors return a generic message with a reference id; the traceback goes to the server
  log only. Validation errors list field names, never the submitted values.
- **CORS**: disabled (same-origin) unless `CIVICMIND_CORS_ORIGINS` is set.
- **AI**: model output is schema-validated and clamped; routing, priority, evidence verdicts, state transitions
  and authorisation are deterministic code. Citizen text is sent as JSON data with an explicit
  "untrusted data" instruction.
- **Concurrency**: state changes run in `BEGIN IMMEDIATE` transactions and update with `WHERE status = <expected>`;
  a lost race returns 409 and changes nothing. Public ids derive from AUTOINCREMENT keys (never reused).

## Known gaps

- Login throttling is per process (not shared across workers/instances).
- Tokens live in `localStorage`; a successful XSS could read them. Rendering escapes all untrusted text,
  but CSP still allows inline scripts.
- SSE passes the token in the query string (EventSource cannot send headers); it is redacted from uvicorn
  access logs but may appear in proxy logs — configure the proxy accordingly.
- No department/ward-level officer scoping; any officer can act on any incident.
