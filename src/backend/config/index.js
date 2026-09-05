'use strict';

/** Environment & global configuration (UPPER_SNAKE_CASE constants). */
require('dotenv').config();

const PORT = Number(process.env.PORT) || 3000;
const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const FMP_KEY = process.env.FMP_API_KEY || '';
const PROVIDER_MODE = POLYGON_KEY ? 'polygon' : FMP_KEY ? 'fmp' : 'demo';
const ENV_POLL = Number(process.env.POLL_INTERVAL_MS);
const POLL_INTERVAL_MS = ENV_POLL > 0 ? ENV_POLL
  : PROVIDER_MODE === 'polygon' ? 15000 : PROVIDER_MODE === 'fmp' ? 6000 : 2000;
const HISTORY_TTL_MS = 10 * 60 * 1000;
const FINANCIALS_TTL_MS = 30 * 60 * 1000;

/** Origins allowed to call the API / open the WebSocket feed (CORS allowlist). */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:8901,http://127.0.0.1:8901')
  .split(',').map(s => s.trim()).filter(Boolean);

/** Rate limiting for /api/*: max 100 requests per 15 minutes per IP. */
const API_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 100 };

/** WebSocket hardening limits. */
const WS_MAX_SYMBOLS_PER_CLIENT = 50;
const WS_HEARTBEAT_MS = 30000;

module.exports = {
  PORT,
  POLYGON_KEY,
  FMP_KEY,
  PROVIDER_MODE,
  POLL_INTERVAL_MS,
  HISTORY_TTL_MS,
  FINANCIALS_TTL_MS,
  ALLOWED_ORIGINS,
  API_RATE_LIMIT,
  WS_MAX_SYMBOLS_PER_CLIENT,
  WS_HEARTBEAT_MS,
};
