'use strict';

/**
 * Polygon/Massive REST wrappers (daily + intraday aggregates, reference data,
 * snapshot quotes with a completed-daily-aggregate fallback).
 *
 * Snapshot entitlement varies by plan: free-tier keys receive HTTP 403
 * NOT_AUTHORIZED for `/v2/snapshot/...`. In that case quotes fall back to a
 * single daily range request per symbol covering the last two COMPLETED US
 * trading sessions, and serve the conventional daily change
 * (close vs previous close) labelled as EOD — never presented as realtime.
 * Invalid keys (HTTP 401), server errors and malformed responses are not
 * treated as entitlement limitations and still surface.
 */
const axios = require('axios');
const { POLYGON_KEY } = require('../config');

const API_BASE = 'https://api.polygon.io';
const nameCache = new Map(); // sym → company name

/** Free plans allow 5 REST calls/minute; pace to ~4.8/min once a 429 is seen.
 *  Paid plans are unlimited and stay unthrottled (the scheduler only activates
 *  after the provider actually rejects a request). */
const THROTTLE_MS = Number(process.env.POLYGON_THROTTLE_MS) > 0
  ? Number(process.env.POLYGON_THROTTLE_MS)
  : 12500;

/** Session quote source: 'unknown' | 'realtime' | 'eod'. */
let quoteMode = 'unknown';
let fallbackLogged = false;

/** Completed daily aggregates are static intraday — cache them to keep the
 *  request volume compatible with free-tier rate limits. */
const DAILY_TTL_MS = 10 * 60 * 1000;
const dailyCache = new Map(); // sym → { quote, fetchedAt }
/** Same-symbol EOD fetches share one provider request (browser quote prefetch
 *  racing the background poller must not duplicate REST calls). */
const dailyInflight = new Map(); // sym → in-flight promise
/** In-flight snapshot entitlement decision shared by concurrent callers, so
 *  the session performs exactly one snapshot probe. */
let snapshotProbe = null;

/** 429 = plan rate limit reached (free tier: 5 calls/minute). */
function isRateLimitError(e) {
  return !!(e && e.response && e.response.status === 429);
}

/**
 * Serial request scheduler with priority lanes. Stays unthrottled until the
 * provider answers 429, then paces every subsequent request to one per
 * `throttleMs` for the session. Interactive requests (default 'high') jump
 * ahead of background polling ('low') between calls, so the free-tier budget
 * never lets the poller starve the UI. Exported for unit tests.
 */
