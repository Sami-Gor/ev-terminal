'use strict';

/**
 * Market-data service facade: provider selection, TTL caching and request
 * orchestration for history (all timeframes), quotes and fundamentals.
 *
 * Polling, cache storage and the live Polygon stream live in sibling modules
 * (market-poller, market-cache, mock-telemetry); this module keeps the public
 * API consumed by routes, server.js and the WebSocket feed manager.
 */
const { PROVIDER_MODE, HISTORY_TTL_MS, FINANCIALS_TTL_MS, FMP_KEY, FORCE_SIMULATED } = require('../config');
const { TtlCache } = require('./ttl-cache');
const demoProvider = require('../providers/demo-provider');
const polygonProvider = require('../providers/polygon-provider');
const fmpProvider = require('../providers/fmp-provider');
const { fmpFinancials, fmpGrowth } = require('../providers/financials-provider');
const cache = require('./market-cache');
const poller = require('./market-poller');

const historyCache = new TtlCache(HISTORY_TTL_MS);
/** Last good history per cache key, served when a refresh fails transiently. */
const historyStale = new Map();
/** In-flight history requests: same symbol + timeframe shares one provider
 *  call instead of firing duplicates (browser + correlation + chart). */
const historyPending = new Map();
const financialsCache = new TtlCache(FINANCIALS_TTL_MS);
/** Lazy growth cache (per symbol, same timescale as fundamentals) plus a stale
 *  copy for graceful degradation when the provider fails transiently. */
const growthCache = new TtlCache(FINANCIALS_TTL_MS);
const growthStale = new Map();
const TIMEFRAMES = ['d', '4h', '15m'];

function defaultUniverse() {
  return demoProvider.DEFAULT_UNIVERSE;
}

/**
 * Daily / intraday bars for any tracked or commodity symbol.
 *
 * - `priority: 'low'` marks background prefetch work (board population,
 *   correlation series) so it yields to interactive history in the shared
 *   Polygon free-tier rate-limit queue.
 * - Concurrent requests for the same symbol + timeframe share one provider
 *   call; different symbols stay independent.
 * - On a transient provider failure (429/5xx/network) the last good payload is
 *   served with `stale: true`; a malformed/empty provider response is not
 *   mistaken for success.
 */
async function getHistory(sym, timeframe = 'd', { priority = 'high', httpGet } = {}) {
  const cacheKey = sym + '|' + timeframe;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;
  const inflight = historyPending.get(cacheKey);
  if (inflight) return inflight;

  const fetchPayload = async () => {
    const usePolygon = !!httpGet || PROVIDER_MODE === 'polygon';
    let payload;
    if (timeframe !== 'd') {
      payload = usePolygon
        ? await polygonProvider.polyHistoryTimeframe(sym, timeframe, httpGet, priority)
        : demoProvider.intradayBars(sym, timeframe);
    } else if (usePolygon) {
      payload = await polygonProvider.polyHistory(sym, httpGet, priority);
    } else if (PROVIDER_MODE === 'fmp') {
      payload = await fmpProvider.fmpHistory(sym);
    } else {
      payload = await demoProvider.demoHistory(sym);
    }
    const body = { symbol: sym, timeframe, ...payload };
    historyCache.set(cacheKey, body);
    historyStale.set(cacheKey, body);
    return body;
  };

  const p = fetchPayload().catch(e => {
    const stale = historyStale.get(cacheKey);
    if (stale) return { ...stale, stale: true };
    throw e;
  });
  historyPending.set(cacheKey, p);
  try {
    return await p;
  } finally {
    historyPending.delete(cacheKey);
  }
}

/** Current quote + profile for any symbol (validates against the provider).
 *  `priority: 'low'` marks background board population so it yields to
 *  interactive requests; EOD quotes use the app-owned universe name instead of
 *  an extra provider reference call (reference data cannot change intraday). */
async function getQuote(sym, { priority = 'high' } = {}) {
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
  const quotes = await polygonProvider.polyQuotes([sym], { priority });
  if (!quotes.has(sym)) return null;
  const q = quotes.get(sym);
  let name = sym;
  if (polygonProvider.getQuoteMode() === 'eod') {
    const known = defaultUniverse().find(u => u.sym === sym);
    name = (known && known.name) || sym;
  } else {
    name = await polygonProvider.polyName(sym);
  }
  return { symbol: sym, profile: { source: 'polygon' }, ...q, name, provider: 'polygon', sectorHint: '' };
}

/** Fundamentals: FMP `/stable` whenever an FMP key is configured (fundamentals
 *  are FMP-only and independent of the quote provider), deterministic sim
 *  otherwise or in public mode. Entitlement-restricted symbols are handled
 *  inside the provider (modeled fallback with accurate provenance); this catch
 *  is a last-resort guard. */
async function getFinancials(sym) {
  const cached = financialsCache.get(sym);
  if (cached) return cached;
  let payload;
  if (!FORCE_SIMULATED && FMP_KEY) {
    try {
      payload = await fmpFinancials(sym, defaultUniverse());
    } catch (e) {
      payload = demoProvider.demoFinancials(sym);
      payload.note = 'FMP fetch failed — showing modeled fundamentals.';
    }
  } else {
    payload = demoProvider.demoFinancials(sym);
  }
  financialsCache.set(sym, payload);
  return payload;
}

