import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmpGrowth } from '../src/backend/providers/financials-provider.js';
import marketData from '../src/backend/services/market-data.js';
import config from '../src/backend/config/index.js';

/* ------------------------------------------------------------------ *
 * Lazy growth: provider mapping + per-symbol cache behaviour.          *
 * Unit tests use an injected transport — no live FMP calls.           *
 * ------------------------------------------------------------------ */

function growthRow(date, period, year, rev, gp, op, ni, eps) {
  return {
    date, period, fiscalYear: year,
    growthRevenue: rev, growthGrossProfit: gp, growthOperatingIncome: op,
    growthNetIncome: ni, growthEPS: eps,
  };
}

const GROWTH_ROWS = [
  growthRow('2026-06-30', 'Q2', '2026', 0.26, 0.31, 0.42, 0.55, 0.48),
  growthRow('2026-03-31', 'Q1', '2026', 0.18, 0.20, 0.25, 0.30, 0.28),
  growthRow('2025-12-31', 'Q4', '2025', 0.02, 0.03, 0.04, 0.05, 0.06),
  growthRow('2025-09-30', 'Q3', '2025', -0.05, -0.06, -0.07, -0.08, -0.09),
  growthRow('2025-06-30', 'Q2', '2025', 0, 0, 0, 0, 0),
];

function httpError(status, body) {
  const e = new Error('http ' + status);
  e.response = { status, data: body === undefined ? { message: 'x' } : body };
  return e;
}

/** Canned growth endpoint transport; records every call. */
function makeTransport(handler = () => GROWTH_ROWS) {
  const calls = [];
  const httpGet = async (url, opts = {}) => {
    calls.push({ url, params: opts.params || {} });
    if (!url.endsWith('/income-statement-growth')) throw new Error('unexpected endpoint ' + url);
    const result = handler();
    if (result instanceof Error) throw result;
    return { status: 200, data: result };
  };
  return { httpGet, calls };
}

/* ---- provider ------------------------------------------------------ */

test('growth uses the single /stable income-statement-growth endpoint with limit 5', async () => {
  const { httpGet, calls } = makeTransport();
  const d = await fmpGrowth('TSLA', { httpGet });
  assert.equal(calls.length, 1, 'exactly one request');
  assert.equal(calls[0].url, 'https://financialmodelingprep.com/stable/income-statement-growth');
  assert.equal(calls[0].params.period, 'quarter');
  assert.equal(calls[0].params.limit, 5);
  assert.equal(calls[0].params.symbol, 'TSLA');
  assert.equal(d.provider, 'fmp');
  assert.equal(d.growthMode, 'real');
  assert.equal(d.asOf, '2026-06-30', 'as-of date is the newest reported quarter');
});

test('growth maps provider fields newest-first with provider labels and signs', async () => {
  const { httpGet } = makeTransport();
  const d = await fmpGrowth('TSLA', { httpGet });
  const h = d.growthHistory;
  assert.equal(h.length, 5);
  assert.deepEqual(h.map(r => r.label), ['Q2 2026', 'Q1 2026', 'Q4 2025', 'Q3 2025', 'Q2 2025']);
  assert.equal(h[0].date, '2026-06-30');
  assert.equal(h[0].fiscalYear, '2026');
  assert.equal(h[0].period, 'Q2');
  assert.equal(h[0].revenueGrowth, 0.26);
  assert.equal(h[0].grossProfitGrowth, 0.31);
  assert.equal(h[0].operatingIncomeGrowth, 0.42);
  assert.equal(h[0].netIncomeGrowth, 0.55);
  assert.equal(h[0].epsGrowth, 0.48);
  assert.equal(h[3].revenueGrowth, -0.05, 'negative growth sign preserved');
  assert.equal(h[4].revenueGrowth, 0, 'legitimate zero preserved');
  assert.equal(h[4].epsGrowth, 0);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
});

test('growth missing values become null and bad numerics are rejected', async () => {
  const rows = [
    { date: '2026-06-30', period: 'Q2', fiscalYear: '2026' },
    { date: '2026-03-31', period: 'Q1', fiscalYear: '2026', growthRevenue: 'abc', growthEPS: null },
  ];
  const { httpGet } = makeTransport(() => rows);
  const d = await fmpGrowth('TSLA', { httpGet });
  assert.equal(d.growthHistory[0].revenueGrowth, null);
  assert.equal(d.growthHistory[0].epsGrowth, null);
  assert.equal(d.growthHistory[1].revenueGrowth, null);
  assert.equal(d.growthHistory[1].epsGrowth, null);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
});

