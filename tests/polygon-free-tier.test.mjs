import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as polygon from '../src/backend/providers/polygon-provider.js';
import streamModule from '../src/backend/providers/polygon-stream.js';

// CJS interop: the stream module mixes getters and functions in its exports,
// so the named-export lexer does not surface everything to ESM tests.
const { createStream, classifyStatus } = streamModule;

/* ------------------------------------------------------------------ *
 * Snapshot / completed-daily-aggregate fallback (injected transport)  *
 * ------------------------------------------------------------------ */

const SNAPSHOT_TICKER = {
  ticker: 'TSLA',
  lastTrade: { p: 255.5 },
  todaysChange: 4.5,
  todaysChangePerc: 1.79,
  day: { v: 123456 },
};

/* Monday 2026-09-14 and Friday 2026-09-11 (a weekend gap between sessions). */
const LATEST_BAR = { t: Date.UTC(2026, 8, 14), c: 358.97, o: 356.1, h: 361.2, l: 354.8, v: 32477181, vw: 358.1 };
const PRIOR_BAR = { t: Date.UTC(2026, 8, 11), c: 350, o: 348, h: 352, l: 347, v: 30000000, vw: 349.5 };
const THURS_BAR = { t: Date.UTC(2026, 8, 10), c: 345, o: 344, h: 346, l: 343, v: 29000000, vw: 344.5 };
const TODAY_PARTIAL_BAR = { t: Date.UTC(2026, 8, 14), c: 360, o: 356, h: 362, l: 355, v: 9000000, vw: 359 };

const NOW_DURING_SESSION = new Date('2026-09-14T19:00:00Z');   // Monday 15:00 ET — session open
const NOW_AFTER_CLOSE = new Date('2026-09-14T20:30:00Z');      // Monday 16:30 ET — session complete

function snapshot403() {
  const e = new Error('Forbidden');
  e.response = { status: 403, data: { error: 'NOT_AUTHORIZED' } };
  return e;
}

test('snapshot success keeps the existing realtime behaviour', async () => {
  polygon.resetQuoteState();
  const calls = [];
  const httpGet = async url => { calls.push(url); return { data: { tickers: [SNAPSHOT_TICKER] } }; };

  const quotes = await polygon.polyQuotes(['TSLA'], { httpGet });
  const q = quotes.get('TSLA');
  assert.equal(q.price, 255.5);
  assert.equal(q.change, 4.5);
  assert.equal(q.percentChange, 1.79);
  assert.equal(q.volume, 123456);
  assert.equal(q.dataMode, 'realtime');
  assert.equal(polygon.getQuoteMode(), 'realtime');
  assert.ok(!calls.some(u => u.includes('/range/')), 'no fallback call on snapshot success');
});

test('snapshot 403 falls back to one daily range request with close-vs-previous-close change', async () => {
  polygon.resetQuoteState();
  const calls = [];
  const httpGet = async url => {
    calls.push(url);
    if (url.includes('/v2/snapshot/')) throw snapshot403();
    if (url.includes('/range/1/day/')) return { data: { results: [LATEST_BAR, PRIOR_BAR] } };
    throw new Error('unexpected url ' + url);
  };

  const quotes = await polygon.polyQuotes(['TSLA'], { httpGet });
  const q = quotes.get('TSLA');
  assert.equal(q.price, 358.97, 'latest completed close');
  assert.equal(q.previousClose, 350, 'prior completed close');
  assert.equal(q.change, 8.97);
  assert.ok(Math.abs(q.percentChange - 2.562857) < 0.005);
  assert.equal(q.open, 356.1);
  assert.equal(q.high, 361.2);
  assert.equal(q.low, 354.8);
  assert.equal(q.volume, 32477181);
  assert.equal(q.vwap, 358.1);
  assert.equal(q.sessionDate, '2026-09-14');
  assert.equal(q.dataMode, 'eod');
  assert.equal(polygon.getQuoteMode(), 'eod');
  assert.equal(calls.filter(u => u.includes('/range/1/day/')).length, 1, 'exactly one range request per symbol');
  assert.ok(!calls.some(u => u.includes('/prev')), 'no second per-symbol request');
  for (const key of ['price', 'previousClose', 'change', 'percentChange', 'volume', 'vwap']) {
    assert.ok(Number.isFinite(q[key]), `${key} must be finite`);
  }
});

