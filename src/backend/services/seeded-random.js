'use strict';

/**
 * Deterministic seeded RNG shared by the backend simulation modules.
 *
 * `hashSeed` + `mulberry32` are the canonical implementations used by the
 * demo provider, the mock telemetry generator and (as an identical ESM copy
 * in `src/frontend/utils/demo-engine.js`) the browser offline fallback, so
 * sequences stay reproducible across the two environments.
 */

/** Stable 32-bit string hash (FNV-style, as used by the original simulators). */
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — returns a function producing floats in [0, 1). */
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

module.exports = { hashSeed, mulberry32 };
