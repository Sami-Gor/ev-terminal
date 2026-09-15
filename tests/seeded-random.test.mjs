import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashSeed, mulberry32 } from '../src/backend/services/seeded-random.js';
import * as demo from '../src/backend/providers/demo-provider.js';

/* Golden values captured from the pre-Stage-4 implementations. These prove the
 * RNG consolidation introduced identical sequences (the backend generators are
 * deterministic and independent of wall-clock dates). */

test('hashSeed: deterministic per input, distinct across inputs', () => {
  assert.equal(hashSeed('TSLA|demo'), hashSeed('TSLA|demo'));
  assert.equal(hashSeed('TSLA|demo'), 1438353724);
  assert.equal(hashSeed('RIVN|demo'), 653387313);
  assert.notEqual(hashSeed('TSLA|demo'), hashSeed('RIVN|demo'));
  assert.ok(Number.isInteger(hashSeed('anything')) && hashSeed('anything') >= 0);
});

test('mulberry32: reproducible sequence for a fixed seed', () => {
  const expected = [
    0.9797282677609473,
    0.3067522644996643,
    0.484205421525985,
    0.817934412509203,
    0.5094283693470061,
  ];
  const r = mulberry32(12345);
  expected.forEach(value => assert.equal(r(), value));
  assert.equal(mulberry32(12345)(), expected[0]);   // fresh generator, same seed
});

test('demo provider output is unchanged after RNG consolidation (TSLA)', () => {
  const bars = demo.demoHistory('TSLA').bars;
  assert.equal(bars[0].c, 243.74);
  assert.equal(bars[30].c, 255.7);
  assert.equal(bars[59].c, 253.4);

  const q = demo.demoQuote('TSLA');
  assert.equal(q.price, 253.4);
  assert.equal(q.change, 0.55);
  assert.equal(q.percentChange, 0.22);
  assert.equal(q.volume, 20336810);
});

test('demo fundamentals and modeled deliveries are unchanged', () => {
  const f = demo.demoFinancials('TSLA');
  assert.equal(f.marketCap, 847332066600.3785);
  assert.equal(f.revenueTTM, 202193629590.8458);
  assert.equal(f.grossMargin, 0.14147305727005005);
  assert.equal(f.netMargin, 0.007689594272524108);

  const d = demo.simDeliveries('RIVN', 'PURE');
  assert.equal(d.quarterly, 75472.41171821952);
  assert.equal(d.annual, 301889.6468728781);
  assert.equal(d.yoY, 24.226470342837274);
});

test('demo intraday bars are unchanged', () => {
  const bars = demo.intradayBars('NIO', '4h').bars;
  assert.equal(bars.length, 60);
  assert.equal(bars[0].c, 4.97);
  assert.equal(bars[59].c, 5.01);
});
