'use strict';

/** Shared provider helpers. */

/** Finite number or null (numeric strings accepted; null/undefined/'' absent). */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { num };
