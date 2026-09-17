import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmpQuotes, fmpHistory, getQuoteMode, resetMarketState } from '../src/backend/providers/fmp-provider.js';
import config from '../src/backend/config/index.js';

/* ------------------------------------------------------------------ *
 * Fixtures + injected transport (no live FMP calls)                   *
 * ------------------------------------------------------------------ */

const STALE_TS = Math.floor(Date.now() / 1000) - 3600;   // 1 h old
const FRESH_TS = Math.floor(Date.now() / 1000);

function quoteRow(overrides = {}) {
  return {
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    price: 356.58,
    change: -2.39,
    changePercentage: -0.66579,
    volume: 30215079,
    previousClose: 358.97,
    open: 358.725,
    dayHigh: 362.39,
    dayLow: 354.06,
    timestamp: STALE_TS,
    exchange: 'NASDAQ',
    ...overrides,
  };
}

function historyRows(count = 65) {
  const rows = [];
  const start = Date.UTC(2026, 5, 1);
  for (let i = 0; i < count; i++) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    rows.push({ symbol: 'TSLA', date: d, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 + i });
  }
  return rows.reverse();   // provider returns newest-first
}

function makeTransport({ quote = quoteRow(), quoteError = null, history = historyRows(), historyError = null } = {}) {
  const calls = [];
  const httpGet = async (url, opts = {}) => {
    calls.push({ url, params: opts.params || {} });
    if (url.endsWith('/quote')) {
      if (quoteError) throw quoteError;
      return { data: [quote] };
    }
    if (url.endsWith('/historical-price-eod/full')) {
      if (historyError) throw historyError;
      return { data: history };
    }
    throw new Error('unexpected endpoint ' + url);
  };
  return { httpGet, calls };
}

/* ------------------------------------------------------------------ *
 * Endpoints and mapping                                               *
 * ------------------------------------------------------------------ */

test('uses /stable endpoints only (no legacy /api/v3)', async () => {
  resetMarketState();
  const { httpGet, calls } = makeTransport();
  await fmpQuotes(['TSLA'], { httpGet });
  await fmpHistory('TSLA', { httpGet });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.ok(c.url.startsWith('https://financialmodelingprep.com/stable/'), c.url);
    assert.ok(!c.url.includes('/api/v3'), 'legacy endpoint used');
  }
  assert.equal(calls[0].params.symbol, 'TSLA');
  assert.ok(calls[1].params.from && calls[1].params.to, 'history window sent');
});

test('maps a stable quote into the app quote schema', async () => {
  resetMarketState();
  const { httpGet } = makeTransport();
  const quotes = await fmpQuotes(['TSLA'], { httpGet });
  const q = quotes.get('TSLA');
  assert.equal(q.symbol, 'TSLA');
  assert.equal(q.name, 'Tesla, Inc.');
  assert.equal(q.price, 356.58);
  assert.equal(q.previousClose, 358.97);
  assert.equal(q.change, -2.39);
  assert.equal(q.percentChange, -0.66579);
  assert.equal(q.open, 358.725);
  assert.equal(q.high, 362.39);
  assert.equal(q.low, 354.06);
  assert.equal(q.volume, 30215079);
  assert.equal(q.timestamp, STALE_TS);
  assert.equal(q.provider, 'fmp');
});

test('quote missing optional fields become null (not 0/NaN)', async () => {
  resetMarketState();
  const { httpGet } = makeTransport({ quote: quoteRow({ previousClose: undefined, open: null, dayHigh: undefined, dayLow: '', volume: null, changePercentage: undefined, timestamp: undefined }) });
  const q = (await fmpQuotes(['TSLA'], { httpGet })).get('TSLA');
  for (const k of ['previousClose', 'open', 'high', 'low', 'volume', 'percentChange', 'timestamp']) {
    assert.equal(q[k], null, `${k} should be null`);
  }
  assert.equal(q.price, 356.58);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(q)));
});