test('EOD mode is not re-probed and the range result is cached', async () => {
  polygon.resetQuoteState();
  let calls = 0;
  const httpGet = async url => {
    calls++;
    if (url.includes('/v2/snapshot/')) throw snapshot403();
    return { data: { results: [LATEST_BAR, PRIOR_BAR] } };
  };

  await polygon.polyQuotes(['TSLA'], { httpGet });
  assert.equal(calls, 2);                                       // snapshot probe + one range fetch
  const quotes = await polygon.polyQuotes(['TSLA'], { httpGet });
  assert.equal(calls, 2, 'second call fully served from the daily cache');
  assert.equal(quotes.get('TSLA').previousClose, 350);
});

test('negative change is reported with the same convention', () => {
  const q = polygon.mapDailyBars('TSLA', [
    { ...LATEST_BAR, c: 358.97 },
    { ...PRIOR_BAR, c: 365 },
  ], NOW_AFTER_CLOSE);
  assert.equal(q.previousClose, 365);
  assert.equal(q.change, -6.03);
  assert.ok(Math.abs(q.percentChange - (-1.65205)) < 0.005);
});

test('weekend/holiday gaps select adjacent trading sessions and skip a partial current session', () => {
  // During Monday's session the partial 09-14 bar must be ignored: Friday 09-11
  // and Thursday 09-10 are the two completed sessions despite the calendar gap.
  const open = polygon.mapDailyBars('TSLA', [TODAY_PARTIAL_BAR, PRIOR_BAR, THURS_BAR], NOW_DURING_SESSION);
  assert.equal(open.sessionDate, '2026-09-11');
  assert.equal(open.price, 350);
  assert.equal(open.previousClose, 345);
  assert.equal(open.change, 5);

  // After the close the same day becomes usable.
  const closed = polygon.mapDailyBars('TSLA', [TODAY_PARTIAL_BAR, PRIOR_BAR, THURS_BAR], NOW_AFTER_CLOSE);
  assert.equal(closed.sessionDate, '2026-09-14');
  assert.equal(closed.price, 360);
  assert.equal(closed.previousClose, 350);
  assert.equal(closed.change, 10);

  const order = polygon.selectCompletedSessions([PRIOR_BAR, LATEST_BAR], NOW_AFTER_CLOSE).map(b => b.t);
  assert.deepEqual(order, [LATEST_BAR.t, PRIOR_BAR.t], 'newest first');
});

test('a single completed session yields a price but null change fields', () => {
  const q = polygon.mapDailyBars('TSLA', [LATEST_BAR], NOW_AFTER_CLOSE);
  assert.equal(q.price, 358.97);
  assert.equal(q.previousClose, null);
  assert.equal(q.change, null);
  assert.equal(q.percentChange, null);
  assert.equal(q.sessionDate, '2026-09-14');
  for (const key of ['price', 'open', 'high', 'low', 'volume']) {
    assert.ok(Number.isFinite(q[key]), `${key} must be finite`);
  }
});

test('mapped EOD quotes never contain NaN/Infinity/undefined', () => {
  const q = polygon.mapDailyBars('TSLA', [
    { ...LATEST_BAR, v: null, vw: null },
    { ...PRIOR_BAR, c: null },
  ], NOW_AFTER_CLOSE);
  assert.equal(q.volume, 0);
  assert.equal(q.vwap, null);
  assert.equal(q.previousClose, null);
  assert.equal(q.change, null);
  assert.equal(q.percentChange, null);
  assert.throws(() => polygon.mapDailyBars('TSLA', [], NOW_AFTER_CLOSE));
  assert.throws(() => polygon.mapDailyBars('TSLA', undefined, NOW_AFTER_CLOSE));
});

test('invalid API key (401) surfaces and is not mistaken for a plan limitation', async () => {
  polygon.resetQuoteState();
  const calls = [];
  const httpGet = async url => {
    calls.push(url);
    const e = new Error('Unauthorized');
    e.response = { status: 401, data: { error: 'Unknown API Key' } };
    throw e;
  };

  await assert.rejects(() => polygon.polyQuotes(['TSLA'], { httpGet }));
  assert.equal(polygon.getQuoteMode(), 'unknown');
  assert.ok(!calls.some(u => u.includes('/range/')), 'no fallback for invalid credentials');
});

test('server errors surface unchanged (no fallback)', async () => {
  polygon.resetQuoteState();
  const httpGet = async () => {
    const e = new Error('Server Error');
    e.response = { status: 500 };
    throw e;
  };
  await assert.rejects(() => polygon.polyQuotes(['TSLA'], { httpGet }));
  assert.equal(polygon.getQuoteMode(), 'unknown');
});

