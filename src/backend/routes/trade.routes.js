'use strict';

/**
 * Private trading routes — direct Alpaca order routing for self-use.
 * All endpoints return generic error envelopes; broker details (keys,
 * account ids) never appear in responses or logs.
 */
const express = require('express');
const broker = require('../services/brokerClient');
const marketData = require('../services/market-data');
const { okSymbol, createError } = require('../services/symbol-utils');

const router = express.Router();

const BROKER_NOT_CONFIGURED = 'Broker not configured — set ALPACA_API_KEY / ALPACA_SECRET_KEY in .env';

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
  const { symbol, side, qty, type = 'market', limitPrice, timeInForce = 'day' } = req.body || {};
  const sym = String(symbol || '').toUpperCase();
  if (!okSymbol(sym)) return next(createError(400, 'Invalid symbol'));
  if (side !== 'buy' && side !== 'sell') return next(createError(400, 'Side must be buy or sell'));
  const qtyNum = Number(qty);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0 || qtyNum > 100000) return next(createError(400, 'Invalid qty'));
  if (type !== 'market' && type !== 'limit') return next(createError(400, 'Type must be market or limit'));
  if (type === 'limit' && !(Number(limitPrice) > 0)) return next(createError(400, 'Limit orders require a positive limit price'));
  try {
    const order = await broker.submitOrder({
      symbol: sym,
      qty: qtyNum,
      side,
      type,
      limitPrice: Number(limitPrice),
      timeInForce,
    });
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
