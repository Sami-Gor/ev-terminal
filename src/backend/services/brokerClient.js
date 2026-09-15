'use strict';

/**
 * Alpaca REST broker client — private self-use order routing.
 * Paper trading by default (ALPACA_PAPER !== 'false').
 *
 * Returns a uniform envelope so route handlers can emit generic errors
 * without leaking provider details: { ok, status, data }.
 */
const axios = require('axios');
const config = require('../config');

const PAPER_BASE = 'https://paper-api.alpaca.markets';
const LIVE_BASE = 'https://api.alpaca.markets';

function configured() {
  return config.ALPACA_API_KEY !== '' && config.ALPACA_SECRET_KEY !== '';
}

function client() {
  return axios.create({
    baseURL: config.ALPACA_PAPER ? PAPER_BASE : LIVE_BASE,
    timeout: 10000,
    headers: {
      'APCA-API-KEY-ID': config.ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': config.ALPACA_SECRET_KEY,
    },
  });
}

/** Account equity / cash / buying power. */
async function getAccount() {
  const { data } = await client().get('/v2/account');
  return {
    equity: Number(data.equity),
    cash: Number(data.cash),
    buyingPower: Number(data.buying_power),
    portfolioValue: Number(data.portfolio_value),
    status: data.status,
    paper: config.ALPACA_PAPER,
  };
}

/** Open positions, normalized for the Quick-Trade overlay. */
async function getPositions() {
  const { data } = await client().get('/v2/positions');
  return (Array.isArray(data) ? data : []).map(p => ({
    symbol: p.symbol,
    qty: Number(p.qty),
    side: Number(p.qty) >= 0 ? 'long' : 'short',
    avgEntryPrice: Number(p.avg_entry_price),
    marketValue: Number(p.market_value),
    costBasis: Number(p.cost_basis),
    unrealizedPL: Number(p.unrealized_pl),
    unrealizedPLPC: Number(p.unrealized_plpc),
    currentPrice: Number(p.current_prices ? p.current_prices[0] : p.asset_price ?? 0) || undefined,
  }));
}

/**
 * Builds the Alpaca order request body (exported for tests).
 * A valid clientOrderId is forwarded as client_order_id: Alpaca rejects a
 * duplicate id for the same account, which makes a retried transport request
 * idempotent instead of creating a second order.
 */
function buildOrderBody({ symbol, qty, side, type = 'market', limitPrice, timeInForce = 'day', clientOrderId }) {
  const body = {
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce,
  };
  if (type === 'limit') body.limit_price = String(limitPrice);
  if (clientOrderId) body.client_order_id = clientOrderId;
  return body;
}

/**
 * Submits an order.
 *   market:  { symbol, qty, side: 'buy'|'sell' }
 *   limit:   { symbol, qty, side, limitPrice }
 * Both default to time_in_force 'day'.
 *
 * The shared client performs no automatic POST retries (plain axios, no
 * retry interceptor), so one call maps to at most one broker request.
 */
async function submitOrder(order) {
  const { data } = await client().post('/v2/orders', buildOrderBody(order));
  return {
    id: data.id,
    symbol: data.symbol,
    side: data.side,
    type: data.type,
    qty: Number(data.qty),
    limitPrice: data.limit_price ? Number(data.limit_price) : null,
    status: data.status,
    submittedAt: data.submitted_at,
  };
}

/** Closes an open position by market order (Alpaca close-position endpoint). */
async function closePosition(symbol) {
  const { data } = await client().delete(`/v2/positions/${encodeURIComponent(symbol)}`);
  return {
    symbol: data.symbol,
    qty: Number(data.qty),
    status: data.status,
  };
}

/** Open orders for the account. */
async function getOrders(status = 'open') {
  const { data } = await client().get('/v2/orders', { params: { status, limit: 50 } });
  return (Array.isArray(data) ? data : []).map(o => ({
    id: o.id,
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    qty: Number(o.qty),
    filledQty: Number(o.filled_qty),
    limitPrice: o.limit_price ? Number(o.limit_price) : null,
    status: o.status,
    submittedAt: o.submitted_at,
  }));
}

/** Cancels an open order. */
async function cancelOrder(id) {
  await client().delete(`/v2/orders/${encodeURIComponent(id)}`);
}

module.exports = { configured, getAccount, getPositions, submitOrder, closePosition, getOrders, cancelOrder, buildOrderBody };
