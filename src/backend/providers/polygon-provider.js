'use strict';

/** Polygon.io REST wrappers (daily aggregates, intraday aggregates, snapshots). */
const axios = require('axios');
const { POLYGON_KEY } = require('../config');

const nameCache = new Map(); // sym → company name

async function polyHistory(sym) {
  const to = new Date();
  const from = new Date(Date.now() - 130 * 864e5);
  const fmt = d => d.toISOString().slice(0, 10);
  const { data } = await axios.get(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${fmt(from)}/${fmt(to)}`,
    { params: { adjusted: true, sort: 'desc', limit: 60, apiKey: POLYGON_KEY }, timeout: 12000 },
  );
  if (!data.results) throw new Error(data.error || 'no results');
  const bars = data.results.map(b => ({
    date: new Date(b.t).toISOString().slice(0, 10),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
  })).reverse();
  return { bars, provider: 'polygon' };
}

async function polyHistoryTimeframe(sym, timeframe) {
  const multiplier = timeframe === '4h' ? 4 : 15;
  const span = timeframe === '4h' ? 'hour' : 'minute';
  const days = timeframe === '4h' ? 45 : 5;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data } = await axios.get(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym)}/range/${multiplier}/${span}/${from}/${to}`,
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

async function polyName(sym) {
  if (nameCache.has(sym)) return nameCache.get(sym);
  try {
    const { data } = await axios.get(
      `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(sym)}`,
      { params: { apiKey: POLYGON_KEY }, timeout: 8000 },
    );
    const name = data.results && data.results.name ? data.results.name : sym;
    nameCache.set(sym, name);
    return name;
  } catch (e) {
    return sym;
  }
}

async function polyQuotes(syms) {
  const { data } = await axios.get(
    'https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers',
    { params: { tickers: syms.join(','), apiKey: POLYGON_KEY }, timeout: 10000 },
  );
  const out = new Map();
  for (const t of data.tickers || []) {
    const price = (t.lastTrade && t.lastTrade.p) || (t.min && t.min.p) || (t.day && t.day.c) || (t.prevDay && t.prevDay.c) || 0;
    const change = Number.isFinite(t.todaysChange) ? t.todaysChange : +(price - (t.prevDay ? t.prevDay.c : price)).toFixed(2);
    const pct = Number.isFinite(t.todaysChangePerc) ? t.todaysChangePerc : 0;
    out.set(t.ticker, { price, change, percentChange: pct, volume: (t.day && t.day.v) || 0 });
  }
  return out;
}

module.exports = { polyHistory, polyHistoryTimeframe, polyQuotes, polyName };