test('legitimate zero values are preserved', async () => {
  resetMarketState();
  const { httpGet } = makeTransport({ quote: quoteRow({ change: 0, changePercentage: 0, volume: 0 }) });
  const q = (await fmpQuotes(['TSLA'], { httpGet })).get('TSLA');
  assert.equal(q.change, 0);
  assert.equal(q.percentChange, 0);
  assert.equal(q.volume, 0);
});

test('partial quote failure keeps successful symbols', async () => {
  resetMarketState();
  const calls = [];
  const httpGet = async (url, opts = {}) => {
    calls.push(opts.params.symbol);
    if (opts.params.symbol === 'RIVN') throw new Error('boom');
    return { data: [quoteRow({ symbol: 'TSLA' })] };
  };
  const quotes = await fmpQuotes(['TSLA', 'RIVN'], { httpGet });
  assert.equal(quotes.size, 1);
  assert.ok(quotes.has('TSLA'));
});

test('malformed or empty quote responses surface as errors', async () => {
  resetMarketState();
  for (const bad of [null, {}, []]) {
    const { httpGet } = makeTransport({ quote: bad });
    await assert.rejects(() => fmpQuotes(['TSLA'], { httpGet }));
  }
  const undef = { httpGet: async () => ({ data: undefined }) };
  await assert.rejects(() => fmpQuotes(['TSLA'], { httpGet: undef.httpGet }), /no quote/);
  const err = new Error('network down');
  const { httpGet } = makeTransport({ quoteError: err });
  await assert.rejects(() => fmpQuotes(['TSLA'], { httpGet }), /network down/);
});

/* ------------------------------------------------------------------ *
 * History mapping                                                     *
 * ------------------------------------------------------------------ */

test('maps stable EOD history to ascending 60-bar schema', async () => {
  resetMarketState();
  const { httpGet } = makeTransport();
  const h = await fmpHistory('TSLA', { httpGet });
  assert.equal(h.provider, 'fmp');
  assert.equal(h.bars.length, 60);
  for (let i = 1; i < h.bars.length; i++) {
    assert.ok(h.bars[i].date > h.bars[i - 1].date, 'bars must be chronological');
  }
  const last = h.bars[h.bars.length - 1];
  const first = h.bars[0];
  assert.equal(last.c, 165);           // newest row of the fixture (i = 64)
  assert.equal(first.c, 106);          // 60th-newest row
  for (const k of ['o', 'h', 'l', 'c', 'v']) assert.ok(Number.isFinite(last[k]), k);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(h)));
});

