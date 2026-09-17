'use strict';

/**
 * FMP/Massive market-data provider (`/stable`): quotes and daily EOD bars.
 *
 * Account constraints (audited):
 *   - `/stable/quote` is entitled per symbol; `/stable/batch-quote` is not,
 *     so quotes are fetched one symbol at a time and cached for
 *     FMP_QUOTE_TTL_MS (free-tier quotes are end-of-day, not realtime).
 *   - `/stable/historical-price-eod/full` is entitled and supports from/to
 *     windows (its `limit` parameter is ignored), so history uses one request
 *     per symbol over a bounded window and is sliced to 60 bars.
 *
 * Missing values are returned as null; raw provider payloads are never
 * returned to callers.
 */
const axios = require('axios');
const { FMP_KEY, FMP_QUOTE_TTL_MS, FMP_HISTORY_TTL_MS, FMP_RESTRICTION_TTL_MS } = require('../config');
const { num } = require('./provider-utils');

const FMP_BASE = 'https://financialmodelingprep.com/stable';
/** Quotes are considered fresh (realtime-ish) only within this window. */
const FRESH_QUOTE_MS = 20 * 60 * 1000;

const quoteCache = new Map();   // sym → { quote, fetchedAt }
const historyCache = new Map(); // sym → { bars, fetchedAt }
/** Plan restrictions learned per capability (endpoint + symbol), symbol → expiry.
 *  Quote and history entitlements are independent — a restriction on one must
 *  never suppress the other. */
const quoteRestricted = new Map();
const historyRestricted = new Map();
let lastQuoteTs = null;         // newest provider timestamp seen (seconds)

/** 402 always means a plan restriction; 403 only when the provider body clearly
 *  says so. Everything else (401/429/5xx/network) is a non-restriction error. */
const RESTRICTION_RE = /subscription|entitlement|access level|\bplan\b|upgrade/i;

function isEntitlementRestriction(e) {
  const res = e && e.response;
  if (!res) return false;
  if (res.status === 402) return true;
  if (res.status !== 403) return false;
  let body = '';
  try { body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || ''); } catch { body = ''; }
  return RESTRICTION_RE.test(body);
}

function rememberRestriction(map, sym) {
  map.set(sym, Date.now() + FMP_RESTRICTION_TTL_MS);
}

function isRestricted(map, sym) {
  const until = map.get(sym);
  if (!until) return false;
  if (Date.now() >= until) { map.delete(sym); return false; }   // expiry → one fresh attempt
  return true;
}

/** Stable controlled error for a cached restriction (keeps the existing 502
 *  route behaviour; contains no provider body or key). */
function restrictedError(sym, capability) {
  const e = new Error(`${capability} restricted for ${sym} under the current FMP plan`);
  e.response = { status: 402, data: { error: 'PLAN_RESTRICTED' } };
  return e;
}

/** 'eod' unless the newest provider timestamp is genuinely recent. */
function getQuoteMode() {
  return lastQuoteTs && Date.now() / 1000 - lastQuoteTs < FRESH_QUOTE_MS / 1000
    ? 'realtime'
    : 'eod';
}

/** Resets quote/history caches + restriction state (tests / config reloads). */
function resetMarketState() {
  quoteCache.clear();
  historyCache.clear();
  quoteRestricted.clear();
  historyRestricted.clear();
  lastQuoteTs = null;
}

function mapQuote(sym, q) {
  const price = num(q && q.price);
  if (price === null) return null;
  return {
    symbol: sym,
    name: typeof q.name === 'string' && q.name ? q.name : sym,
    price,
    previousClose: num(q.previousClose),
    change: num(q.change),
    percentChange: num(q.changePercentage),
    open: num(q.open),
    high: num(q.dayHigh),
    low: num(q.dayLow),
    volume: num(q.volume),
    timestamp: num(q.timestamp),
    exchange: typeof q.exchange === 'string' ? q.exchange : null,
    sectorHint: '',
    provider: 'fmp',
  };
}

