'use strict';

/**
 * Deterministic simulated market-data provider.
 * Powers the terminal end-to-end when no API keys are configured and acts as
 * the offline fallback for quote/financial lookups.
 */
const { PROVIDER_MODE } = require('../config');

const DEFAULT_UNIVERSE = [
  { sym: 'TSLA', name: 'Tesla Inc', sector: 'PURE', base: 245 },
  { sym: 'RIVN', name: 'Rivian Automotive', sector: 'PURE', base: 14.5 },
  { sym: 'LCID', name: 'Lucid Group', sector: 'PURE', base: 2.4 },
  { sym: 'NIO', name: 'NIO Inc ADR', sector: 'PURE', base: 5.1 },
  { sym: 'XPEV', name: 'XPeng Inc ADR', sector: 'PURE', base: 21 },
  { sym: 'LI', name: 'Li Auto Inc ADR', sector: 'PURE', base: 29 },
  { sym: 'PSNY', name: 'Polestar Automotive', sector: 'PURE', base: 1.2 },
  { sym: 'BYDDY', name: 'BYD Co ADR (1211.HK)', sector: 'PURE', base: 58 },
  { sym: '300750.SZ', name: 'CATL Energy (Contemporary Amperex)', sector: 'BATT', base: 262 },
  { sym: '3931.HK', name: 'CALB Group (China Amperex)', sector: 'BATT', base: 41 },
  { sym: 'PCRFY', name: 'Panasonic Energy ADR', sector: 'BATT', base: 11.2 },
  { sym: '373220.KS', name: 'LG Energy Solution', sector: 'BATT', base: 214 },
  { sym: 'ALB', name: 'Albemarle (lithium)', sector: 'BATT', base: 86 },
];

const DEMO_COMMODITY_BASES = { WTI: 68, NICK: 16500, COPR: 10250, LITH: 12480, COBT: 24300 };

const demoCache = new Map(); // sym → { bars, prevClose, price, volume }