test('growth caps history at five rows and tolerates a single row', async () => {
  const six = GROWTH_ROWS.concat([growthRow('2025-03-31', 'Q1', '2025', 0.01, 0.01, 0.01, 0.01, 0.01)]);
  const full = await fmpGrowth('TSLA', { httpGet: makeTransport(() => six).httpGet });
  assert.equal(full.growthHistory.length, 5);
  const one = await fmpGrowth('TSLA', { httpGet: makeTransport(() => [GROWTH_ROWS[0]]).httpGet });
  assert.equal(one.growthHistory.length, 1);
  assert.equal(one.growthMode, 'real');
});

test('empty growth dataset yields an explicit unavailable payload', async () => {
  const { httpGet } = makeTransport(() => []);
  const d = await fmpGrowth('TSLA', { httpGet });
  assert.equal(d.growthMode, 'unavailable');
  assert.deepEqual(d.growthHistory, []);
  assert.match(d.note, /unavailable/i);
});

test('non-array growth response is treated as unavailable, not a crash', async () => {
  const { httpGet } = makeTransport(() => ({ symbol: 'TSLA' }));
  const d = await fmpGrowth('TSLA', { httpGet });
  assert.equal(d.growthMode, 'unavailable');
  assert.deepEqual(d.growthHistory, []);
});

test('growth errors propagate (caller decides stale vs unavailable) and no key leaks', async () => {
  const restricted = makeTransport(() => httpError(402));
  await assert.rejects(() => fmpGrowth('LI', { httpGet: restricted.httpGet }), /http 402/);
  const { httpGet } = makeTransport();
  const d = await fmpGrowth('TSLA', { httpGet });
  const json = JSON.stringify(d);
  assert.ok(!json.includes('apikey'));
  assert.ok(!json.includes('financialmodelingprep.com'));
  if (config.FMP_KEY) assert.ok(!json.includes(config.FMP_KEY), 'API key leaked');
});

/* ---- lazy cache (market-data facade) -------------------------------- *
 * Each test uses distinct symbols so the process-wide growth cache stays
 * isolated without any cache-reset hook.                                */

test('growth is fetched once per symbol: first call 1 request, second call 0', async () => {
  const { httpGet, calls } = makeTransport();
  const first = await marketData.getGrowth('TSLA', { httpGet });
  assert.equal(calls.length, 1);
  const second = await marketData.getGrowth('TSLA', { httpGet });
  assert.equal(calls.length, 1, 'cache hit must not refetch');
  assert.deepEqual(second, first);
  assert.equal(second.growthMode, 'real');
});

test('growth cache is per symbol', async () => {
  const { httpGet, calls } = makeTransport();
  await marketData.getGrowth('RIVN', { httpGet });
  await marketData.getGrowth('XPEV', { httpGet });
  assert.equal(calls.length, 2);
  await marketData.getGrowth('RIVN', { httpGet });
  assert.equal(calls.length, 2, 'each symbol cached independently');
});

test('402 subscription restriction → unavailable, cached for the TTL', async () => {
  const { httpGet, calls } = makeTransport(() => httpError(402));
  const first = await marketData.getGrowth('LI', { httpGet });
  assert.equal(calls.length, 1);
  assert.equal(first.provider, 'fmp');
  assert.equal(first.growthMode, 'unavailable');
  assert.match(first.note, /subscription/i);
  const second = await marketData.getGrowth('LI', { httpGet });
  assert.equal(calls.length, 1, 'unavailable result cached for the TTL');
  assert.deepEqual(second, first);
});

test('200 with an empty growth array → unavailable, cached for the TTL', async () => {
  const { httpGet, calls } = makeTransport(() => []);
  const first = await marketData.getGrowth('NIO', { httpGet });
  assert.equal(calls.length, 1);
  assert.equal(first.growthMode, 'unavailable');
  assert.deepEqual(first.growthHistory, []);
  assert.match(first.note, /unavailable/i);
  const second = await marketData.getGrowth('NIO', { httpGet });
  assert.equal(calls.length, 1, 'empty dataset cached for the TTL');
  assert.deepEqual(second, first);
});

