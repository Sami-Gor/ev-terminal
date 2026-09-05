'use strict';

const express = require('express');
const marketData = require('../services/market-data');
const { okSymbol, createError } = require('../services/symbol-utils');

const router = express.Router();

router.get('/:symbol', async (req, res, next) => {
  const sym = String(req.params.symbol || '').toUpperCase();
  const timeframe = String(req.query.timeframe || 'd').toLowerCase();
  if (!okSymbol(sym)) return next(createError(400, 'Invalid symbol'));
  if (!marketData.TIMEFRAMES.includes(timeframe)) {
    return next(createError(400, 'Invalid timeframe (d, 4h, 15m)'));
  }
  try {
    res.json(await marketData.getHistory(sym, timeframe));
  } catch (e) {
    next(createError(502, 'Upstream Data Unavailable', `history ${sym}: ${e.message}`));
  }
});

module.exports = router;