test('entitlement/rate-limit predicates classify provider errors', () => {
  assert.equal(polygon.isEntitlementError({ response: { status: 403 } }), true);
  assert.equal(polygon.isEntitlementError({ response: { status: 401 } }), false);
  assert.equal(polygon.isEntitlementError(new Error('network')), false);
  assert.equal(polygon.isRateLimitError({ response: { status: 429 } }), true);
  assert.equal(polygon.isRateLimitError({ response: { status: 403 } }), false);
});

test('request scheduler stays unthrottled until a rate limit and then paces calls', async () => {
  const scheduler = polygon.createScheduler(20);
  assert.equal(scheduler.pacing, 0);
  const t0 = Date.now();
  await scheduler.run(async () => 1);
  await scheduler.run(async () => 2);
  assert.ok(Date.now() - t0 < 15, 'unthrottled scheduler must not delay calls');

  assert.equal(scheduler.noteRateLimit(), true, 'first 429 enables pacing');
  assert.equal(scheduler.noteRateLimit(), false, 'later 429s do not re-log');
  assert.equal(scheduler.pacing, 20);

  const t1 = Date.now();
  await scheduler.run(async () => 3);
  await scheduler.run(async () => 4);
  assert.ok(Date.now() - t1 >= 15, 'paced calls must be spaced out');
});

test('scheduler priority: interactive requests overtake queued background work', async () => {
  const scheduler = polygon.createScheduler(0);   // pacing off — pure queue ordering
  const order = [];
  const low = scheduler.run(async () => { await new Promise(r => setTimeout(r, 5)); order.push('low-1'); }, 'low');
  const high = scheduler.run(async () => { order.push('high-1'); }, 'high');
  const low2 = scheduler.run(async () => { order.push('low-2'); }, 'low');
  await Promise.all([low, high, low2]);
  // low-1 was already in flight; the queued high-1 overtakes the queued low-2.
  assert.deepEqual(order, ['low-1', 'high-1', 'low-2']);
});

/* ------------------------------------------------------------------ *
 * WebSocket reconnect policy (fake socket — no network)               *
 * ------------------------------------------------------------------ */

class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;                                      // WebSocket.OPEN
    this.handlers = {};
    FakeSocket.instances.push(this);
  }
  on(event, cb) { (this.handlers[event] = this.handlers[event] || []).push(cb); return this; }
  send() {}
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', 1000, '');
  }
  emit(event, ...args) { (this.handlers[event] || []).forEach(cb => cb(...args)); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('classifyStatus distinguishes entitlement, transient and other statuses', () => {
  assert.equal(classifyStatus('auth_success', ''), 'auth_ok');
  assert.equal(classifyStatus('auth_failed', ''), 'permanent');
  assert.equal(classifyStatus('auth_timeout', ''), 'permanent');
  assert.equal(classifyStatus('error', 'NOT_AUTHORIZED'), 'permanent');
  assert.equal(classifyStatus('error', 'subscription failed'), 'error');
  assert.equal(classifyStatus('success', ''), 'ignore');
  assert.equal(classifyStatus(undefined, undefined), 'ignore');
});

test('permanent entitlement rejection stops the reconnect loop', async () => {
  FakeSocket.instances = [];
  const stream = createStream({ apiKey: 'test-key', socketFactory: FakeSocket, baseReconnectMs: 5 });
  let unavailableCalls = 0;
  assert.equal(stream.start({
    getSymbols: () => ['TSLA'],
    onTick: () => {},
    onUnavailable: () => { unavailableCalls++; },
  }), true);
  assert.equal(FakeSocket.instances.length, 1);

  FakeSocket.instances[0].emit('open');
  FakeSocket.instances[0].emit('message', JSON.stringify([
    { ev: 'status', status: 'auth_failed', message: 'plan does not include websocket access' },
  ]));

  assert.equal(stream.unavailable, true);
  assert.equal(unavailableCalls, 1);
  await sleep(30);
  assert.equal(FakeSocket.instances.length, 1, 'no reconnect after a permanent rejection');
  assert.equal(stream.start({}), false, 'stream stays disabled for the session');
  stream.stop();
});

test('transient network failure still reconnects', async () => {
  FakeSocket.instances = [];
  const stream = createStream({ apiKey: 'test-key', socketFactory: FakeSocket, baseReconnectMs: 5, maxReconnectMs: 20 });
  stream.start({ getSymbols: () => ['TSLA'], onTick: () => {} });

  FakeSocket.instances[0].emit('error', new Error('ECONNRESET'));
  await sleep(30);
  assert.ok(FakeSocket.instances.length >= 2, 'expected a reconnect attempt after a transient failure');
  assert.equal(stream.unavailable, false);
  stream.stop();
});