function createScheduler(throttleMs = THROTTLE_MS) {
  let pacingMs = 0;
  let lastAt = 0;
  let running = false;
  const lanes = { high: [], low: [] };

  function next() {
    return lanes.high.length ? lanes.high.shift() : lanes.low.shift();
  }

  async function drain() {
    if (running) return;
    running = true;
    for (let job = next(); job; job = next()) {
      if (pacingMs > 0 && lastAt) {
        const wait = pacingMs - (Date.now() - lastAt);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      lastAt = Date.now();
      try {
        job.resolve(await job.task());
      } catch (e) {
        job.reject(e);
      }
    }
    running = false;
    if (next()) drain();          // re-check in case a job arrived during the final await
  }

  return {
    /** Enables pacing on the first rate-limit rejection; returns true once. */
    noteRateLimit() {
      if (pacingMs > 0) return false;
      pacingMs = throttleMs;
      return true;
    },
    /** Enables pacing before any 429 — used once the account is known to be
     *  on the free/EOD compatibility path (snapshot entitlement 403), so the
     *  first provider burst is paced instead of discovered via rejection.
     *  Returns true when pacing was newly enabled. */
    enablePacing() {
      if (pacingMs > 0) return false;
      pacingMs = throttleMs;
      return true;
    },
    /** Clears pacing and spacing state (session reset / tests). */
    resetPacing() {
      pacingMs = 0;
      lastAt = 0;
    },
    get pacing() { return pacingMs; },
    run(task, priority = 'high') {
      return new Promise((resolve, reject) => {
        (priority === 'low' ? lanes.low : lanes.high).push({ task, resolve, reject });
        drain();
      });
    },
  };
}

const scheduler = createScheduler();

/** Active session scheduler pacing in ms (0 = unthrottled). Exported for tests. */
function getSessionPacing() {
  return scheduler.pacing;
}

/** Default transport: schedules the call and activates pacing on the first 429. */
async function polygonGet(url, opts, priority = 'high') {
  try {
    return await scheduler.run(() => axios.get(url, opts), priority);
  } catch (e) {
    if (isRateLimitError(e) && scheduler.noteRateLimit()) {
      console.warn(`[polygon-provider] rate limit reached — pacing provider requests to one per ${scheduler.pacing}ms`);
    }
    throw e;
  }
}

function getQuoteMode() {
  return quoteMode;
}

/** Resets session quote-source state (used by tests and future config reloads). */
function resetQuoteState() {
  quoteMode = 'unknown';
  fallbackLogged = false;
  snapshotProbe = null;
  dailyCache.clear();
  dailyInflight.clear();
  scheduler.resetPacing();
}

/** 403 = the plan is not entitled to the endpoint. 401 (invalid key) must surface. */
function isEntitlementError(e) {
  return !!(e && e.response && e.response.status === 403);
}

async function polyHistory(sym, httpGet, priority = 'high') {
  const get = httpGet || ((url, opts) => polygonGet(url, opts, priority));
  const to = new Date();
  const from = new Date(Date.now() - 130 * 864e5);
  const fmt = d => d.toISOString().slice(0, 10);
  const { data } = await get(
    `${API_BASE}/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${fmt(from)}/${fmt(to)}`,
    { params: { adjusted: true, sort: 'desc', limit: 60, apiKey: POLYGON_KEY }, timeout: 12000 },
  );
  if (!data.results) throw new Error(data.error || 'no results');
  const bars = data.results.map(b => ({
    date: new Date(b.t).toISOString().slice(0, 10),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
  })).reverse();
  return { bars, provider: 'polygon' };
}

async function polyHistoryTimeframe(sym, timeframe, httpGet, priority = 'high') {
  const get = httpGet || ((url, opts) => polygonGet(url, opts, priority));
  const multiplier = timeframe === '4h' ? 4 : 15;
  const span = timeframe === '4h' ? 'hour' : 'minute';
  const days = timeframe === '4h' ? 45 : 5;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data } = await get(
    `${API_BASE}/v2/aggs/ticker/${encodeURIComponent(sym)}/range/${multiplier}/${span}/${from}/${to}`,
    { params: { adjusted: true, sort: 'desc', limit: 60, apiKey: POLYGON_KEY }, timeout: 12000 },
  );
  if (!data.results) throw new Error('no intraday results');
  return {
    symbol: sym,
    timeframe,
    provider: 'polygon',
    bars: data.results.map(b => ({
      date: new Date(b.t).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    })).reverse(),
  };
}

async function polyName(sym, httpGet = polygonGet) {
  if (nameCache.has(sym)) return nameCache.get(sym);
  try {
    const { data } = await httpGet(
      `${API_BASE}/v3/reference/tickers/${encodeURIComponent(sym)}`,
      { params: { apiKey: POLYGON_KEY }, timeout: 8000 },
    );
    const name = data.results && data.results.name ? data.results.name : sym;
    nameCache.set(sym, name);
    return name;
  } catch (e) {
    return sym;
  }
}

/** Finite number or null (treats null/undefined/'' as absent, unlike Number()). */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** US/Eastern calendar parts for a timestamp (daily bars are ET-dated). */
function etParts(date = new Date()) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date)) p[part.type] = part.value;
  return p;
}

