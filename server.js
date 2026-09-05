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
const { PORT, PROVIDER_MODE, POLL_INTERVAL_MS } = require('./src/backend/config');
const feedManager = require('./src/backend/websocket/feed-manager');

const server = http.createServer(app);
feedManager.init(server);

server.listen(PORT, () => {
  console.log(`EVT://TERMINAL backend → http://localhost:${PORT}  (provider: ${PROVIDER_MODE}, poll: ${POLL_INTERVAL_MS}ms)`);
  console.log(`WebSocket feed       → ws://localhost:${PORT}`);
  if (PROVIDER_MODE === 'demo') {
    console.log('No POLYGON_API_KEY / FMP_API_KEY set — running the built-in simulated feed.');
  }
});