test('403 with an explicit subscription/entitlement message → unavailable, cached', async () => {
  const { httpGet, calls } = makeTransport(
    () => httpError(403, 'Exclusive Endpoint: this endpoint is only for users with a premium subscription.'),
  );
  const first = await marketData.getGrowth('F', { httpGet });
  assert.equal(calls.length, 1);
  assert.equal(first.growthMode, 'unavailable');
  assert.match(first.note, /subscription/i);
  const second = await marketData.getGrowth('F', { httpGet });
  assert.equal(calls.length, 1, 'entitlement failure cached for the TTL');
  assert.deepEqual(second, first);

  const entitlement = makeTransport(() => httpError(403, { error: 'Your current plan does not include this data set.' }));
  const d = await marketData.getGrowth('GM', { httpGet: entitlement.httpGet });
  assert.equal(d.growthMode, 'unavailable');
  assert.match(d.note, /subscription/i);
});

test('401 is a controlled authorization error — not unavailable, never cached', async () => {
  const { httpGet, calls } = makeTransport(() => httpError(401, 'invalid key FAKE-SECRET-123'));
  await assert.rejects(() => marketData.getGrowth('GME', { httpGet }), /authorization rejected .*HTTP 401/);
  await assert.rejects(() => marketData.getGrowth('GME', { httpGet }), /HTTP 401/);
  assert.equal(calls.length, 2, 'auth failures must not be cached as valid results');
});

test('generic 403 (no entitlement wording) is a controlled authorization error', async () => {
  const { httpGet, calls } = makeTransport(() => httpError(403, 'Forbidden'));
  await assert.rejects(() => marketData.getGrowth('AMC', { httpGet }), /HTTP 403/);
  assert.equal(calls.length, 1);
  await assert.rejects(() => marketData.getGrowth('AMC', { httpGet }), /HTTP 403/);
  assert.equal(calls.length, 2, 'generic 403 must not be cached');
});

test('authorization errors expose no provider body, URL or API key', async () => {
  const marker = 'FAKE-CRED-123';
  const { httpGet } = makeTransport(() => httpError(401, `bad key ${marker} at https://financialmodelingprep.com/stable`));
  let message = '';
  try {
    await marketData.getGrowth('RDDT', { httpGet });
    assert.fail('expected a rejection');
  } catch (e) {
    message = e.message;
  }
  assert.match(message, /HTTP 401/);
  assert.ok(!message.includes(marker), 'provider body leaked into the error');
  assert.ok(!message.includes('apikey'), 'request internals leaked into the error');
  assert.ok(!message.includes('financialmodelingprep.com'), 'provider URL leaked into the error');
  if (config.FMP_KEY) assert.ok(!message.includes(config.FMP_KEY), 'API key leaked into the error');
});

test('transient growth failure without prior data returns unavailable (not a throw)', async () => {
  const { httpGet } = makeTransport(() => httpError(500));
  const d = await marketData.getGrowth('SOFI', { httpGet });
  assert.equal(d.growthMode, 'unavailable');
  assert.match(d.note, /failed/i);
});

test('expired growth cache serves the last known data when the provider fails', async () => {
  const good = makeTransport();
  const first = await marketData.getGrowth('PSNY', { httpGet: good.httpGet });
  assert.equal(first.growthMode, 'real');
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 13 * 60 * 60 * 1000;   // 13h later: TTL expired
    const failing = makeTransport(() => httpError(500));
    const stale = await marketData.getGrowth('PSNY', { httpGet: failing.httpGet });
    assert.equal(stale.growthMode, 'real', 'last known growth retained');
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.growthHistory, first.growthHistory);
  } finally {
    Date.now = realNow;
  }
});

test('a 401 after expiry never overwrites retained real growth with unavailable', async () => {
  const good = makeTransport();
  const first = await marketData.getGrowth('LCID', { httpGet: good.httpGet });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 13 * 60 * 60 * 1000;
    const auth = makeTransport(() => httpError(401, 'bad key'));
    await assert.rejects(() => marketData.getGrowth('LCID', { httpGet: auth.httpGet }), /HTTP 401/);
    const transient = makeTransport(() => httpError(500));
    const stale = await marketData.getGrowth('LCID', { httpGet: transient.httpGet });
    assert.equal(stale.growthMode, 'real', 'auth failure left the retained real payload intact');
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.growthHistory, first.growthHistory);
  } finally {
    Date.now = realNow;
  }
});
