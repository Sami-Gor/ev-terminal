'use strict';

const express = require('express');
const marketData = require('../services/market-data');
const { okSymbol, createError } = require('../services/symbol-utils');

const router = express.Router();

router.get('/:symbol', async (req, res, next) => {
  const sym = String(req.params.symbol || '').toUpperCase();
  const priority = req.query.priority === 'low' ? 'low' : 'high';
  if (!okSymbol(sym)) return next(createError(400, 'Invalid symbol'));
  try {
    const quote = await marketData.getQuote(sym, { priority });
    if (!quote) return next(createError(404, 'Symbol Not Found', `quote lookup miss: ${sym}`));
    res.json(quote);
  } catch (e) {
    next(createError(502, 'Upstream Data Unavailable', `quote ${sym}: ${e.message}`));
  }
});

module.exports = router;
