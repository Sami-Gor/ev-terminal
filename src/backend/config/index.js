'use strict';

/** Environment & global configuration (UPPER_SNAKE_CASE constants). */
require('dotenv').config();

const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const POLYGON_KEY = process.env.POLYGON_API_KEY || '';
const FMP_KEY = process.env.FMP_API_KEY || '';
// Presence flags for honest diagnostics — values are never exported or logged.
const POLYGON_KEY_PRESENT = POLYGON_KEY !== '';
const FMP_KEY_PRESENT = FMP_KEY !== '';

/**
 * Distribution mode — the licensing gate for the whole data stream.
 *
 *   'public'  Distributed/shipped build. Simulated engine is the product:
 *             Polygon/FMP are NEVER contacted, even if keys are present in
 *             the environment, and no key-entry surface may be exposed.
 *   'local'   Developer's own single-user, non-distributed run. Personal
 *             API keys via .env are permitted (provider priority applies).
 *
 * Default is 'local' so a developer cloning the repo keeps current behavior;
 * distributed/packaged launches must set DISTRIBUTION_MODE=public.
 */
const DISTRIBUTION_MODE = process.env.DISTRIBUTION_MODE === 'public' ? 'public' : 'local';
const FORCE_SIMULATED = DISTRIBUTION_MODE === 'public';

// In public mode the vendor integrations are disabled at the config layer —
// the only place a provider can be selected from.
const PROVIDER_MODE = FORCE_SIMULATED ? 'demo' : POLYGON_KEY ? 'polygon' : FMP_KEY ? 'fmp' : 'demo';

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

/** Background market polling:
 *  USE_MOCK_DATA=true  → the mock telemetry generator refreshes the cache.
 *  USE_MOCK_DATA=false → the external provider fetch handler runs.
 *  unset               → auto: mock in demo mode, external when keys are set.
 *  Public mode forces the simulated engine regardless. */
const USE_MOCK_DATA_RAW = process.env.USE_MOCK_DATA;
const USE_MOCK_DATA = FORCE_SIMULATED || (USE_MOCK_DATA_RAW === undefined || USE_MOCK_DATA_RAW === ''
  ? (PROVIDER_MODE === 'demo')
  : USE_MOCK_DATA_RAW === 'true');
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) > 0
  ? Number(process.env.POLL_INTERVAL_MS)
  : (USE_MOCK_DATA ? 2000 : PROVIDER_MODE === 'fmp' ? 6000 : 15000);

/** WebSocket hardening limits. */
const WS_MAX_SYMBOLS_PER_CLIENT = 50;
const WS_HEARTBEAT_MS = 30000;

/** Upgrade-interest capture (future paid-tier demand signal).
 *  The storage file holds real email addresses — it must stay git-ignored. */
const UPGRADE_INTEREST_FILE = path.join(__dirname, '..', '..', '..', 'var', 'upgrade-interest.json');

/** Direct broker execution (Alpaca REST). Paper by default — flip
 *  ALPACA_PAPER=false only for private live-money self-use. */
const ALPACA_API_KEY = process.env.ALPACA_API_KEY || '';
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || '';
const ALPACA_PAPER = process.env.ALPACA_PAPER !== 'false';

module.exports = {
  PORT,
  POLYGON_KEY,
  POLYGON_KEY_PRESENT,
  FMP_KEY,
  FMP_KEY_PRESENT,
  DISTRIBUTION_MODE,
  FORCE_SIMULATED,
  PROVIDER_MODE,
  POLL_INTERVAL_MS,
  USE_MOCK_DATA,
  DEFAULT_POLL_INTERVAL_MS,
  HISTORY_TTL_MS,
  FINANCIALS_TTL_MS,
  ALLOWED_ORIGINS,
  API_RATE_LIMIT,
  WS_MAX_SYMBOLS_PER_CLIENT,
  WS_HEARTBEAT_MS,
  UPGRADE_INTEREST_FILE,
  ALPACA_API_KEY,
  ALPACA_SECRET_KEY,
  ALPACA_PAPER,
};
