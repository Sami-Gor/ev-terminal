import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SYMBOL_RE, okSymbol } from '../src/backend/services/symbol-utils.js';
import { validateOrderBody } from '../src/backend/services/order-validation.js';

/* The backend rule allows mixed case (routes uppercase before use) and the
 * tracked exchange suffixes; the frontend validator is deliberately stricter
 * (uppercase-only after sanitizeSymbol) — see src/frontend/utils/sanitize.js. */

const VALID = ['TSLA', 'NIO', 'A1', 'BRK.B', '^GSPC', '300750.SZ', '3931.HK', '373220.KS', 'tsla'];
const INVALID = ['', 'A'.repeat(11), 'TS LA', 'a b', '../etc', 'TSLA/..', 'TSLA$', 'ünicode', null, undefined, 42];

test('okSymbol accepts every tracked symbol format', () => {
  for (const sym of VALID) assert.equal(okSymbol(sym), true, `expected valid: ${JSON.stringify(sym)}`);
});

test('okSymbol rejects malformed, oversized and path-like input', () => {
  for (const sym of INVALID) assert.equal(okSymbol(sym), false, `expected invalid: ${JSON.stringify(sym)}`);
});

test('SYMBOL_RE is the single backend rule used by okSymbol', () => {
  for (const sym of [...VALID, ...INVALID]) {
    assert.equal(okSymbol(String(sym)), SYMBOL_RE.test(String(sym)));
  }
});

test('order validation relies on the same symbol rule', () => {
  assert.equal(validateOrderBody({ symbol: '300750.SZ', side: 'buy', qty: 1 }).ok, true);
  assert.equal(validateOrderBody({ symbol: '../etc', side: 'buy', qty: 1 }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TOOLONGSYM1', side: 'buy', qty: 1 }).ok, false);
});
