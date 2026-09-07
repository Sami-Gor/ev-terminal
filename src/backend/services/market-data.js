'use strict';

/**
 * Market-data service: provider selection, caching and request orchestration
 * for history (all timeframes), quotes and fundamentals — plus the background
 * poller and in-memory market cache consumed by the HTTP/WebSocket servers.
 */
const { PROVIDER_MODE, HISTORY_TTL_MS, FINANCIALS_TTL_MS, USE_MOCK_DATA, DEFAULT_POLL_INTERVAL_MS } = require('../config');
const { TtlCache } = require('./ttl-cache');
const demoProvider = require('../providers/demo-provider');
const polygonProvider = require('../providers/polygon-provider');
const fmpProvider = require('../providers/fmp-provider');
const { fmpFinancials } = require('../providers/financials-provider');
const polygonStream = require('../providers/polygon-stream');

const historyCache = new TtlCache(HISTORY_TTL_MS);
const financialsCache = new TtlCache(FINANCIALS_TTL_MS);
const TIMEFRAMES = ['d', '4h', '15m'];

function defaultUniverse() {
  return demoProvider.DEFAULT_UNIVERSE;
}

/** Daily / intraday bars for any tracked or commodity symbol. */
async function getHistory(sym, timeframe = 'd') {
  const cacheKey = sym + '|' + timeframe;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  let payload;
  if (timeframe !== 'd') {
    payload = PROVIDER_MODE === 'polygon'
      ? await polygonProvider.polyHistoryTimeframe(sym, timeframe)
      : demoProvider.intradayBars(sym, timeframe);
  } else if (PROVIDER_MODE === 'polygon') {
    payload = await polygonProvider.polyHistory(sym);
  } else if (PROVIDER_MODE === 'fmp') {
    payload = await fmpProvider.fmpHistory(sym);
  } else {
    payload = demoProvider.demoHistory(sym);
  }

  const body = { symbol: sym, timeframe, ...payload };
  historyCache.set(cacheKey, body);
  return body;
}

/** Current quote + profile for any symbol (validates against the provider). */
async function getQuote(sym) {
  if (PROVIDER_MODE === 'demo') return demoProvider.demoQuote(sym);
  if (PROVIDER_MODE === 'fmp') {
    const quotes = await fmpProvider.fmpQuotes([sym]);
    if (!quotes.has(sym)) return null;
    const q = quotes.get(sym);
    return {
      symbol: sym,
      profile: { source: 'fmp' },
      ...q,
      provider: 'fmp',
      sectorHint: fmpProvider.sectorHintFromFmp(q.sectorHint),
    };
  }
  const quotes = await polygonProvider.polyQuotes([sym]);
  if (!quotes.has(sym)) return null;
  const q = quotes.get(sym);
  const name = await polygonProvider.polyName(sym);
  return { symbol: sym, profile: { source: 'polygon' }, ...q, name, provider: 'polygon', sectorHint: '' };
}

/** Fundamentals: FMP when keyed (sim fallback), deterministic sim otherwise. */
async function getFinancials(sym) {
  const cached = financialsCache.get(sym);
  if (cached) return cached;
  let payload;
  if (PROVIDER_MODE === 'fmp') {
    try {
      payload = await fmpFinancials(sym, defaultUniverse());
    } catch (e) {
      payload = demoProvider.demoFinancials(sym);
      payload.note = 'FMP fetch failed — showing simulated fundamentals';
    }
  } else {
    payload = demoProvider.demoFinancials(sym);
  }
  financialsCache.set(sym, payload);
  return payload;
}

/** Batch quotes for the WebSocket poller. */
async function getQuotes(syms) {
  if (PROVIDER_MODE === 'demo') {
    const out = new Map();
    for (const sym of syms) out.set(sym, demoProvider.demoTick(sym));
    return out;
  }
  if (PROVIDER_MODE === 'fmp') return fmpProvider.fmpQuotes(syms);
  return polygonProvider.polyQuotes(syms);
}

/* ================= server-side polling & in-memory market cache ========== */

