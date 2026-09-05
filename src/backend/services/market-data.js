'use strict';

/**
 * Market-data service: provider selection, caching and request orchestration
 * for history (all timeframes), quotes and fundamentals.
 */
const { PROVIDER_MODE, HISTORY_TTL_MS, FINANCIALS_TTL_MS } = require('../config');
const { TtlCache } = require('./ttl-cache');
const demoProvider = require('../providers/demo-provider');
const polygonProvider = require('../providers/polygon-provider');
const fmpProvider = require('../providers/fmp-provider');
const { fmpFinancials } = require('../providers/financials-provider');

const historyCache = new TtlCache(HISTORY_TTL_MS);
const financialsCache = new TtlCache(FINANCIALS_TTL_MS);
const TIMEFRAMES = ['d', '4h', '15m'];

function defaultUniverse() {
  return demoProvider.DEFAULT_UNIVERSE;
}

/** Daily / intraday bars for any tracked or commodity symbol. */
async function getHistory(sym, timeframe = 'd') {
  const cacheKey = sym + '|' + timeframe;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  let payload;
  if (timeframe !== 'd') {
    payload = PROVIDER_MODE === 'polygon'
      ? await polygonProvider.polyHistoryTimeframe(sym, timeframe)
      : demoProvider.intradayBars(sym, timeframe);
  } else if (PROVIDER_MODE === 'polygon') {
    payload = await polygonProvider.polyHistory(sym);
  } else if (PROVIDER_MODE === 'fmp') {
    payload = await fmpProvider.fmpHistory(sym);
  } else {
    payload = demoProvider.demoHistory(sym);
  }

  const body = { symbol: sym, timeframe, ...payload };
  historyCache.set(cacheKey, body);
  return body;
}

/** Current quote + profile for any symbol (validates against the provider). */
async function getQuote(sym) {
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
  const quotes = await polygonProvider.polyQuotes([sym]);
  if (!quotes.has(sym)) return null;
  const q = quotes.get(sym);
  const name = await polygonProvider.polyName(sym);
  return { symbol: sym, profile: { source: 'polygon' }, ...q, name, provider: 'polygon', sectorHint: '' };
}

/** Fundamentals: FMP when keyed (sim fallback), deterministic sim otherwise. */
async function getFinancials(sym) {
  const cached = financialsCache.get(sym);
  if (cached) return cached;
  let payload;
  if (PROVIDER_MODE === 'fmp') {
    try {
      payload = await fmpFinancials(sym, defaultUniverse());
    } catch (e) {
      payload = demoProvider.demoFinancials(sym);
      payload.note = 'FMP fetch failed — showing simulated fundamentals';
    }
  } else {
    payload = demoProvider.demoFinancials(sym);
  }
  financialsCache.set(sym, payload);
  return payload;
}

/** Batch quotes for the WebSocket poller. */
async function getQuotes(syms) {
  if (PROVIDER_MODE === 'demo') {
    const out = new Map();
    for (const sym of syms) out.set(sym, demoProvider.demoTick(sym));
    return out;
  }
  if (PROVIDER_MODE === 'fmp') return fmpProvider.fmpQuotes(syms);
  return polygonProvider.polyQuotes(syms);
}

module.exports = {
  PROVIDER_MODE,
  TIMEFRAMES,
  defaultUniverse,
  getHistory,
  getQuote,
  getFinancials,
  getQuotes,
};
