import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as marketData from '../src/backend/services/market-data.js';
import cache from '../src/backend/services/market-cache.js';

/* The facade API consumed by routes/server/feed-manager must survive the
 * Stage 4 split into market-cache / market-poller / mock-telemetry. */

const isDemo = marketData.PROVIDER_MODE === 'demo';

test('facade exposes the preserved public API', () => {
  // The public build intentionally omits the private-only `resubscribeStream`
  // hook (dynamic Polygon re-subscription); ordinary streaming lives in
  // market-poller and is unaffected.
  for (const fn of ['getHistory', 'getQuote', 'getFinancials', 'getQuotes', 'startPolling',
    'stopPolling', 'getCachedMarketData', 'onCacheUpdate', 'defaultUniverse']) {
    assert.equal(typeof marketData[fn], 'function', `missing facade export: ${fn}`);
  }
  assert.deepEqual(marketData.TIMEFRAMES, ['d', '4h', '15m']);
  assert.equal(marketData.defaultUniverse().length, 13);
  assert.equal(marketData.defaultUniverse()[0].sym, 'TSLA');
  assert.ok(marketData.marketCache && typeof marketData.marketCache === 'object');
});

test('getHistory returns 60 demo bars with the documented shape', { skip: !isDemo }, async () => {
  const h = await marketData.getHistory('TSLA');
  assert.equal(h.symbol, 'TSLA');
  assert.equal(h.timeframe, 'd');
  assert.equal(h.provider, 'demo');
  assert.equal(h.bars.length, 60);
  for (const key of ['date', 'o', 'h', 'l', 'c', 'v']) assert.ok(key in h.bars[0], `bar missing ${key}`);

  const intraday = await marketData.getHistory('TSLA', '4h');
  assert.equal(intraday.timeframe, '4h');
  assert.equal(intraday.bars.length, 60);
});

test('getQuote / getFinancials / getQuotes keep their shapes', { skip: !isDemo }, async () => {
  const q = await marketData.getQuote('TSLA');
  assert.equal(q.symbol, 'TSLA');
  assert.equal(q.provider, 'demo');
  assert.ok(q.price > 0);
  assert.ok(Number.isFinite(q.change));

  const f = await marketData.getFinancials('RIVN');
  assert.equal(f.symbol, 'RIVN');
  assert.equal(f.provider, 'demo');
  assert.ok(f.deliveriesSim && Number.isFinite(f.deliveriesSim.quarterly));

  const quotes = await marketData.getQuotes(['TSLA', 'NIO']);
  assert.ok(quotes instanceof Map);
  assert.equal(quotes.size, 2);
  assert.ok(Number.isFinite(quotes.get('TSLA').price));
});

test('poller fills the cache with the documented mock snapshot', { skip: !isDemo }, () => {
  const stop = marketData.startPolling(50);
  try {
    const snap = marketData.getCachedMarketData();
    assert.ok(snap, 'cache should be populated by the immediate first poll');
    assert.equal(snap.tickers.length, 13);
    assert.equal(snap.vehicles.length, 6);
    assert.equal(snap.meta.mode, 'mock');
    assert.ok(snap.meta.attempts >= 1);
    const tsla = snap.tickers.find(t => t.symbol === 'TSLA');
    assert.ok(tsla && tsla.price > 0 && tsla.name);
    const vehicle = snap.vehicles[0];
    for (const key of ['vehicleId', 'model', 'socPct', 'rangeKm', 'batteryTempC', 'motorTempC', 'chargingKw', 'odometerKm', 'status']) {
      assert.ok(key in vehicle, `vehicle missing ${key}`);
    }
  } finally {
    stop();
  }
});

test('cache notifies subscribers and live ticks update the board', { skip: !isDemo }, () => {
  let notified = 0;
  marketData.onCacheUpdate(() => { notified++; });
  const stop = marketData.startPolling(50);
  try {
    assert.ok(notified >= 1, 'listener should fire on cache refresh');

    cache.ingestLiveTick('TSLA', 999.99, 12345);
    const tsla = marketData.getCachedMarketData().tickers.find(t => t.symbol === 'TSLA');
    assert.equal(tsla.price, 999.99);
    assert.ok(Number.isFinite(tsla.change), 'change must not be NaN when prevClose is absent');
    assert.ok(Number.isFinite(tsla.percentChange));
    assert.ok(tsla.volume >= 12345);
  } finally {
    stop();
  }
});
