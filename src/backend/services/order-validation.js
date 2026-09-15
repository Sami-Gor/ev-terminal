'use strict';

/**
 * Order payload validation shared by POST /api/trade/orders and unit tests.
 * Returns a normalized order object or a generic validation message; input
 * values are never echoed back to the caller.
 */
const { okSymbol } = require('./symbol-utils');

/** Alpaca client_order_id: client-generated, idempotency-friendly identifier. */
const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9._-]{8,48}$/;

function validateOrderBody(body) {
  const b = body || {};

  const symbol = String(b.symbol || '').toUpperCase();
  if (!okSymbol(symbol)) return { ok: false, error: 'Invalid symbol' };

  if (b.side !== 'buy' && b.side !== 'sell') return { ok: false, error: 'Side must be buy or sell' };

  const qty = Number(b.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) return { ok: false, error: 'Invalid qty' };

  const type = b.type === undefined || b.type === null || b.type === '' ? 'market' : String(b.type);
  if (type !== 'market' && type !== 'limit') return { ok: false, error: 'Type must be market or limit' };

  const limitPrice = Number(b.limitPrice);
  if (type === 'limit' && !(limitPrice > 0)) {
    return { ok: false, error: 'Limit orders require a positive limit price' };
  }

  const clientOrderId = b.clientOrderId === undefined || b.clientOrderId === null
    ? '' : String(b.clientOrderId).trim();
  if (clientOrderId && !CLIENT_ORDER_ID_RE.test(clientOrderId)) {
    return { ok: false, error: 'Invalid client order id' };
  }

  const timeInForce = b.timeInForce === undefined || b.timeInForce === null || b.timeInForce === ''
    ? 'day' : String(b.timeInForce);

  const order = { symbol, side: b.side, qty, type, timeInForce };
  if (type === 'limit') order.limitPrice = limitPrice;
  if (clientOrderId) order.clientOrderId = clientOrderId;
  return { ok: true, order };
}

module.exports = { CLIENT_ORDER_ID_RE, validateOrderBody };
