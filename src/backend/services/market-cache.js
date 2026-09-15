'use strict';

/**
 * In-memory market cache shared by the HTTP routes and the WebSocket feed.
 *
 * Shape:
 *   { updatedAt, tickers: [{ symbol, name, price, change, percentChange, volume }],
 *     vehicles: [{ vehicleId, model, socPct, rangeKm, batteryTempC, motorTempC,
 *                  chargingKw, odometerKm, status }],
 *     meta: { mode, attempts, failures, lastError } }
 *
 * The cache owns mutation and listener notification. The poller
 * (market-poller) and the live Polygon stream feed it; feed-manager
 * subscribes via onCacheUpdate.
 */
const { USE_MOCK_DATA } = require('../config');

const marketCache = {
  updatedAt: null,
  tickers: [],
  vehicles: [],
  meta: { mode: USE_MOCK_DATA === true ? 'mock' : 'external', attempts: 0, failures: 0, lastError: null },
};

const cacheUpdateListeners = [];
let liveFlushPending = false;

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

function recordAttempt() {
  marketCache.meta.attempts++;
}

function recordFailure(message) {
  marketCache.meta.failures++;
  if (message) marketCache.meta.lastError = message;
}

/** Graceful degradation: the previous cache is retained as-is. */
function markStaleRetained() {
  marketCache.meta.lastError = 'retained previous cache after failed refresh';
}

/** Replaces the cached board wholesale after a successful poll. */
function applyMarketSnapshot(tickers, vehicles) {
  marketCache.updatedAt = new Date().toISOString();
  marketCache.tickers = tickers;
  marketCache.vehicles = vehicles;
  marketCache.meta.lastError = null;
  notifyCacheUpdate();
}

/** Live-tick ingestion: applies a trade tick to the cached ticker and
 *  notifies listeners (throttled to one flush per 250 ms during bursts).
 *  Change is measured against the cached day reference (prevClose) when the
 *  provider supplies one, otherwise against the previous cached price — the
 *  provider quote shape carries no prevClose, so the old code produced NaN. */
function ingestLiveTick(symbol, price, size) {
  const t = marketCache.tickers.find(x => x.symbol === symbol);
  if (!t) return;
  const prev = Number.isFinite(t.prevClose) ? t.prevClose : t.price;
  t.price = price;
  t.change = Number.isFinite(prev) ? +(price - prev).toFixed(2) : 0;
  t.percentChange = prev ? +((price - prev) / prev * 100).toFixed(2) : 0;
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
  marketCache,
  onCacheUpdate,
  notifyCacheUpdate,
  recordAttempt,
  recordFailure,
  markStaleRetained,
  applyMarketSnapshot,
  ingestLiveTick,
  getCachedMarketData,
};
