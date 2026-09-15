import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokensMatch,
  extractBearer,
  createAccessGate,
  createTokenGate,
} from '../src/backend/services/trading-guard.js';
import {
  validateOrderBody,
  CLIENT_ORDER_ID_RE,
} from '../src/backend/services/order-validation.js';
import { buildOrderBody } from '../src/backend/services/brokerClient.js';

/* ---------------- helpers ---------------- */

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function run(mw, req) {
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

const TEST_TOKEN = 'stage1-test-token-0123456789';

/* ---------------- token comparison ---------------- */

test('tokensMatch: exact match passes, wrong/empty/non-string fail', () => {
  assert.equal(tokensMatch(TEST_TOKEN, TEST_TOKEN), true);
  assert.equal(tokensMatch('wrong-token-value', TEST_TOKEN), false);
  assert.equal(tokensMatch('', TEST_TOKEN), false);
  assert.equal(tokensMatch(TEST_TOKEN, ''), false);
  assert.equal(tokensMatch(null, TEST_TOKEN), false);
  assert.equal(tokensMatch(undefined, TEST_TOKEN), false);
  assert.equal(tokensMatch(12345, TEST_TOKEN), false);
});

test('extractBearer: parses the scheme case-insensitively, rejects other schemes', () => {
  assert.equal(extractBearer(`Bearer ${TEST_TOKEN}`), TEST_TOKEN);
  assert.equal(extractBearer(`bearer ${TEST_TOKEN}`), TEST_TOKEN);
  assert.equal(extractBearer(`  Bearer   ${TEST_TOKEN}  `), TEST_TOKEN);
  assert.equal(extractBearer(`Basic ${TEST_TOKEN}`), '');
  assert.equal(extractBearer(''), '');
  assert.equal(extractBearer(undefined), '');
});

/* ---------------- access gate (public mode) ---------------- */

test('accessGate: public mode answers 404 without touching next', () => {
  const { res, nextCalled } = run(createAccessGate({ publicMode: true }), { headers: {} });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Not Found' });
  assert.equal(nextCalled, false);
});

test('accessGate: private mode continues', () => {
  const { res, nextCalled } = run(createAccessGate({ publicMode: false }), { headers: {} });
  assert.equal(res.statusCode, null);
  assert.equal(nextCalled, true);
});

/* ---------------- token gate ---------------- */

test('tokenGate: no configured token answers 503 without comparing input', () => {
  const gate = createTokenGate({ expectedToken: '' });
  const { res, nextCalled } = run(gate, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'Trading disabled' });
  assert.equal(nextCalled, false);
});

test('tokenGate: missing, malformed, or wrong token answers 401', () => {
  const gate = createTokenGate({ expectedToken: TEST_TOKEN });
  for (const headers of [
    {},
    { authorization: '' },
    { authorization: 'Basic abcdefgh' },
    { authorization: `Bearer ${TEST_TOKEN}x` },
    { authorization: 'Bearer ' },
  ]) {
    const { res, nextCalled } = run(gate, { headers });
    assert.equal(res.statusCode, 401, `expected 401 for ${JSON.stringify(headers)}`);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
    assert.equal(nextCalled, false);
  }
});

test('tokenGate: correct token continues', () => {
  const gate = createTokenGate({ expectedToken: TEST_TOKEN });
  const { res, nextCalled } = run(gate, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
  assert.equal(res.statusCode, null);
  assert.equal(nextCalled, true);
});

/* ---------------- order validation ---------------- */

test('validateOrderBody: accepts a market order with defaults', () => {
  const v = validateOrderBody({ symbol: 'tsla', side: 'buy', qty: 3 });
  assert.equal(v.ok, true);
  assert.equal(v.order.symbol, 'TSLA');
  assert.equal(v.order.type, 'market');
  assert.equal(v.order.timeInForce, 'day');
  assert.equal('limitPrice' in v.order, false);
});

test('validateOrderBody: accepts a limit order and keeps the price', () => {
  const v = validateOrderBody({ symbol: 'RIVN', side: 'sell', qty: '2.5', type: 'limit', limitPrice: '14.20' });
  assert.equal(v.ok, true);
  assert.equal(v.order.type, 'limit');
  assert.equal(v.order.limitPrice, 14.2);
});

test('validateOrderBody: rejects invalid symbol, side, qty, type, limit price', () => {
  assert.equal(validateOrderBody({ symbol: '../etc', side: 'buy', qty: 1 }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'hold', qty: 1 }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 0 }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: -5 }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 100001 }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 1, type: 'stop' }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 1, type: 'limit' }).ok, false);
  assert.equal(validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 1, type: 'limit', limitPrice: -1 }).ok, false);
});

test('validateOrderBody: clientOrderId is optional but validated when present', () => {
  const validId = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.match(validId, CLIENT_ORDER_ID_RE);
  const withId = validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 1, clientOrderId: validId });
  assert.equal(withId.ok, true);
  assert.equal(withId.order.clientOrderId, validId);

  for (const bad of ['short', 'has space', '$(rm -rf)', 'a'.repeat(49), '<script>alert(1)</script>']) {
    const v = validateOrderBody({ symbol: 'TSLA', side: 'buy', qty: 1, clientOrderId: bad });
    assert.equal(v.ok, false, `expected rejection for clientOrderId ${JSON.stringify(bad)}`);
  }
});

/* ---------------- broker body building ---------------- */

test('buildOrderBody: forwards client_order_id for idempotency', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const body = buildOrderBody({ symbol: 'TSLA', qty: 3, side: 'buy', type: 'market', clientOrderId: id });
  assert.equal(body.client_order_id, id);
  assert.equal(body.qty, '3');
  assert.equal('limit_price' in body, false);
});

test('buildOrderBody: limit orders include the price, no id when absent', () => {
  const body = buildOrderBody({ symbol: 'NIO', qty: 10, side: 'sell', type: 'limit', limitPrice: 5.5 });
  assert.equal(body.limit_price, '5.5');
  assert.equal('client_order_id' in body, false);
  assert.equal(body.time_in_force, 'day');
});
