'use strict';

/**
 * EVT://TERMINAL backend entry point.
 *
 * Boot order:
 *   1. config/index.js        — environment & constants
 *   2. services/*             — provider-agnostic market-data layer
 *   3. app.js                 — Express routes & static hosting
 *   4. websocket/feed-manager — tick poller & subscriptions
 *
 * Providers (auto-detected from environment):
 *   POLYGON_API_KEY  → Polygon.io REST
 *   FMP_API_KEY      → FinancialModelingPrep REST
 *   (neither set)    → built-in deterministic simulated feed
 */
const http = require('http');
const app = require('./src/backend/app');
const { PORT, HOST, PROVIDER_MODE, POLL_INTERVAL_MS, POLYGON_REST_RESYNC_MS, USE_MOCK_DATA } = require('./src/backend/config');
const feedManager = require('./src/backend/websocket/feed-manager');
const marketData = require('./src/backend/services/market-data');

const server = http.createServer(app);
feedManager.init(server);
marketData.startPolling();          // background cache refresh (mock or provider)

/* Actual interval used by the poller: polygon mode focuses on the live stream
 * and only REST-resyncs on the slower cadence. */
const effectivePollMs = PROVIDER_MODE === 'polygon' ? POLYGON_REST_RESYNC_MS : POLL_INTERVAL_MS;
const pollLabel = USE_MOCK_DATA ? 'mock telemetry'
  : PROVIDER_MODE === 'polygon' ? 'polygon stream + REST resync' : 'provider quotes';

server.listen(PORT, HOST, () => {
  const shownHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`EVT://TERMINAL backend → http://${shownHost}:${PORT}  (host: ${HOST}, provider: ${PROVIDER_MODE}, poll: ${effectivePollMs}ms)`);
  console.log(`WebSocket feed       → ws://${shownHost}:${PORT}`);
  if (PROVIDER_MODE === 'demo') {
    console.log('No POLYGON_API_KEY / FMP_API_KEY set — running the built-in simulated feed.');
  }
  console.log(`Market cache polling   → ${effectivePollMs}ms (${pollLabel})`);
});