test('malformed history rows are dropped; empty history surfaces as an error', async () => {
  resetMarketState();
  const { httpGet } = makeTransport({
    history: [
      { date: '2026-09-15', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { date: '2026-09-12', open: null, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { open: 1, high: 2, low: 0.5, close: 1.5 },
      { date: '2026-09-11', open: 'bad', high: 2, low: 0.5, close: 1.5 },
    ],
  });
  const h = await fmpHistory('TSLA', { httpGet });
  assert.equal(h.bars.length, 1);
  assert.equal(h.bars[0].date, '2026-09-15');

  resetMarketState();
  const empty = makeTransport({ history: [] });
  await assert.rejects(() => fmpHistory('TSLA', { httpGet: empty.httpGet }), /no history/);

  resetMarketState();
  const malformed = makeTransport({ history: {} });
  await assert.rejects(() => fmpHistory('TSLA', { httpGet: malformed.httpGet }), /no history/);
});

/* ------------------------------------------------------------------ *
 * Caching, freshness, key safety                                      *
 * ------------------------------------------------------------------ */

test('quotes are cached for the TTL (no repeated requests)', async () => {
  resetMarketState();
  const { httpGet, calls } = makeTransport();
  await fmpQuotes(['TSLA', 'RIVN'], { httpGet });
  const afterFirst = calls.length;
  await fmpQuotes(['TSLA', 'RIVN'], { httpGet });
  assert.equal(calls.length, afterFirst, 'cache hit must not re-request');
});

test('stale-serving: expired cache survives provider failure (quotes and history)', async () => {
  resetMarketState();
  const ok = makeTransport();
  const q = (await fmpQuotes(['TSLA'], { httpGet: ok.httpGet })).get('TSLA');
  const h = await fmpHistory('TSLA', { httpGet: ok.httpGet });

  let calls = 0;
  const failing = async () => { calls++; throw new Error('429 Limit Reach'); };
  const q2 = (await fmpQuotes(['TSLA'], { httpGet: failing, maxAgeMs: 0 })).get('TSLA');
  const h2 = await fmpHistory('TSLA', { httpGet: failing, maxAgeMs: 0 });
  assert.equal(calls, 2, 'expired cache still attempts a refresh');
  assert.equal(q2.price, q.price, 'last known quote served on failure');
  assert.equal(h2.bars.length, h.bars.length, 'last known EOD bars served on failure');
});

test('history is cached for the TTL (no repeated requests)', async () => {
  resetMarketState();
  const { httpGet, calls } = makeTransport();
  await fmpHistory('TSLA', { httpGet });
  assert.equal(calls.length, 1);
  await fmpHistory('TSLA', { httpGet });
  assert.equal(calls.length, 1, 'history cache hit must not re-request');
});

test('data mode is EOD for stale quotes and realtime only for fresh ones', async () => {
  resetMarketState();
  const stale = makeTransport();
  await fmpQuotes(['TSLA'], { httpGet: stale.httpGet });
  assert.equal(getQuoteMode(), 'eod');

  resetMarketState();
  const fresh = makeTransport({ quote: quoteRow({ timestamp: FRESH_TS }) });
  await fmpQuotes(['TSLA'], { httpGet: fresh.httpGet });
  assert.equal(getQuoteMode(), 'realtime');
});

test('no API key or provider URL leaks into normalized output', async () => {
  resetMarketState();
  const { httpGet } = makeTransport();
  const quotes = await fmpQuotes(['TSLA'], { httpGet });
  const h = await fmpHistory('TSLA', { httpGet });
  const json = JSON.stringify([...quotes.values()]) + JSON.stringify(h);
  assert.ok(!json.includes('apikey'), 'request internals leaked');
  assert.ok(!json.includes('financialmodelingprep'), 'provider URL leaked');
  if (config.FMP_KEY) assert.ok(!json.includes(config.FMP_KEY), 'API key leaked');
});

/* ------------------------------------------------------------------ *
 * Plan-restriction caching (per capability, mocked transport only)     *
 * ------------------------------------------------------------------ */

function statusError(status, body) {
  const e = new Error('http ' + status);
  e.response = { status, data: body === undefined ? { message: 'x' } : body };
  return e;
}

test('plan-restricted quotes are not retried inside the restriction TTL', async () => {
  resetMarketState();
  let calls = 0;
  const restricted = async () => { calls++; throw statusError(402); };
  await assert.rejects(() => fmpQuotes(['XPEV'], { httpGet: restricted }), /402/);
  assert.equal(calls, 1);
  await assert.rejects(() => fmpQuotes(['XPEV'], { httpGet: restricted }), /restricted/i);
  assert.equal(calls, 1, 'second request inside the TTL must not call the provider');

  // an entitled symbol in the same session still fetches normally
  const ok = makeTransport();
  const quotes = await fmpQuotes(['TSLA'], { httpGet: ok.httpGet });
  assert.equal(quotes.get('TSLA').price, 356.58);
  assert.equal(ok.calls.length, 1);
});

test('quote restriction expiry allows one fresh attempt and recovers on success', async () => {
  resetMarketState();
  let calls = 0;
  const restricted = async () => { calls++; throw statusError(402); };
  await assert.rejects(() => fmpQuotes(['XPEV'], { httpGet: restricted }));
  assert.equal(calls, 1);

  const real = Date.now;
  try {
    Date.now = () => real() + config.FMP_RESTRICTION_TTL_MS + 1000;
    const ok = makeTransport();
    const quotes = await fmpQuotes(['XPEV'], { httpGet: ok.httpGet });
    assert.equal(calls, 1, 'no extra restricted attempt while checking expiry');
    assert.equal(ok.calls.length, 1, 'exactly one fresh attempt after expiry');
    assert.equal(quotes.get('XPEV').provider, 'fmp', 'success clears the restriction');
    Date.now = () => real() + config.FMP_RESTRICTION_TTL_MS + 2000;
    await fmpQuotes(['XPEV'], { httpGet: ok.httpGet });
    assert.equal(ok.calls.length, 1, 'successful symbol uses the quote TTL cache, not the restriction');
  } finally { Date.now = real; }
});

test('401, generic 403, 429, 5xx and network failures are never negative-cached', async () => {
  for (const [label, err] of [
    ['401', statusError(401)],
    ['generic 403', statusError(403, 'Forbidden')],
    ['429', statusError(429)],
    ['5xx', statusError(500)],
    ['network', new Error('ECONNRESET')],
  ]) {
    resetMarketState();
    let calls = 0;
    const failing = async () => { calls++; throw err; };
    await assert.rejects(() => fmpQuotes(['TSLA'], { httpGet: failing }));
    await assert.rejects(() => fmpQuotes(['TSLA'], { httpGet: failing }));
    assert.equal(calls, 2, `${label} must not be negative-cached as a restriction`);
  }
});

test('entitlement-worded 403 is negative-cached like a 402', async () => {
  resetMarketState();
  let calls = 0;
  const ent = async () => { calls++; throw statusError(403, { message: 'not entitled under the current subscription' }); };
  await assert.rejects(() => fmpQuotes(['LI'], { httpGet: ent }));
  await assert.rejects(() => fmpQuotes(['LI'], { httpGet: ent }), /restricted/i);
  assert.equal(calls, 1);
});

test('history restrictions are cached independently from quote restrictions', async () => {
  resetMarketState();
  let quoteCalls = 0;
  const quote402 = async () => { quoteCalls++; throw statusError(402); };
  await assert.rejects(() => fmpQuotes(['XPEV'], { httpGet: quote402 }));
  assert.equal(quoteCalls, 1);

  let historyCalls = 0;
  const history402 = async () => { historyCalls++; throw statusError(402); };
  await assert.rejects(() => fmpHistory('XPEV', { httpGet: history402 }), /402/);
  assert.equal(historyCalls, 1, 'a quote restriction must not suppress the first history attempt');
  await assert.rejects(() => fmpHistory('XPEV', { httpGet: history402 }), /restricted/i);
  assert.equal(historyCalls, 1, 'second history request inside the TTL makes 0 provider calls');
});

test('history restriction does not suppress the quote capability for the same symbol', async () => {
  resetMarketState();
  let historyCalls = 0;
  const history402 = async () => { historyCalls++; throw statusError(402); };
  await assert.rejects(() => fmpHistory('ALB', { httpGet: history402 }));
  assert.equal(historyCalls, 1);

  const ok = makeTransport({ quote: quoteRow({ symbol: 'ALB' }) });
  const quotes = await fmpQuotes(['ALB'], { httpGet: ok.httpGet });
  assert.equal(ok.calls.length, 1, 'quote capability performs its own first request');
  assert.equal(quotes.get('ALB').provider, 'fmp');
});

test('history restriction expiry allows one fresh attempt', async () => {
  resetMarketState();
  let calls = 0;
  const restricted = async () => { calls++; throw statusError(402); };
  await assert.rejects(() => fmpHistory('PSNY', { httpGet: restricted }));
  await assert.rejects(() => fmpHistory('PSNY', { httpGet: restricted }), /restricted/i);
  assert.equal(calls, 1);
  const real = Date.now;
  try {
    Date.now = () => real() + config.FMP_RESTRICTION_TTL_MS + 1000;
    const ok = makeTransport();
    const h = await fmpHistory('PSNY', { httpGet: ok.httpGet });
    assert.equal(calls, 1);
    assert.equal(ok.calls.length, 1, 'one fresh attempt after expiry');
    assert.equal(h.provider, 'fmp');
  } finally { Date.now = real; }
});
