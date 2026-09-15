'use strict';

/**
 * Private trading routes — direct Alpaca order routing for self-use.
 *
 * Stage 1 hardening (applied to every route below, in order):
 *   1. public distribution mode answers 404 — the feature does not exist and
 *      broker credentials are never used;
 *   2. Authorization: Bearer <TRADING_API_TOKEN> is required (generic 401s,
 *      constant-time comparison; 503 until a token is configured);
 *   3. order payloads are validated and client_order_id forwarded so a
 *      repeated transport retry maps to one broker order.
 *
 * All endpoints return generic error envelopes; broker details (keys,
 * account ids) never appear in responses or logs.
 */
const express = require('express');
const broker = require('../services/brokerClient');
const marketData = require('../services/market-data');
const { okSymbol, createError } = require('../services/symbol-utils');
const { createAccessGate, createTokenGate } = require('../services/trading-guard');
const { validateOrderBody } = require('../services/order-validation');

const router = express.Router();

/* Stage 1 gates — must stay ahead of every route handler. */
router.use(createAccessGate());
router.use(createTokenGate());

const BROKER_NOT_CONFIGURED = 'Broker not configured';

/** Merges the latest cache price into a position for live P&L. */
function withLivePrice(positions) {
  const snapshot = marketData.getCachedMarketData();
  const prices = new Map((snapshot ? snapshot.tickers : []).map(t => [t.symbol, t.price]));
  return positions.map(p => {
    const last = prices.get(p.symbol);
    const direction = p.side === 'long' ? 1 : -1;
    const unrealizedPL = last != null ? (last - p.avgEntryPrice) * p.qty * direction : p.unrealizedPL;
    return { ...p, lastPrice: last ?? null, unrealizedPL };
  });
}

router.get('/account', requireBroker, async (req, res, next) => {
  try {
    res.json(await broker.getAccount());
  } catch (e) {
    next(createError(502, 'Broker account unavailable', e.message));
  }
});

router.get('/positions', requireBroker, async (req, res, next) => {
  try {
    const positions = withLivePrice(await broker.getPositions());
    res.json({ positions });
  } catch (e) {
    next(createError(502, 'Broker positions unavailable', e.message));
  }
});

router.post('/orders', requireBroker, async (req, res, next) => {
  const validation = validateOrderBody(req.body);
  if (!validation.ok) return next(createError(400, validation.error));
  try {
    const order = await broker.submitOrder(validation.order);
    res.json({ ok: true, order });
  } catch (e) {
    next(createError(502, 'Order rejected by broker', e.message));
  }
});

router.post('/positions/close', requireBroker, async (req, res, next) => {
  const symbol = String((req.body || {}).symbol || '').toUpperCase();
  if (!okSymbol(symbol)) return next(createError(400, 'Invalid symbol'));
  try {
    const result = await broker.closePosition(symbol);
    res.json({ ok: true, result });
  } catch (e) {
    next(createError(502, 'Close failed', e.message));
  }
});

router.get('/orders', requireBroker, async (req, res, next) => {
  try {
    res.json({ orders: await broker.getOrders(req.query.status || 'open') });
  } catch (e) {
    next(createError(502, 'Orders unavailable', e.message));
  }
});

router.delete('/orders/:id', requireBroker, async (req, res, next) => {
  try {
    await broker.cancelOrder(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(createError(502, 'Cancel failed', e.message));
  }
});

function requireBroker(req, res, next) {
  if (!broker.configured()) return next(createError(503, BROKER_NOT_CONFIGURED));
  next();
}

module.exports = router;
