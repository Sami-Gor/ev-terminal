# EVT://TERMINAL

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/Sami-Gor/ev-terminal)](https://github.com/Sami-Gor/ev-terminal/releases)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

![EVT Terminal Hero](assets/hero-dashboard.png)

A Bloomberg-style monitoring terminal for **pure-play EV OEMs and battery manufacturers** — Tesla, Rivian, Lucid, NIO, XPeng, Li Auto, Polestar, BYD, CATL, CALB, Panasonic Energy, LG Energy Solution and Albemarle — with live WebSocket pricing, a frame-buffered render loop, multi-timeframe charts, market-structure overlays, a position-sizing calculator, a paper-trade journal, commodity correlations and price alerts.

> **Disclaimer:** this project is a monitoring/analysis tool, not investment advice. Without API keys it runs on a deterministic *simulated* feed; with keys it displays real market data. Nothing here is a recommendation.

---

![Financials panel — six views with the quarterly/annual income toggle](assets/panel-preview.png)

## Features

| Feature | What you get |
|---|---|
| **Live data engine** | WebSocket tick fan-out with auto-reconnect and frame-buffered rendering; REST history/quotes via Polygon.io or FinancialModelingPrep — or a deterministic simulated feed when no keys are set |
| **Focus chart** | Single and multi-timeframe (D / 4H / 15M) views, ZigZag swing labels (HH/HL/LH/LL), fresh supply/demand zones, draggable Entry/Stop/TP lines with live position sizing (ATR-14 based) |
| **Analytics cards** | Financials panel with six views — Overview/TTM KPIs, Income Statement (quarterly + annual), Balance Sheet, Cash Flow, reported Growth, Margins & Deliveries — plus a trade journal with backtest metrics (win rate, profit factor, expectancy, equity curve) and an EV-vs-commodity correlation matrix (30-session returns-based Pearson) |
| **Market overview** | Global ticker tape and table, sector heatmap, sector intraday lines, battery-metals monitor, global session clock |
| **Alerts** | Price crossings and daily-% change triggers with toast notifications, optional audio chime and a persisted history tray |
| **Accessibility** | WCAG 2.1 AA oriented — high-contrast colorblind-safe palette (teal/vermillion) toggle, `aria-live` status regions, full keyboard operation (`Tab`, `Enter`, arrows, `Escape`, `/` to search), focus-visible rings |

## Quick Start

> **Requirement:** Node.js **>= 18.0.0** (npm ships with Node).

```bash
git clone <your-fork-url> ev-terminal
cd ev-terminal
npm install
npm start
# open http://localhost:3000
```

No API keys are required to try it: without keys the backend runs a deterministic **simulated feed** (the UI badges it **`● SIMULATED ENGINE`**).

### Financials panel

Six views, in order: **Overview** (TTM KPIs and valuation), **Income Statement** with a `QUARTERLY | ANNUAL` toggle (up to five periods each; the annual series is already part of the core fetch, so the toggle costs no extra request), **Balance Sheet** (cash and short-term investments, assets, liabilities, equity, debt and net debt, newest quarter first), **Cash Flow** (operating cash flow, capex, free cash flow, investing/financing flows and net cash movement — accounting signs preserved as reported), **Growth**, and **Margins & Deliveries**.

With an FMP key the panel shows real fundamentals labelled **`FMP · REAL`**; otherwise it falls back to deterministic modeled data labelled **`DEMO · MODELED`**, with deliveries/shipments remaining explicitly modeled estimates (FMP does not provide a deliveries dataset). **Growth** is lazy-loaded reported growth — Revenue, Gross Profit, Operating Income, Net Income and EPS — fetched separately from the normal financial request and cached independently; it is presented as `Reported Growth` (never described as YoY/QoQ) and is not fabricated in modeled mode, where it reports itself unavailable instead.

## API Key Configuration

Copy the template and add your keys:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `POLYGON_API_KEY` | *(empty)* | Polygon.io REST key. Enables real daily aggregates, intraday 4H/15M bars and snapshot quotes. |
| `FMP_API_KEY` | *(empty)* | FinancialModelingPrep key. Enables real daily history, per-symbol quotes and fundamentals (key-metrics-TTM, income statements). |
| `PORT` | `3000` | HTTP + WebSocket listen port. |
| `HOST` | `127.0.0.1` | Listen address. Loopback by default; set `0.0.0.0` only for intentional LAN/remote access. |
| `TRADING_API_TOKEN` | *(empty)* | Bearer token required for private/self-hosted trading access. It does **not** override `DISTRIBUTION_MODE=public`, which always disables trading regardless of credentials. |
| `ALLOWED_ORIGINS` | localhost variants | Comma-separated origins allowed to call the API and open the WebSocket feed. |

Provider priority: **Polygon → FMP → simulated**. Keys are read only by `src/backend/config`; they are never sent to the browser or written to logs.

## Data sources & distribution mode

**The distributed app ships on a deterministic simulated engine — that is the v1.0 product.** Real-time and delayed market data are a *planned paid upgrade*: market-data vendors (Polygon, FMP) prohibit distributing an application built on individual-tier keys, so live data unlocks only after a business-tier data agreement.

| `DISTRIBUTION_MODE` | Behavior |
|---|---|
| `local` (default) | Developer's own single-user run. Personal Polygon/FMP keys via `.env` work (provider priority: Polygon → FMP → simulated). Not for distribution. |
| `public` | Shipped build: locked to the simulated engine. Vendor keys in the environment are ignored, no key-entry surface is exposed, and `/api/status` honestly reports `mode: "simulated"`. |

The UI reflects this: simulated runs badge **`● SIMULATED ENGINE`** (amber, never a green "LIVE"), and a header **⬆ UPGRADE** hook captures email interest for the future paid tier (stored server-side in a git-ignored file, never committed). A **BROKER ↗** popover carries a static outbound referral link to Trade Nation with a risk-disclosure placeholder (`{{TRADE_NATION_RISK_DISCLOSURE}}`) — no OAuth, no order routing, no account linking.

### Free-tier provider keys (Polygon/Massive)

Plans without Snapshot/WebSocket entitlement are supported: when the snapshot endpoint answers `403 NOT_AUTHORIZED`, quotes fall back to one daily-aggregate range request per symbol covering the last completed US trading sessions, and the feed is labelled **`● EOD · PREVIOUS CLOSE`** (`dataMode: "eod"` in `/api/status` and `/api/config`) — never presented as realtime. `change`/`percentChange` are the conventional latest-close vs previous completed close; when only one completed session is available they are `null` rather than substituted with open-to-close movement. The realtime stream is disabled for the session after a single log line instead of reconnecting, and polling continues over REST. Invalid keys (`401`), server errors and malformed responses still surface as errors.

In the free/EOD path all REST traffic shares one quota-aware pacing scheduler: the visible chart's history is prioritised over background board population, duplicate snapshot/quote/history requests are deduplicated, and the market board fills progressively as paced requests complete. Snapshot-entitled (realtime) accounts are not throttled. A numeric price is only labelled `LIVE` when the provider supplies genuinely realtime data; completed-session values stay labelled `● EOD · PREVIOUS CLOSE`, and simulated runs are labelled `● SIMULATED ENGINE`.

### FMP market data & request budgets

When FMP is used as the market-data provider, quotes come from the stable per-symbol endpoint (`/stable/quote`) and daily history from the stable EOD endpoint (`/stable/historical-price-eod/full`, bounded date window); both are cached, and Polygon remains the preferred continuous provider whenever it is configured. FMP plans carry request limits, so caching is deliberate: quotes and history are served from their TTL caches between refreshes.

Quota-aware financial request budget per uncached symbol: **7** FMP requests — profile, quarterly income, annual income, quarterly balance sheet, quarterly cash flow, ratios-TTM and key-metrics-TTM. Financial cache hit = 0 provider calls; financial tab switching = 0; Quarterly/Annual toggle = 0; first Growth view = +1; cached Growth = 0.

## The `android/` directory and `ANDROID_PERFORMANCE_AUDIT.md`

`android/` is a **native Kotlin companion client** (not a WebView wrapper): an OkHttp WebSocket client + ViewModel consume the same Node feed, and a Jetpack Compose dashboard renders tickers, an EV-fleet telemetry HUD and the news wire. It shares the backend's protocol (subscribe payload, tick schema) and licensing posture. `ANDROID_PERFORMANCE_AUDIT.md` documents that module's performance, state-hygiene and recomposition audit — lazy-list keys, flow conflation, process-lifecycle socket gating — and the fixes applied against it.

### Android endpoints and network security

Endpoints are supplied at build time through Gradle properties (`-P…`) or the
matching environment variables. **Debug defaults target the local dev server;
release values must be provided explicitly and use HTTPS/WSS.** No endpoint is
committed, and never put secrets in these values.

| Build | Property / env var | Required | Default |
|---|---|---|---|
| Debug | `EVT_DEBUG_API_BASE_URL` | no | `http://10.0.2.2:3000` (emulator host) |
| Debug | `EVT_DEBUG_WS_URL` | no | `ws://10.0.2.2:3000` |
| Debug | `EVT_DEBUG_API_ORIGIN` | no | `http://localhost:3000` (backend allowlist) |
| Release | `EVT_API_BASE_URL` | **yes** | — must be `https://` |
| Release | `EVT_WS_URL` | **yes** | — must be `wss://` |
| Release | `EVT_API_ORIGIN` | no | derived from `EVT_API_BASE_URL` |

```bash
# Debug against the emulator (defaults already do this)
./gradlew :app:assembleDebug

# Release: explicit secure endpoints, fail-fast if missing or non-secure
./gradlew :app:assembleRelease \
    -PEVT_API_BASE_URL=https://api.example.com \
    -PEVT_WS_URL=wss://api.example.com
```

The `Origin` header the client sends is a backend allowlist compatibility header
(CORS echo + WebSocket upgrade gate) — it is **not** authentication. Release
builds disallow general cleartext traffic via
`android/app/src/main/res/xml/network_security_config.xml`; debug builds override
that file to permit cleartext for `10.0.2.2`, `localhost` and `127.0.0.1` only.

## Architecture

```
public/index.html            markup only (no inline CSS/JS)
src/frontend/
  main.js                    boot orchestrator (deterministic init order)
  components/                16 panels/widgets: focus-chart · heatmap · ticker-table · tape ·
                             sector · news · clock · financials · journal · correlation ·
                             alerts · trackers · trading · upgrade-banner · layout-manager ·
                             connection-indicator
  services/                  store (state + bus) · api (REST) · ws-client (feed) ·
                             render-scheduler (rAF tick buffer)
  utils/                     format · indicators (ATR/zigzag/pearson/zones) · sanitize ·
                             theme (colorblind palette) · demo-engine (offline fallback)
  styles/                    theme · grid · panels · analytics
src/backend/
  config/index.js            environment & constants
  providers/                 demo (simulated feed) · polygon · fmp · financials
  routes/                    status · history · quote · financials · market · news ·
                             config · trade (token-gated) · upgrade-interest
  services/                  market-data (provider orchestration + TTL caches) ·
                             market-poller · market-cache · mock-telemetry · ttl-cache ·
                             symbol-utils · seeded-random · brokerClient · trading-guard ·
                             order-validation · NewsCorrelationEngine · upgrade-interest
  websocket/feed-manager.js  origin gate, per-client subscriptions, heartbeat, broadcast
app + entry                  src/backend/app.js (Express assembly) · server.js (entry)
```

*62 files total: 26 frontend JS modules, 30 backend JS modules, 4 stylesheets, plus `server.js` and `public/index.html`.*

Data flow: `provider → market-data service (TTL cache) → REST/WS → store → render-scheduler (rAF) → in-place DOM patches`. Chart redraws are throttled full renders only when price escapes the rendered range; everything else patches in place.

### REST API

| Endpoint | Description |
|---|---|
| `GET /api/status` | provider mode, WS client count, subscriptions |
| `GET /api/history/:symbol?timeframe=d\|4h\|15m` | 60 bars of OHLCV |
| `GET /api/quote/:symbol` | price, change, %change, volume, profile |
| `GET /api/financials/:symbol` | Normalized FMP fundamentals: overview/TTM metrics, quarterly + annual income, balance sheet, cash flow, margins, and explicitly modeled deliveries |
| `GET /api/financials/:symbol/growth` | Lazy quarterly reported-growth data with independent caching; unavailable/restricted provider states are normalized |

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
