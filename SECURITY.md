# Security Policy

## Supported versions

Only the latest `main` branch receives security fixes. Please update before reporting.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Email the maintainers with:

- a descriptive subject (`[security] …`),
- affected endpoint/module and reproduction steps,
- impact assessment and any proof-of-concept (sanitized).

You will receive an acknowledgment within **72 hours**, followed by a fix
timeline and a coordinated disclosure date. Credit is given in the release
notes unless you prefer to remain anonymous.

## Security architecture (what is already enforced)

| Control | Where |
|---|---|
| Helmet security headers (CSP, nosniff, frame protection, HSTS) | `src/backend/app.js` |
| Origin-restricted CORS (no wildcard) | `src/backend/app.js` + `ALLOWED_ORIGINS` |
| API rate limiting — 100 req / 15 min / IP on `/api/*` | `src/backend/app.js` |
| WebSocket origin verification at the HTTP upgrade handshake | `src/backend/websocket/feed-manager.js` |
| WS message cap (4 KB), 50-symbol per-socket limit, 30 s ping/pong heartbeat | `src/backend/websocket/feed-manager.js` |
| Generic error responses — no stacks, provider details or keys in bodies | `src/backend/routes/*`, `src/backend/app.js` |
| XSS — `esc()` sanitization of all user/storage-derived values before `innerHTML` | `src/frontend/utils/sanitize.js` + components |
| localStorage schema validation with auto-reset on corruption | `store.js`, `journal.js`, `alerts.js` |
| Pre-commit secret scanner (`npm run check:secrets`) | `scripts/check-secrets.js`, `.githooks/` |

## Secrets handling

- API keys are read **only** from environment variables in `src/backend/config`
  and are never serialized to the client, logs, or error bodies.
- The browser never receives or stores provider keys.
- `.env` is git-ignored; only the empty `.env.example` template is committed.
- Run `npm run check:secrets` before every commit — the pre-commit hook does it
  automatically.

## Scope

The bundled simulated feed intentionally contains no real market data. Reports
about data accuracy or investment suitability are out of scope for the security
process.
