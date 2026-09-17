import { test } from 'node:test';
import assert from 'node:assert/strict';

import marketData from '../src/backend/services/market-data.js';

/* ------------------------------------------------------------------ *
 * History service: cache, dedupe, stale-serving, failure semantics.   *
 * Injected transport — no live provider calls.                        *
 * ------------------------------------------------------------------ */

const BARS = [
  { t: Date.UTC(2026, 8, 14), o: 356.1, h: 361.2, l: 354.8, c: 358.97, v: 32477181 },
  { t: Date.UTC(2026, 8, 11), o: 348, h: 352, l: 347, c: 350, v: 30000000 },
  { t: Date.UTC(2026, 8, 10), o: 344, h: 346, l: 343, c: 345, v: 29000000 },
];

function okTransport(counters) {
  return async url => {
    counters.calls = (counters.calls || 0) + 1;
    counters.urls = counters.urls || [];
    counters.urls.push(url);
    if (url.includes('/range/')) return { data: { results: BARS, status: 'OK' } };
    throw new Error('unexpected url ' + url);
  };
}

function statusError(status) {
  const e = new Error('http ' + status);
  e.response = { status, data: { error: 'x' } };
  return e;
}

const advance = ms => {
  const real = Date.now;
  Date.now = () => real() + ms;
  return () => { Date.now = real; };
};

test('first uncached daily history performs one provider request; repeat inside TTL performs zero', async () => {
  const counters = {};
  const transport = okTransport(counters);
  const first = await marketData.getHistory('TSLA', 'd', { httpGet: transport });
  assert.equal(counters.calls, 1);
  assert.equal(first.provider, 'polygon');
  assert.ok(Array.isArray(first.bars) && first.bars.length >= 1);
  assert.equal(first.bars[0].date, '2026-09-10', 'oldest-first ordering preserved');
  const second = await marketData.getHistory('TSLA', 'd', { httpGet: transport });
  assert.equal(counters.calls, 1, 'cache hit must not refetch');
  assert.equal(second, first);
});

test('concurrent same-symbol requests deduplicate into one provider call', async () => {
  const counters = {};
  const slow = async url => {
    counters.calls = (counters.calls || 0) + 1;
    await new Promise(r => setTimeout(r, 20));
    return { data: { results: BARS, status: 'OK' } };
  };
  const [a, b] = await Promise.all([
    marketData.getHistory('RIVN', 'd', { httpGet: slow }),
    marketData.getHistory('RIVN', 'd', { httpGet: slow }),
  ]);
  assert.equal(counters.calls, 1, 'two consumers share one provider request');
  assert.equal(a, b);
});

test('different symbols and timeframes keep separate cache keys', async () => {
  const counters = {};
  const transport = okTransport(counters);
  await marketData.getHistory('NIO', 'd', { httpGet: transport });
  await marketData.getHistory('NIO', '4h', { httpGet: transport });
  assert.equal(counters.calls, 2, 'daily and intraday are independent cache entries');
  await marketData.getHistory('NIO', 'd', { httpGet: transport });
  await marketData.getHistory('NIO', '4h', { httpGet: transport });
  assert.equal(counters.calls, 2, 'both cache hits');
  await marketData.getHistory('XPEV', 'd', { httpGet: transport });
  assert.equal(counters.calls, 3, 'other symbols are independent');
});

test('transient failure with retained history serves stale data', async () => {
  const counters = {};
  const good = await marketData.getHistory('LI', 'd', { httpGet: okTransport(counters) });
  const restore = advance(11 * 60 * 1000);                 // past HISTORY_TTL_MS (10 min)
  try {
    const failing = async () => { throw statusError(500); };
    const stale = await marketData.getHistory('LI', 'd', { httpGet: failing });
    assert.equal(stale.stale, true);
    assert.equal(stale.provider, 'polygon');
    assert.deepEqual(stale.bars, good.bars);
  } finally { restore(); }
});

test('429 with retained history serves stale data instead of a 502', async () => {
  const counters = {};
  const good = await marketData.getHistory('PSNY', 'd', { httpGet: okTransport(counters) });
  const restore = advance(11 * 60 * 1000);
  try {
    const rateLimited = async () => { throw statusError(429); };
    const stale = await marketData.getHistory('PSNY', 'd', { httpGet: rateLimited });
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.bars, good.bars);
  } finally { restore(); }
});

test('failure without retained history surfaces a controlled error', async () => {
  const failing = async () => { throw statusError(429); };
  await assert.rejects(() => marketData.getHistory('LCID', 'd', { httpGet: failing }), /http 429/);
});

test('malformed provider payload is a controlled failure, not cached as success', async () => {
  let calls = 0;
  const malformed = async () => { calls++; return { data: { status: 'OK' } }; };   // no results array
  await assert.rejects(() => marketData.getHistory('F', 'd', { httpGet: malformed }), /no results/);
  await assert.rejects(() => marketData.getHistory('F', 'd', { httpGet: malformed }), /no results/);
  assert.equal(calls, 2, 'failures are not cached');
});