/**
 * In-memory storage for market telemetry. Shape:
 *   marketCache = {
 *     updatedAt,                 // ISO timestamp of the last successful refresh
 *     tickers: [{ symbol, name, price, change, percentChange, volume }],
 *     vehicles: [{ vehicleId, model, socPct, rangeKm, batteryTempC, motorTempC,
 *                  chargingKw, odometerKm, status }],
 *     meta: { mode, attempts, failures, lastError }
 *   }
 */
const marketCache = {
  updatedAt: null,
  tickers: [],
  vehicles: [],
  meta: { mode: USE_MOCK_DATA === true ? 'mock' : 'external', attempts: 0, failures: 0, lastError: null },
};

const cacheUpdateListeners = [];
let pollingTimer = null;
let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
let consecutiveFailures = 0;
let liveFlushPending = false;

/** Live-tick ingestion: applies a trade tick to the cached ticker and
 *  notifies listeners (throttled to one flush per 250 ms during bursts). */
function ingestLiveTick(symbol, price, size, tradeTs) {
  const t = marketCache.tickers.find(x => x.symbol === symbol);
  if (!t) return;
  t.price = price;
  t.change = +(price - t.prevClose).toFixed(2);
  t.percentChange = t.prevClose ? +((price - t.prevClose) / t.prevClose * 100).toFixed(2) : 0;
  t.volume = size ? (t.volume || 0) + size : t.volume;
  marketCache.updatedAt = new Date().toISOString();
  if (!liveFlushPending) {
    liveFlushPending = true;
    setTimeout(() => {
      liveFlushPending = false;
      notifyCacheUpdate();
    }, 250);
  }
}
let failureSkipPhase = 0;

/** Subscribe to every cache refresh (used by the WebSocket feed manager). */
function onCacheUpdate(cb) {
  cacheUpdateListeners.push(cb);
}

function notifyCacheUpdate() {
  const snapshot = getCachedMarketData();
  for (const cb of cacheUpdateListeners) {
    try { cb(snapshot); } catch (e) { /* listener errors must not break the poller */ }
  }
}

/* ---- mock data generator (offline / USE_MOCK_DATA=true) ------------------ */

const MOCK_FLEET = [
  { vehicleId: 'EV-001', model: 'Model Y' },
  { vehicleId: 'EV-002', model: 'Ioniq 5' },
  { vehicleId: 'EV-003', model: 'ID.4' },
  { vehicleId: 'EV-004', model: 'Blazer EV' },
  { vehicleId: 'EV-005', model: 'EV6' },
  { vehicleId: 'EV-006', model: 'Mach-E' },
];