function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lastWeekdays(count) {
  const out = [];
  const d = new Date();
  while (out.length < count) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

function demoSeries(sym) {
  if (demoCache.has(sym)) return demoCache.get(sym);
  const r = mulberry32(hash(sym + '|demo'));
  const seeded = DEFAULT_UNIVERSE.find(u => u.sym === sym);
  let px = seeded && seeded.base ? seeded.base : DEMO_COMMODITY_BASES[sym] || Math.exp(r() * 4.6 + 0.9);
  const dates = lastWeekdays(60);
  const bars = [];
  for (let i = 0; i < 60; i++) {
    px = Math.max(0.2, px * (1 + (r() - 0.48) * 0.02));
    const o = px * (1 + (r() - 0.5) * 0.01);
    const h = Math.max(o, px) * (1 + r() * 0.012);
    const l = Math.min(o, px) * (1 - r() * 0.012);
    const v = Math.round(3e6 + r() * 9e7);
    bars.push({ date: dates[i], o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +px.toFixed(2), v });
  }
  const state = { bars, prevClose: bars[58].c, price: bars[59].c, volume: bars[59].v };
  demoCache.set(sym, state);
  return state;
}

function demoHistory(sym) {
  return { bars: demoSeries(sym).bars, provider: 'demo' };
}

function demoQuote(sym) {
  const s = demoSeries(sym);
  const change = +(s.price - s.prevClose).toFixed(2);
  return {
    symbol: sym,
    name: `${sym} (simulated)`,
    price: s.price,
    change,
    percentChange: +(change / s.prevClose * 100).toFixed(2),
    volume: s.volume,
    sectorHint: '',
    provider: 'demo',
    profile: { note: 'synthetic demo feed — no API keys configured' },
  };
}

function demoTick(sym) {
  const s = demoSeries(sym);
  s.price = Math.max(0.05, s.price * (1 + (Math.random() - 0.485) * 0.004));
  s.volume += Math.round(Math.random() * 250000);
  const change = +(s.price - s.prevClose).toFixed(2);
  return {
    price: +s.price.toFixed(2),
    change,
    percentChange: +(change / s.prevClose * 100).toFixed(2),
    volume: s.volume,
  };
}

/** Simulated 4H/15M intraday bars anchored to the symbol's current sim price. */
function intradayBars(sym, timeframe) {
  const price = demoSeries(sym).price;
  const r = mulberry32(hash(sym + '|' + timeframe));
  const cfg = timeframe === '4h'
    ? { count: 60, stepMin: 240, vol: 0.01, starts: [570, 810] }
    : { count: 60, stepMin: 15, vol: 0.0035, starts: Array.from({ length: 26 }, (_, i) => 570 + i * 15) };
  const times = [];
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  while (times.length < cfg.count) {
    const dow = day.getDay();
    if (dow !== 0 && dow !== 6) {
      for (const minute of cfg.starts) {
        const d = new Date(day.getTime() + minute * 60000);
        if (d.getTime() <= Date.now()) times.push(d.getTime());
      }
    }
    day.setDate(day.getDate() - 1);
  }
  times.sort((a, b) => a - b);
  const stamps = times.slice(-cfg.count);
  const closes = new Array(stamps.length);
  closes[stamps.length - 1] = price;
  for (let i = stamps.length - 2; i >= 0; i--) {
    closes[i] = closes[i + 1] / (1 + (r() - 0.485) * 2 * cfg.vol);
  }
  const bars = stamps.map((t, i) => {
    const c = closes[i];
    const o = i > 0 ? closes[i - 1] : c * (1 - (r() - 0.5) * cfg.vol);
    const h = Math.max(o, c) * (1 + r() * cfg.vol * 0.6);
    const l = Math.min(o, c) * (1 - r() * cfg.vol * 0.6);
    const v = Math.round((timeframe === '4h' ? 2e5 : 5e4) + r() * (timeframe === '4h' ? 8e6 : 2e6));
    return { date: new Date(t).toISOString(), o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v };
  });
  return { symbol: sym, timeframe, provider: PROVIDER_MODE === 'demo' ? 'demo' : PROVIDER_MODE + '-sim', bars };
}

function simDeliveries(sym, sector) {
  const r = mulberry32(hash(sym + '|dlv'));
  const unit = sector === 'PURE' ? 'vehicles' : 'GWh';
  const quarterly = sector === 'PURE' ? 4e4 + r() * 4.6e5 : 8 + r() * 110;
  const yoY = (r() - 0.25) * 0.9 * 100;
  return { unit, quarterly, annual: quarterly * 4, yoY };
}

function demoFinancials(sym) {
  const r = mulberry32(hash(sym + '|fin'));
  const price = demoSeries(sym).price;
  const shares = 0.3e9 + r() * 3.5e9;
  const marketCap = price * shares;
  const revenueTTM = marketCap / (2 + r() * 9);
  const grossMargin = 0.09 + r() * 0.28;
  const netMargin = -0.08 + r() * 0.3;
  const netIncomeTTM = revenueTTM * netMargin;
  const rdSpendTTM = revenueTTM * (0.02 + r() * 0.07);
  const cashSTI = revenueTTM * (0.25 + r() * 0.7);
  const debt = revenueTTM * (0.1 + r() * 0.9);
  const ev = marketCap + debt - cashSTI;
  const sector = (DEFAULT_UNIVERSE.find(u => u.sym === sym) || {}).sector || 'PURE';
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => ({
    label: q,
    revenue: revenueTTM / 4 * (0.85 + r() * 0.3),
    netIncome: netIncomeTTM / 4 * (0.7 + r() * 0.6),
    rd: rdSpendTTM / 4 * (0.9 + r() * 0.2),
  }));
  return {
    symbol: sym,
    provider: 'demo',
    asOf: new Date().toISOString().slice(0, 10),
    marketCap,
    peTTM: netIncomeTTM > 0 ? marketCap / netIncomeTTM : null,
    evSales: revenueTTM > 0 ? ev / revenueTTM : null,
    fcfTTM: netIncomeTTM * (0.6 + r() * 1.2),
    grossMargin,
    netMargin,
    revenueTTM,
    netIncomeTTM,
    rdSpendTTM,
    cashSTI,
    deliveryUnit: sector === 'PURE' ? 'vehicles' : 'GWh',
    deliveriesSim: simDeliveries(sym, sector),
    deliveriesNote: 'deliveries/shipments are modeled estimates, not reported figures',
    history: quarters,
  };
}

module.exports = {
  DEFAULT_UNIVERSE,
  demoHistory,
  demoQuote,
  demoTick,
  demoFinancials,
  intradayBars,
  simDeliveries,
  demoSeries,
};