async function fetchQuote(sym, httpGet) {
  const { data } = await httpGet(
    `${FMP_BASE}/quote`,
    { params: { symbol: sym, apikey: FMP_KEY }, timeout: 10000 },
  );
  const row = Array.isArray(data) ? data[0] : data;
  const quote = mapQuote(sym, row);
  if (!quote) throw new Error('no quote');
  const ts = num(row.timestamp);
  if (ts !== null && (lastQuoteTs === null || ts > lastQuoteTs)) lastQuoteTs = ts;
  return quote;
}

/**
 * Batch quotes with per-symbol cache + stale-serving. Total failure (no cache,
 * every symbol failed or plan-restricted) surfaces so the caller can keep its
 * previous snapshot. Known plan restrictions are not retried inside the
 * restriction TTL — no provider call is made for them.
 */
async function fmpQuotes(syms, { httpGet = (url, opts) => axios.get(url, opts), maxAgeMs = FMP_QUOTE_TTL_MS } = {}) {
  const out = new Map();
  let lastError = null;
  let lastRestricted = null;
  const now = Date.now();
  for (const sym of syms) {
    const cached = quoteCache.get(sym);
    if (cached && now - cached.fetchedAt < maxAgeMs) {
      out.set(sym, cached.quote);
      continue;
    }
    if (isRestricted(quoteRestricted, sym)) {
      lastRestricted = restrictedError(sym, 'quote');
      if (cached) out.set(sym, cached.quote);   // stale-serving for a restricted refresh
      continue;                                  // 0 provider calls for a known restriction
    }
    try {
      const quote = await fetchQuote(sym, httpGet);
      quoteCache.set(sym, { quote, fetchedAt: Date.now() });
      quoteRestricted.delete(sym);               // success clears any learned restriction
      out.set(sym, quote);
    } catch (e) {
      lastError = e;
      if (isEntitlementRestriction(e)) rememberRestriction(quoteRestricted, sym);
      if (cached) out.set(sym, cached.quote);   // keep the last known quote instead of dropping the symbol
    }
  }
  if (out.size === 0 && (lastError || lastRestricted)) throw lastError || lastRestricted;
  return out;
}

/** Daily EOD bars (ascending, max 60) from a bounded date window, cached for
 *  FMP_HISTORY_TTL_MS with stale-serving on provider failure. History plan
 *  restrictions are remembered independently of quote restrictions. */
async function fmpHistory(sym, { httpGet = (url, opts) => axios.get(url, opts), days = 130, maxAgeMs = FMP_HISTORY_TTL_MS } = {}) {
  const cached = historyCache.get(sym);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
    return { bars: cached.bars, provider: 'fmp' };
  }
  if (isRestricted(historyRestricted, sym)) {
    if (cached) return { bars: cached.bars, provider: 'fmp' };
    throw restrictedError(sym, 'history');       // 0 provider calls for a known restriction
  }
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const { data } = await httpGet(
      `${FMP_BASE}/historical-price-eod/full`,
      { params: { symbol: sym, from, to, apikey: FMP_KEY }, timeout: 12000 },
    );
    const rows = Array.isArray(data) ? data : [];
    const bars = rows
      .map(b => ({
        date: typeof b.date === 'string' ? b.date : null,
        o: num(b.open),
        h: num(b.high),
        l: num(b.low),
        c: num(b.close),
        v: num(b.volume) ?? 0,
      }))
      .filter(b => b.date && b.o !== null && b.h !== null && b.l !== null && b.c !== null)
      .sort((a, b) => a.date.localeCompare(b.date))   // provider returns newest-first
      .slice(-60);
    if (!bars.length) throw new Error('no history');
    historyCache.set(sym, { bars, fetchedAt: Date.now() });
    historyRestricted.delete(sym);               // success clears any learned restriction
    return { bars, provider: 'fmp' };
  } catch (e) {
    if (isEntitlementRestriction(e)) rememberRestriction(historyRestricted, sym);
    if (cached) return { bars: cached.bars, provider: 'fmp' };   // serve the last known EOD bars
    throw e;
  }
}

/** Map free-text FMP sectors onto the terminal's two-sector model. */
function sectorHintFromFmp(sector) {
  const s = (sector || '').toLowerCase();
  return /batter|material|lithium|metal|mining|chemical|cell/.test(s) ? 'BATT' : 'PURE';
}

module.exports = { fmpHistory, fmpQuotes, sectorHintFromFmp, getQuoteMode, resetMarketState };
