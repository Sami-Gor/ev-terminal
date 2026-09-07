import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  atr14,
  structurePivots,
  detectZones,
  pearson,
  returnsN,
} from '../src/frontend/utils/indicators.mjs';

/** Bar factory: OHLC from explicit arrays. */
const bars = (highs, lows, closes) =>
  highs.map((h, i) => ({ o: closes[i - 1] ?? closes[i], h, l: lows[i], c: closes[i] }));

/** Builds OHLC bars that step toward each target price (ramps, no gaps). */
function makeWave(targets) {
  const highs = [], lows = [], closes = [];
  let price = targets[0];
  for (const target of targets) {
    const step = (target - price) / 3;      // ramp in 3 bars so extremes have
    for (let j = 0; j < 3; j++) {           // fractal width for k=2 pivots
      price += step;
      closes.push(price);
      highs.push(price + 0.5);
      lows.push(price - 0.5);
    }
  }
  return bars(highs, lows, closes);
}

/* ---------------- ATR-14 ---------------- */

test('atr14: true range with no gaps is high−low, averaged over available bars', () => {
  const b = bars([20, 22], [10, 12], [15, 20]);
  // TR(1) = max(22−12, |22−15|, |12−15|) = 10
  assert.equal(atr14(b), 10);
});

test('atr14: gaps are included via previous close', () => {
  // bar1 closes 100; bar2 h=112, l=104, c=110 → TR = max(8, 12, 4) = 12
  const b = bars([90, 112], [80, 104], [100, 110]);
  assert.equal(atr14(b), 12);
});

test('atr14: uses at most the last 14 bars', () => {
  const highs = [], lows = [], closes = [];
  for (let i = 0; i < 20; i++) {
    highs.push(100 + i);        // steady 1-unit climb, no gaps → every TR = 1
    lows.push(99 + i);
    closes.push(100 + i);
  }
  assert.equal(atr14(bars(highs, lows, closes)), 1);
});

test('atr14: returns null for insufficient data', () => {
  assert.equal(atr14([]), null);
  assert.equal(atr14([{ o: 1, h: 2, l: 1, c: 2 }]), null);
});

/* ---------------- ZigZag structure labeling ---------------- */

test('structurePivots: uptrend swings label HH/HL, downtrend LH/LL', () => {
  // 10 → high 30 (H) → low 20 (HL) → high 50 (HH) → low 25 (HL) →
  // high 40 (LH) → low 15 (LL)
  const b = makeWave([10, 30, 20, 50, 25, 40, 15, 18]);
  const piv = structurePivots(b, 2);
  const tags = piv.map(p => p.tag);
  for (const tag of ['H', 'L', 'HH', 'HL', 'LH', 'LL']) {
    assert.ok(tags.includes(tag), `expected ${tag} in [${tags}]`);
  }
  for (let i = 1; i < piv.length; i++) {
    assert.notEqual(piv[i].t, piv[i - 1].t, 'pivots must alternate high/low');
  }
});

test('structurePivots: a lower top after an HH is labeled LH', () => {
  // high 30.5 (H) → high 50.5 (HH) → high 40.5 below it (LH)
  const b = makeWave([10, 30, 20, 50, 25, 40, 15, 18]);
  const piv = structurePivots(b, 2);
  const firstHH = piv.findIndex(p => p.tag === 'HH');
  assert.ok(firstHH !== -1, 'expected an HH pivot');
  const nextHigh = piv.findIndex((p, i) => i > firstHH && p.t === 'H');
  assert.ok(nextHigh !== -1, 'expected a later high pivot');
  assert.equal(piv[nextHigh].tag, 'LH');
});

test('structurePivots: a higher bottom after an LL is labeled HL', () => {
  // valley 10 (L) → valley 5 below it (LL) → valley 22 above it (HL)
  const b = makeWave([20, 10, 50, 8, 45, 22, 50]);
  const tags = structurePivots(b, 2).map(p => p.tag);
  const ll = tags.indexOf('LL');
  assert.ok(ll !== -1, `expected an LL in [${tags}]`);
  assert.ok(tags.slice(ll + 1).includes('HL'), `expected an HL after the LL in [${tags}]`);
});

/* ---------------- Pearson correlation ---------------- */

test('pearson: perfectly correlated series → +1, inverse → −1', () => {
  assert.equal(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
  assert.equal(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
});

test('pearson: uncorrelated-ish series stays within (−1, 1)', () => {
  const r = pearson([1, 2, 3, 4, 5, 6], [3, 1, 4, 1, 5, 9]);
  assert.ok(r > -1 && r < 1 && Number.isFinite(r));
});

test('pearson: constant series → null (zero variance)', () => {
  assert.equal(pearson([2, 2, 2, 2, 2], [1, 2, 3, 4, 5]), null);
});

test('pearson: fewer than 5 points → null', () => {
  assert.equal(pearson([1, 2, 3], [1, 2, 3]), null);
});

test('returnsN: n daily returns from n+1 closes', () => {
  const r = returnsN([100, 110, 121], 2);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0] - 0.1) < 1e-12 && Math.abs(r[1] - 0.1) < 1e-12);
});

/* ---------------- Supply/demand zone detection ---------------- */

test('detectZones: flags a fresh demand zone after a sharp expansion', () => {
  const b = [];
  for (let i = 0; i < 10; i++) b.push({ o: 100, h: 100.5, l: 99.5, c: 100, v: 1 }); // tight base
  b.push({ o: 100, h: 106, l: 100, c: 105.5, v: 1 });  // +5.5% expansion off the base
  for (let i = 0; i < 5; i++) b.push({ o: 105.5, h: 106, l: 105, c: 105.5, v: 1 }); // drifts away
  const zones = detectZones(b);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].demand, true);
  assert.equal(zones[0].lo, 99.5);       // order block = base candle range
  assert.equal(zones[0].hi, 100.5);
});

test('detectZones: drops mitigated zones (price traded back through)', () => {
  const b = [];
  for (let i = 0; i < 10; i++) b.push({ o: 100, h: 100.5, l: 99.5, c: 100, v: 1 });
  b.push({ o: 100, h: 106, l: 100, c: 105.5, v: 1 });           // demand zone forms
  b.push({ o: 105.5, h: 106, l: 99.9, c: 100.2, v: 1 });        // retests the zone → mitigated
  const zones = detectZones(b);
  // the mitigated demand zone is dropped; the retest's sharp drop creates a
  // fresh supply zone instead
  assert.equal(zones.length, 1);
  assert.equal(zones[0].demand, false);
});

test('detectZones: a sharp decline creates a supply zone', () => {
  const b = [];
  for (let i = 0; i < 10; i++) b.push({ o: 100, h: 100.5, l: 99.5, c: 100, v: 1 });
  b.push({ o: 100, h: 100, l: 94, c: 94.5, v: 1 });             // sharp drop
  for (let i = 0; i < 5; i++) b.push({ o: 94.5, h: 95, l: 94, c: 94.5, v: 1 });
  const zones = detectZones(b);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].demand, false);
});
