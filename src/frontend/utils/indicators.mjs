/**
 * indicators.js — pure chart/technical calculations (no DOM access).
 */

/** Average True Range over the last 14 bars. */
export function atr14(bars) {
  const n = bars.length;
  if (n < 2) return null;
  let sum = 0, count = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    sum += Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    );
    count++;
  }
  return count ? sum / count : null;
}

/**
 * ZigZag swing detection: fractal highs/lows (k bars each side), forced H/L
 * alternation, then HH / LH / HL / LL classification vs the prior same-type swing.
 */
export function structurePivots(bars, strength = 2) {
  const raw = [];
  for (let i = strength; i < bars.length - strength; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= strength; j++) {
      if (bars[i].h < bars[i - j].h || bars[i].h < bars[i + j].h) isHigh = false;
      if (bars[i].l > bars[i - j].l || bars[i].l > bars[i + j].l) isLow = false;
    }
    if (isHigh) raw.push({ i, p: bars[i].h, t: 'H' });
    else if (isLow) raw.push({ i, p: bars[i].l, t: 'L' });
  }
  const pivots = [];
  for (const swing of raw) {
    const last = pivots[pivots.length - 1];
    if (last && last.t === swing.t) {
      if ((swing.t === 'H' && swing.p >= last.p) || (swing.t === 'L' && swing.p <= last.p)) {
        pivots[pivots.length - 1] = swing;
      }
    } else pivots.push(swing);
  }
  let prevHigh = null, prevLow = null;
  for (const p of pivots) {
    if (p.t === 'H') { p.tag = prevHigh == null ? 'H' : (p.p > prevHigh ? 'HH' : 'LH'); prevHigh = p.p; }
    else { p.tag = prevLow == null ? 'L' : (p.p > prevLow ? 'HL' : 'LL'); prevLow = p.p; }
  }
  return pivots;
}

/** Fresh supply/demand zones: base candle before a sharp expansion, unmitigated since. */
export function detectZones(bars) {
  const zones = [];
  const avgRange = bars.reduce((s, b) => s + (b.h - b.l), 0) / bars.length;
  for (let i = 2; i < bars.length; i++) {
    const bar = bars[i];
    if (Math.abs(bar.c - bar.o) < avgRange * 2) continue;
    const demand = bar.c > bar.o;
    const baseIdx = i - 1;
    // Order block = the base candle's range alone. Extending it with the
    // expansion candle made fresh zones practically impossible to persist.
    const lo = bars[baseIdx].l;
    const hi = bars[baseIdx].h;
    let fresh = true;
    for (let j = i + 1; j < bars.length; j++) {
      if (bars[j].l <= hi && bars[j].h >= lo) { fresh = false; break; }
    }
    if (!fresh) continue;
    zones.push({ i: baseIdx, lo, hi, demand });
  }
  return [
    ...zones.filter(z => z.demand).slice(-2),
    ...zones.filter(z => !z.demand).slice(-2),
  ];
}

/** Pearson correlation coefficient, or null when undefined. */
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const u = x[i] - mx, v = y[i] - my;
    num += u * v; dx += u * u; dy += v * v;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

/** Daily returns over the last n sessions. */
export function returnsN(closes, n) {
  const c = closes.slice(-(n + 1));
  const r = [];
  for (let i = 1; i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
  return r;
}

/** Squarified treemap layout (used by the heatmap). */
export function tmLayout(items, x, y, w, h, out) {
  if (!items.length) return;
  if (items.length === 1) { out.push(Object.assign({ x, y, w, h }, items[0])); return; }
  const total = items.reduce((s, d) => s + d.v, 0);
  let acc = 0, i = 0;
  while (i < items.length - 1 && acc < total / 2) { acc += items[i].v; i++; }
  if (i === 0) { acc = items[0].v; i = 1; }
  if (w >= h) {
    const a = w * acc / total;
    tmLayout(items.slice(0, i), x, y, a, h, out);
    tmLayout(items.slice(i), x + a, y, w - a, h, out);
  } else {
    const a = h * acc / total;
    tmLayout(items.slice(0, i), x, y, w, a, out);
    tmLayout(items.slice(i), x, y + a, w, h - a, out);
  }
}

/** Deterministic modeled intraday shape between open and the live Δ% endpoint. */
export function intradayPath(pct, seed, rngFor) {
  const r = rngFor(seed);
  const pts = [];
  for (let i = 1; i <= 24; i++) {
    const target = pct * i / 24;
    const cur = i === 24 ? pct : target + (r() - 0.5) * Math.max(Math.abs(pct) * 0.35, 0.12);
    pts.push(cur);
  }
  return pts;
}
