'use strict';

/**
 * Background market polling: refreshes the market cache from the configured
 * provider (or the mock telemetry generator), keeps the last good snapshot on
 * failure, and wires the Polygon live-trade stream in polygon mode.
 *
 * Provider selection and quote fetching stay in the market-data facade; the
 * facade injects { getQuotes, getSymbols } so this module has no dependency
 * back on it (no circular imports).
 */
const { PROVIDER_MODE, USE_MOCK_DATA, POLL_INTERVAL_MS, POLYGON_REST_RESYNC_MS } = require('../config');
const polygonStream = require('../providers/polygon-stream');
const cache = require('./market-cache');
const { generateMockTelemetry } = require('./mock-telemetry');

let pollingTimer = null;
let pollInFlight = false;
let lastLoggedError = null;

function quotePriceOf(q) {
  return Number.isFinite(q.price) && q.price > 0 ? q.price : 0;
}

/** Fetches live quotes via the configured provider; returns null on failure.
 *  Freshly fetched symbols are published to the cache as they complete
 *  (`onQuote`) so a paced free-tier board fills progressively; the full-cycle
 *  snapshot at the end remains authoritative. Vehicle telemetry has no
 *  external source — the last known values are retained. */
async function fetchExternalTelemetry(syms, getQuotes) {
  const partial = (symbol, q) => {
    cache.applyQuoteBatch([{
      symbol,
      name: q.name || symbol,
      price: quotePriceOf(q),
      change: Number.isFinite(q.change) ? q.change : 0,
      percentChange: Number.isFinite(q.percentChange) ? q.percentChange : 0,
      volume: Number.isFinite(q.volume) ? q.volume : 0,
    }]);
  };
  try {
    const quotes = await getQuotes(syms, { onQuote: partial });
    const tickers = [...quotes.entries()].map(([symbol, q]) => ({
      symbol,
      name: q.name || symbol,
      price: quotePriceOf(q),
      change: Number.isFinite(q.change) ? q.change : 0,
      percentChange: Number.isFinite(q.percentChange) ? q.percentChange : 0,
      volume: Number.isFinite(q.volume) ? q.volume : 0,
    }));
    lastLoggedError = null;
    return { tickers, vehicles: cache.marketCache.vehicles };
  } catch (e) {
    cache.marketCache.meta.lastError = e.message;         // rate limit, timeout, 5xx…
    // Coalesce repeated identical failures (e.g. a sustained 429) to one line.
    if (e.message !== lastLoggedError) {
      lastLoggedError = e.message;
      console.error(`[market-poller] external fetch failed: ${e.message}`);
    }
    return null;                                          // caller keeps serving the last good cache
  }
}

function pollOnce(getQuotes, getSymbols) {
  if (pollInFlight) return;                               // slow fallback fetches must not overlap
  pollInFlight = true;
  cache.recordAttempt();

  if (USE_MOCK_DATA === true) {
    const mock = generateMockTelemetry();
    cache.applyMarketSnapshot(mock.tickers, mock.vehicles);  // mock telemetry replaces the cache wholesale
    pollInFlight = false;
    return;
  }

  // external API fetch handler — graceful on rate limits and request failures:
  // a failed fetch leaves the previous cache untouched so consumers keep
  // serving the last good data.
  fetchExternalTelemetry(getSymbols(), getQuotes)
    .then(payload => {
      if (!payload) {                                     // provider returned nothing usable
        cache.recordFailure();
        cache.markStaleRetained();
        return;
      }
      cache.applyMarketSnapshot(payload.tickers, payload.vehicles);
    })
    .catch(e => {
      cache.recordFailure(e.message);
      cache.markStaleRetained();
    })
    .finally(() => { pollInFlight = false; });
}

/**
 * Starts background market polling.
 *   USE_MOCK_DATA=true  → the mock generator refreshes the cache every interval.
 *   USE_MOCK_DATA=false → the external API fetch handler runs every interval,
 *                         backing off on failures while the stale cache is served.
 * Polygon mode additionally starts the trade stream and uses the 60 s REST
 * resync as the safety net for missed windows.
 * Returns a stop function.
 */
function startPolling({ getQuotes, getSymbols }, intervalMs = POLL_INTERVAL_MS) {
  const effectiveMs = Number(intervalMs) > 0 ? Number(intervalMs) : POLL_INTERVAL_MS;
  if (pollingTimer) return () => stopPolling();

  const setIntervalMs = ms => {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(() => pollOnce(getQuotes, getSymbols), ms);
  };

  pollOnce(getQuotes, getSymbols);                        // immediate first refresh

  if (PROVIDER_MODE === 'polygon') {
    const streaming = polygonStream.start({
      getSymbols,
      onTick: (sym, price, size) => cache.ingestLiveTick(sym, price, size),
      // Permanent entitlement rejection: keep REST quotes flowing at the
      // normal provider cadence instead of the 60 s stream-resync cadence.
      onUnavailable: () => setIntervalMs(effectiveMs),
    });
    pollingTimer = setInterval(
      () => pollOnce(getQuotes, getSymbols),
      streaming ? POLYGON_REST_RESYNC_MS : effectiveMs,
    );
  } else {
    setIntervalMs(effectiveMs);
  }
  return () => stopPolling();
}

function stopPolling() {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  polygonStream.stop();
}

module.exports = { startPolling, stopPolling };