/**
 * Lazy growth data — fetched only when the Growth view requests it, cached
 * per symbol for FINANCIALS_TTL_MS. Never part of the core 7-call financial
 * fetch, and never fetched at boot.
 *
 * Failure handling:
 *  - 402 (and 403 responses that explicitly indicate a subscription/
 *    entitlement limit): a valid `unavailable` result, cached for the TTL so
 *    a restricted plan is not hammered.
 *  - 401 and non-entitlement 403s: an authorization/configuration error —
 *    surfaced as a controlled backend error, never downgraded to symbol-level
 *    unavailable data and never cached as a valid result.
 *  - other failures: transient, serving the last known real growth data when
 *    available, otherwise an explicit unavailable message.
 */
const RESTRICTION_RE = /subscription|entitlement|access level|\bplan\b|upgrade/i;

function classifyGrowthError(e) {
  const res = e && e.response;
  const status = res && res.status;
  if (status === 402) return 'restricted';
  if (status === 401) return 'auth';
  if (status === 403) {
    let body = '';
    try {
      body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    } catch { body = ''; }
    return RESTRICTION_RE.test(body) ? 'restricted' : 'auth';
  }
  return 'transient';
}

async function getGrowth(sym, { httpGet } = {}) {
  const cached = growthCache.get(sym);
  if (cached) return cached;
  if (!httpGet && (FORCE_SIMULATED || !FMP_KEY)) {
    return {
      symbol: sym,
      provider: 'demo',
      growthMode: 'unavailable',
      growthHistory: [],
      note: 'Reported growth data unavailable in modeled financial mode.',
    };
  }
  try {
    const payload = await fmpGrowth(sym, httpGet ? { httpGet } : {});
    growthCache.set(sym, payload);
    if (payload.growthMode === 'real') growthStale.set(sym, payload);
    return payload;
  } catch (e) {
    const kind = classifyGrowthError(e);
    if (kind === 'auth') {
      // Configuration error: the provider rejected the credentials. Surfaced
      // to the API layer as a controlled 502 — never cached, never converted
      // to symbol-level unavailable data. No provider body or key is included.
      const status = e.response && e.response.status;
      throw new Error(`provider authorization rejected the request (HTTP ${status})`);
    }
    if (kind === 'restricted') {
      const payload = {
        symbol: sym,
        provider: 'fmp',
        growthMode: 'unavailable',
        growthHistory: [],
        note: `Growth data unavailable for ${sym} under the current FMP subscription.`,
      };
      // A subscription restriction is deterministic for the plan, so it is
      // cached for the TTL to avoid hammering the provider.
      growthCache.set(sym, payload);
      return payload;
    }
    const stale = growthStale.get(sym);
    if (stale) return { ...stale, stale: true };
    return {
      symbol: sym,
      provider: 'fmp',
      growthMode: 'unavailable',
      growthHistory: [],
      note: 'Growth data unavailable — provider request failed.',
    };
  }
}

/** Batch quotes for the WebSocket poller. `onQuote(sym, quote)` (Polygon only)
 *  publishes each freshly fetched symbol so the board fills progressively. */
async function getQuotes(syms, { onQuote } = {}) {
  if (PROVIDER_MODE === 'demo') {
    const out = new Map();
    for (const sym of syms) out.set(sym, demoProvider.demoTick(sym));
    return out;
  }
  if (PROVIDER_MODE === 'fmp') return fmpProvider.fmpQuotes(syms);
  // Background polling yields to interactive requests in the rate-limit queue.
  return polygonProvider.polyQuotes(syms, { priority: 'low', onQuote });
}

/* ---- background polling & market cache (facade delegations) -------------- */

/**
 * Effective data mode for the UI and status endpoints:
 *   'simulated' — built-in demo engine (no provider keys / public mode)
 *   'eod'       — real provider, but previous-session data only (no snapshot
 *                 entitlement; free-tier fallback)
 *   'realtime'  — provider quotes with realtime snapshot entitlement
 */
function getDataMode() {
  if (PROVIDER_MODE === 'demo') return 'simulated';
  if (PROVIDER_MODE === 'polygon') return polygonProvider.getQuoteMode() === 'eod' ? 'eod' : 'realtime';
  return fmpProvider.getQuoteMode();   // FMP free-tier quotes are end-of-day
}

/** Starts background market polling; returns a stop function. */
function startPolling(intervalMs) {
  return poller.startPolling({
    getQuotes,
    getSymbols: () => defaultUniverse().map(u => u.sym),
  }, intervalMs);
}

function stopPolling() {
  poller.stopPolling();
}

/* ---- market cache facade (delegations) ---------------------------------- */

const marketCache = cache.marketCache;

/** Read-only snapshot of the cached market telemetry (null before first poll). */
function getCachedMarketData() {
  return cache.getCachedMarketData();
}

/** Subscribe to every cache refresh (used by the WebSocket feed manager). */
function onCacheUpdate(cb) {
  cache.onCacheUpdate(cb);
}

module.exports = {
  PROVIDER_MODE,
  TIMEFRAMES,
  defaultUniverse,
  getHistory,
  getQuote,
  getFinancials,
  getGrowth,
  getQuotes,
  getDataMode,
  startPolling,
  stopPolling,
  getCachedMarketData,
  onCacheUpdate,
  marketCache,
};
