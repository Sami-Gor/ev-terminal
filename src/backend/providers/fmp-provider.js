'use strict';

/** FinancialModelingPrep REST wrappers (quotes, history, key metrics). */
const axios = require('axios');
const { FMP_KEY } = require('../config');

const API_BASE = 'https://financialmodelingprep.com/api/v3';

async function fmpHistory(sym) {
  const { data } = await axios.get(
    `${API_BASE}/historical-price-full/${encodeURIComponent(sym)}`,
    { params: { apikey: FMP_KEY }, timeout: 12000 },
  );
  const hist = data.historical || [];
  if (!hist.length) throw new Error('no history');
  const bars = hist.slice(0, 60).map(b => ({
    date: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume,
  })).reverse();
  return { bars, provider: 'fmp' };
}

async function fmpQuotes(syms) {
  const { data } = await axios.get(
    `${API_BASE}/quote/${syms.map(encodeURIComponent).join(',')}`,
    { params: { apikey: FMP_KEY }, timeout: 10000 },
  );
  const arr = Array.isArray(data) ? data : [];
  const out = new Map();
  for (const q of arr) {
    out.set(q.symbol, {
      price: q.price,
      change: q.change,
      percentChange: q.changesPercentage,
      volume: q.volume,
      name: q.name,
      sectorHint: q.sector || '',
    });
  }
  return out;
}

/** Map free-text FMP sectors onto the terminal's two-sector model. */
function sectorHintFromFmp(sector) {
  const s = (sector || '').toLowerCase();
  return /batter|material|lithium|metal|mining|chemical|cell/.test(s) ? 'BATT' : 'PURE';
}

module.exports = { fmpHistory, fmpQuotes, sectorHintFromFmp };