function seedFor(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulated EV telemetry + stock tickers for offline development. */
function generateMockTelemetry() {
  const vehicles = MOCK_FLEET.map(({ vehicleId, model }) => {
    const r = mulberry(seedFor(vehicleId + '|' + new Date().toDateString()));
    const base = 55 + r() * 40;
    const wobble = (Math.random() - 0.5) * 1.6;
    const socPct = Math.min(100, Math.max(5, +(base + wobble).toFixed(1)));
    return {
      vehicleId,
      model,
      socPct,
      rangeKm: Math.round(socPct * 4.6),
      batteryTempC: +(21 + r() * 9 + wobble).toFixed(1),
      motorTempC: +(28 + r() * 22).toFixed(1),
      chargingKw: +(Math.random() * 150).toFixed(1),
      odometerKm: Math.round(12000 + r() * 58000),
      status: Math.random() > 0.85 ? 'charging' : 'driving',
    };
  });
  const tickers = defaultUniverse().map(u => {
    const tick = demoProvider.demoTick(u.sym);
    return {
      symbol: u.sym,
      name: u.name,
      price: tick.price,
      change: tick.change,
      percentChange: tick.percentChange,
      volume: tick.volume,
    };
  });
  return { vehicles, tickers };
}

/* ---- external API fetch handler (rate-limit & failure tolerant) ---------- */

/** Fetches live quotes via the configured provider; returns null on failure.
 *  Vehicle telemetry has no external source — the last known values are retained. */
async function fetchExternalTelemetry(syms) {
  try {
    const quotes = await getQuotes(syms);
    const tickers = [...quotes.entries()].map(([symbol, q]) => ({
      symbol,
      name: q.name || symbol,
      price: quotePriceOf(q),
      change: Number.isFinite(q.change) ? q.change : 0,
      percentChange: Number.isFinite(q.percentChange) ? q.percentChange : 0,
      volume: Number.isFinite(q.volume) ? q.volume : 0,
    }));
    return { tickers, vehicles: marketCache.vehicles };
  } catch (e) {
    marketCache.meta.lastError = e.message;         // rate limit, timeout, 5xx…
    console.error(`[market-data] external fetch failed: ${e.message}`);
    return null;                                    // caller keeps serving the last good cache
  }
}

function quotePriceOf(q) { return Number.isFinite(q.price) && q.price > 0 ? q.price : 0; }

/* ---- poller --------------------------------------------------------------- */

function pollOnce() {
  marketCache.meta.attempts++;
  const syms = defaultUniverse().map(u => u.sym);

  const apply = (tickers, vehicles) => {
    marketCache.updatedAt = new Date().toISOString();
    marketCache.tickers = tickers;
    marketCache.vehicles = vehicles;
    consecutiveFailures = 0;
    marketCache.meta.lastError = null;
    notifyCacheUpdate();
  };

  if (USE_MOCK_DATA === true) {
    const mock = generateMockTelemetry();
    apply(mock.tickers, mock.vehicles);              // mock telemetry replaces the cache wholesale
    return;
  }

  // external API fetch handler — graceful on rate limits and request failures:
  // a failed fetch leaves the previous cache untouched so consumers keep
  // serving the last good data.
  fetchExternalTelemetry(syms)
    .then(payload => {
        if (!payload) {                                // provider returned nothing usable
        marketCache.meta.failures++;
        apply_stale_keep();
        return;
      }
      apply(payload.tickers, payload.vehicles);
    })
    .catch(e => {
      marketCache.meta.failures++;
      marketCache.meta.lastError = e.message;
      apply_stale_keep();
    });
}

/** Graceful degradation: the previous cache is retained as-is (stale-while-revalidate). */
function apply_stale_keep() {
  marketCache.meta.lastError = 'retained previous cache after failed refresh';
}

/**
 * Starts background market polling.
 *   USE_MOCK_DATA=true  → the mock generator refreshes the cache every interval.
 *   USE_MOCK_DATA=false → the external API fetch handler runs every interval,
 *                         backing off on failures while the stale cache is served.
 * Returns a stop function.
 */
function startPolling(intervalMs = DEFAULT_POLL_INTERVAL_MS) {
  pollIntervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_POLL_INTERVAL_MS;
  if (pollingTimer) return () => stopPolling();
  pollOnce();                                         // immediate first refresh

  if (PROVIDER_MODE === 'polygon') {
    // Real-time trade stream pushes ticks into the cache; a slow REST
    // re-sync (60 s) stays as the safety net for missed windows.
    polygonStream.start({
      getSymbols: () => defaultUniverse().map(u => u.sym),
      onTick: (sym, price, size) => ingestLiveTick(sym, price, size),
    });
    pollingTimer = setInterval(() => pollOnce(), 60000);
  } else {
    pollingTimer = setInterval(() => pollOnce(), pollIntervalMs);
  }
  return () => stopPolling();
}

function stopPolling() {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  polygonStream.stop();
}

/** Read-only snapshot of the cached market telemetry (null before first poll). */
function getCachedMarketData() {
  if (!marketCache.updatedAt) return null;
  return {
    updatedAt: marketCache.updatedAt,
    tickers: marketCache.tickers.map(t => ({ ...t })),
    vehicles: marketCache.vehicles.map(v => ({ ...v })),
    meta: { ...marketCache.meta },
  };
}

module.exports = {
  PROVIDER_MODE,
  TIMEFRAMES,
  defaultUniverse,
  getHistory,
  getQuote,
  getFinancials,
  getQuotes,
  startPolling,
  stopPolling,
  getCachedMarketData,
  onCacheUpdate,
  marketCache,
};
