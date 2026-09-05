<!-- Title format: <type>: <concise subject> — e.g. "fix: guard WS subscribe against duplicate symbols" -->

## Description

<!-- What does this PR change and why? -->

## Type of Change

- [ ] `fix` — bug fix (non-breaking)
- [ ] `feat` — new feature (non-breaking)
- [ ] `refactor` — code restructuring, no behavior change
- [ ] `docs` / `chore` — documentation or tooling

## Checklist

- [ ] Code style compliance (ES modules in the frontend, CommonJS in the backend; `camelCase` / `PascalCase` / `UPPER_SNAKE_CASE`; no `var`; no `console.log` in committed frontend code)
- [ ] `npm run check:secrets` passes — no hardcoded API keys or tokens
- [ ] `npm run check:licenses` passes — all dependencies remain permissively licensed
- [ ] Zero `boot-err` banners and no console errors after `npm start`
- [ ] Manually tested in the browser: affected panels render, live ticks propagate, and persistence still works
- [ ] User- / storage-derived values are escaped via `utils/sanitize.js` before touching `innerHTML`
- [ ] Keyboard access and ARIA labels preserved for any new interactive element

## Testing Performed

<!-- Describe the manual verification: panels checked, tick storm behavior, provider mode (simulated / keyed). -->

## Screenshots (if UI change)

