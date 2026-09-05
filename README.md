# EVT://TERMINAL

A Bloomberg-style monitoring terminal for **pure-play EV OEMs and battery manufacturers** — Tesla, Rivian, Lucid, NIO, XPeng, Li Auto, Polestar, BYD, CATL, CALB, Panasonic Energy, LG Energy Solution and Albemarle — with live WebSocket pricing, a frame-buffered render loop, multi-timeframe charts, market-structure overlays, a position-sizing calculator, a paper-trade journal, commodity correlations and price alerts.

> **Disclaimer:** this project is a monitoring/analysis tool, not investment advice. Without API keys it runs on a deterministic *simulated* feed; with keys it displays real market data. Nothing here is a recommendation.

---

## Features

- **Live prices** — WebSocket tick fan-out with auto-reconnect; REST history/quotes via Polygon.io or FinancialModelingPrep, or a built-in deterministic simulator when no keys are set.
- **Focus chart** — single and multi-timeframe (D / 4H / 15M) views, ZigZag swing labels (HH/HL/LH/LL), fresh supply/demand zones, draggable Entry/Stop/TP lines with live position sizing (ATR-14 based).
- **Analytics cards** — financials (TTM KPIs, income statement, margins & deliveries), trade journal with backtest metrics (win rate, profit factor, expectancy, equity curve), EV-vs-commodity correlation matrix (30-session returns-based Pearson).
- **Market overview** — global ticker tape and table, sector heatmap, sector intraday lines, battery-metals monitor, global session clock, index map.
- **Alerts** — price crossings and daily-% change triggers with toast notifications, optional audio chime and a persisted history tray.
- **Accessibility** — WCAG 2.1 AA oriented: high-contrast colorblind-safe palette (teal/vermillion) toggle, `aria-live` status regions, full keyboard operation (`Tab`, `Enter`, arrows, `Escape`, `/` to search), focus-visible rings.

## Quickstart

```bash
git clone <your-fork-url> ev-terminal
cd ev-terminal
npm install
npm start
# open http://localhost:3000
```

No API keys are required to try it: without keys the backend runs a deterministic **simulated feed** (the UI labels it `LIVE · SERVER SIM`).

## API Key Configuration

Copy the template and add your keys:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `POLYGON_API_KEY` | *(empty)* | Polygon.io REST key. Enables real daily aggregates, intraday 4H/15M bars and snapshot quotes. |
| `FMP_API_KEY` | *(empty)* | FinancialModelingPrep key. Enables real daily history, batch quotes and fundamentals (key-metrics-TTM, income statements). |
| `PORT` | `3000` | HTTP + WebSocket listen port. |
| `ALLOWED_ORIGINS` | localhost variants | Comma-separated origins allowed to call the API and open the WebSocket feed. |

Provider priority: **Polygon → FMP → simulated**. Keys are read only by `src/backend/config`; they are never sent to the browser or written to logs.

## Architecture

```
public/index.html            markup only (no inline CSS/JS)
src/frontend/
  main.js                    boot orchestrator (deterministic init order)
  services/                  store (state), api (REST), ws-client (feed), render-scheduler (rAF)
  components/                one module per panel (chart, heatmap, journal, alerts, …)
  utils/                     format, indicators (ATR/zigzag/pearson), sanitize, theme, demo-engine
  styles/                    theme · grid · panels · analytics
src/backend/
  config/index.js            environment & constants
  providers/                 polygon · fmp · demo (simulated feed)
  routes/                    status · history · quote · financials
  services/                  market-data (caching/orchestration), ttl-cache, symbol-utils
  websocket/feed-manager.js  origin gate, per-client subscriptions, heartbeat, poller
```

Data flow: `provider → market-data service (TTL cache) → REST/WS → store → render-scheduler (rAF) → in-place DOM patches`. Chart redraws are throttled full renders only when price escapes the rendered range; everything else patches in place.

### REST API

| Endpoint | Description |
|---|---|
| `GET /api/status` | provider mode, WS client count, subscriptions |
| `GET /api/history/:symbol?timeframe=d\|4h\|15m` | 60 bars of OHLCV |
| `GET /api/quote/:symbol` | price, change, %change, volume, profile |
| `GET /api/financials/:symbol` | TTM metrics, statements, modeled deliveries |

### Keyboard

| Key | Action |
|---|---|
| `/` | focus the ticker search filter |
| `←` / `→` | move the chart crosshair |
| `Enter` | pin the chart inspector / activate focused row or tile |
| `↑` / `↓` | navigate ticker rows |
| `Escape` | close popovers / unpin the inspector |

## Security

Hardened by default: Helmet headers with CSP, origin-restricted CORS and WebSocket upgrades, 100 req/15 min API rate limiting per IP, 4 KB WS message cap, 50-symbol per-socket subscription cap, ping/pong heartbeat, sanitized error responses and XSS-escaped rendering. See [SECURITY.md](SECURITY.md) for disclosure policy and [CONTRIBUTING.md](CONTRIBUTING.md) for the pre-commit secret scanner.

## License

[MIT](LICENSE). Third-party packages and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
