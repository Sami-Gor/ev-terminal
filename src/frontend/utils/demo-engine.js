/**
 * demo-engine.js — deterministic seeded data used as the offline fallback
 * when the backend is unreachable. All fixtures are stable per symbol.
 */

export function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return h >>> 0;
}

export function rngFor(s) {
  return mulberry32(hash(s));
}

const SESSION_COUNT = 60;

/** Last 60 weekday dates ending 2026-09-04 (fixture window). */
export const DATES = (() => {
  const ds = [];
  let d = new Date(Date.UTC(2026, 8, 4));
  while (ds.length < SESSION_COUNT) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) ds.push(new Date(d));
    d = new Date(d.getTime() - 86400000);
  }
  return ds.reverse();
})();

/** Offline fallback candle history anchored to the tracker's last/pct. */
export function genHist(t) {
  const r = rngFor(t.sym + '|h');
  const closes = new Array(SESSION_COUNT);
  closes[SESSION_COUNT - 1] = t.last;
  const prev = t.last / (1 + t.pct / 100);
  closes[SESSION_COUNT - 2] = prev;
  const sigma = 1.4 + (hash(t.sym) % 160) / 100;
  for (let i = SESSION_COUNT - 3; i >= 0; i--) {
    const ret = (r() - 0.485) * 2 * sigma * 0.55;
    closes[i] = closes[i + 1] / (1 + ret / 100);
  }
  const out = [];
  for (let i = 0; i < SESSION_COUNT; i++) {
    const c = closes[i];
    const o = (i < SESSION_COUNT - 1 ? closes[i + 1] : prev) * (1 + (r() - 0.5) * 0.008);
    const span = Math.abs(c - o) + c * (0.002 + r() * 0.009);
    const h = Math.max(o, c) + span * r();
    const l = Math.min(o, c) - span * r();
    const v = t.vol * (0.45 + r() * 1.3) * (i === SESSION_COUNT - 1 ? 1.12 : 1);
    out.push({ o, h, l, c, v });
  }
  return out;
}