function etYmd(date) {
  const p = etParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Bar date inferred from its timestamp (daily bars are ET-session dated). */
function barDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Selects the most recent COMPLETED US trading sessions from daily bars,
 * newest first. The current ET session is excluded until it has finished
 * (>= 16:00 ET on a weekday), because its aggregate may be partial. Weekends
 * and holidays need no calendar logic: sessions without trades have no bars.
 * `now` is injectable for tests.
 */
function selectCompletedSessions(results, now = new Date()) {
  const p = etParts(now);
  const todayEt = `${p.year}-${p.month}-${p.day}`;
  const sessionClosed = !['Sat', 'Sun'].includes(p.weekday) && Number(p.hour) >= 16;
  return (Array.isArray(results) ? results : [])
    .filter(r => r && Number.isFinite(Number(r.t)))
    .filter(r => barDate(Number(r.t)) !== todayEt || sessionClosed)
    .sort((a, b) => Number(b.t) - Number(a.t));
}

/**
 * Maps the last two completed daily bars into the terminal quote shape.
 *   price          = latest completed close
 *   previousClose  = immediately preceding completed close
 *   change         = latest close - previous close   (conventional daily change)
 *   percentChange  = change / previous close * 100
 * With only one completed bar, price is returned but
 * previousClose/change/percentChange are null — never substituted with
 * open-to-close movement.
 */
function mapDailyBars(sym, results, now = new Date()) {
  const completed = selectCompletedSessions(results, now);
  const latest = completed[0];
  const price = numOrNull(latest && latest.c);
  if (latest === undefined || price === null) throw new Error('no completed daily aggregate');

  const prior = completed[1];
  const previousClose = prior ? numOrNull(prior.c) : null;
  const hasPrior = previousClose !== null && previousClose > 0;
  const change = hasPrior ? +(price - previousClose).toFixed(2) : null;

  return {
    symbol: sym,
    price,
    previousClose,
    change,
    percentChange: hasPrior ? +((price - previousClose) / previousClose * 100).toFixed(2) : null,
    open: numOrNull(latest.o),
    high: numOrNull(latest.h),
    low: numOrNull(latest.l),
    volume: numOrNull(latest.v) ?? 0,
    vwap: numOrNull(latest.vw),
    sessionDate: barDate(Number(latest.t)),
    dataMode: 'eod',
    provider: 'polygon',
  };
}

/** Fetches + caches one EOD quote, deduplicating concurrent requests for the
 *  same symbol so overlapping consumers share a single provider call. */
function fetchDailyQuote(sym, httpGet, now) {
  const inflight = dailyInflight.get(sym);
  if (inflight) return inflight;
  const p = (async () => {
    const to = etYmd(now);
    const from = etYmd(new Date(now.getTime() - 10 * 864e5));
    const { data } = await httpGet(
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${from}/${to}`,
      { params: { adjusted: true, sort: 'desc', limit: 6, apiKey: POLYGON_KEY }, timeout: 10000 },
    );
    const quote = mapDailyBars(sym, data && data.results, now);
    dailyCache.set(sym, { quote, fetchedAt: Date.now() });
    return quote;
  })();
  dailyInflight.set(sym, p);
  p.finally(() => dailyInflight.delete(sym)).catch(() => {});
  return p;
}

/**
 * EOD quotes for a set of symbols: one daily range request per symbol (same
 * request volume as the previous `/prev` fallback), cached, deduplicated and
 * graceful on failure. `onQuote(sym, quote)` fires per freshly fetched symbol
 * so callers can publish the board progressively under paced free-tier
 * budgets. The window spans 10 calendar days so weekends and holidays always
 * leave at least two completed sessions.
 */
async function polyDailyQuotes(syms, httpGet, now = new Date(), onQuote) {
  const out = new Map();
  let lastError = null;
  for (const sym of syms) {
    const cached = dailyCache.get(sym);
    if (cached && Date.now() - cached.fetchedAt < DAILY_TTL_MS) {
      out.set(sym, cached.quote);
      continue;
    }
    try {
      const quote = await fetchDailyQuote(sym, httpGet, now);
      out.set(sym, quote);
      if (onQuote) {
        try { onQuote(sym, quote); } catch (e) { /* publishing must not break the batch */ }
      }
    } catch (e) {
      lastError = e;
      if (cached) out.set(sym, cached.quote);   // keep the last known EOD value instead of dropping the symbol
    }
  }
  if (out.size === 0 && lastError) throw lastError;   // total failure (network/key) must surface
  return out;
}

function noteEntitlementFallback() {
  quoteMode = 'eod';
  // The account is known to be on the free/EOD compatibility path: pace REST
  // immediately instead of discovering the quota through repeated 429s.
  scheduler.enablePacing();
  if (!fallbackLogged) {
    fallbackLogged = true;
    console.warn('[polygon-provider] snapshot quotes not entitled for this plan — using completed daily aggregates (EOD close vs previous close, not realtime); REST requests paced for the free-tier budget');
  }
}

/** Raw snapshot quote mapping (no fallback / no mode handling). */
async function snapshotQuotes(syms, get) {
  const { data } = await get(
    'https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers',
    { params: { tickers: syms.join(','), apiKey: POLYGON_KEY }, timeout: 10000 },
  );
  const out = new Map();
  for (const t of data.tickers || []) {
    const price = (t.lastTrade && t.lastTrade.p) || (t.min && t.min.p) || (t.day && t.day.c) || (t.prevDay && t.prevDay.c) || 0;
    const change = Number.isFinite(t.todaysChange) ? t.todaysChange : +(price - (t.prevDay ? t.prevDay.c : price)).toFixed(2);
    const pct = Number.isFinite(t.todaysChangePerc) ? t.todaysChangePerc : 0;
    out.set(t.ticker, {
      price,
      change,
      percentChange: pct,
      volume: (t.day && t.day.v) || 0,
      dataMode: 'realtime',
      provider: 'polygon',
    });
  }
  return out;
}

/**
 * Batch quotes. Tries the realtime snapshot endpoint first; on an entitlement
 * (403) response it permanently switches this session to completed daily
 * aggregates. Other errors propagate unchanged.
 *
 * The entitlement decision is shared: concurrent callers wait on one probe
 * instead of each hitting the snapshot endpoint. `priority: 'low'` is used by
 * the background poller so interactive requests keep their place in the
 * free-tier rate-limit queue.
 */
async function polyQuotes(syms, { httpGet, priority = 'high', onQuote } = {}) {
  const get = httpGet || ((url, opts) => polygonGet(url, opts, priority));
  if (quoteMode === 'eod') return polyDailyQuotes(syms, get, new Date(), onQuote);   // do not re-probe a known-unentitled endpoint

  if (quoteMode === 'unknown' && !snapshotProbe) {
    snapshotProbe = (async () => {
      try {
        const out = await snapshotQuotes(syms, get);
        quoteMode = 'realtime';
        return { out };
      } catch (e) {
        if (!isEntitlementError(e)) return { error: e };
        noteEntitlementFallback();
        return { entitlement: true };
      }
    })().finally(() => { snapshotProbe = null; });
  }
  if (quoteMode === 'unknown') {
    const decision = await snapshotProbe;
    if (decision.error) throw decision.error;
    if (decision.entitlement) return polyDailyQuotes(syms, get, new Date(), onQuote);
    if (syms.every(s => decision.out.has(s))) return decision.out;
    // realtime session, different symbol set: make the caller's own snapshot call
  }

  try {
    const out = await snapshotQuotes(syms, get);
    quoteMode = 'realtime';
    return out;
  } catch (e) {
    if (!isEntitlementError(e)) throw e;   // invalid key / 5xx / malformed still surface
    noteEntitlementFallback();
    return polyDailyQuotes(syms, get, new Date(), onQuote);
  }
}

module.exports = {
  polyHistory,
  polyHistoryTimeframe,
  polyQuotes,
  polyName,
  mapDailyBars,
  selectCompletedSessions,
  isEntitlementError,
  isRateLimitError,
  createScheduler,
  getQuoteMode,
  getSessionPacing,
  resetQuoteState,
};
