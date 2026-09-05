# Contributing to EVT://TERMINAL

Thanks for considering a contribution! This project follows a lightweight
fork-and-pull workflow with automated license and secret checks.

## Getting started

```bash
git clone <your-fork-url> ev-terminal
cd ev-terminal
npm install
cp .env.example .env        # optional — the app runs without keys (simulated feed)
npm start                   # http://localhost:3000
```

Enable the repository hooks (pre-commit secret & license scan):

```bash
git config core.hooksPath .githooks
```

## Pull request guidelines

1. **Branch** from `main` with a descriptive name (`feat/alert-throttle`, `fix/ws-reconnect`).
2. **Keep modules cohesive** — one concern per file under `src/frontend/{components,services,utils}`
   and `src/backend/{routes,providers,services,websocket}`. UI rendering stays in
   components; network I/O stays in services; pure math stays in `utils/`.
3. **Style** — ES modules in the frontend, CommonJS in the backend; `camelCase`
   variables/functions, `PascalCase` classes, `UPPER_SNAKE_CASE` constants,
   `kebab-case` filenames. No `var`. No `console.log` in committed frontend code.
4. **Security** — all storage/network/user-derived values must pass through
   `utils/sanitize.js` (`esc()`) before entering `innerHTML`. New endpoints must
   validate input, return generic error messages and respect the rate limiter.
5. **Accessibility** — interactive elements need keyboard handlers, focus
   indicators and ARIA labels; never encode meaning in color alone (pair with
   ▲/▼ text).
6. **Verify before opening a PR**:
   - `npm run check:secrets` — no hardcoded keys
   - `npm run check:licenses` — all licenses permissive
   - the app boots with **zero** `boot-err` banners and no console errors
7. **Describe** the change, the testing performed and any screenshots for UI work.

## Commit messages

Use imperative mood with a concise subject (`fix: guard WS subscribe against
duplicate symbols`) and a body explaining *why* when non-obvious.

## Code of conduct

Be constructive and respectful. Reports of unhandled bugs or security issues
follow the process in [SECURITY.md](SECURITY.md).
