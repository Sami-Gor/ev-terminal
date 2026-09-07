'use strict';

/** GET /api/market — read-only snapshot of the in-memory market cache. */
const express = require('express');
const marketData = require('../services/market-data');

const router = express.Router();

router.get('/', (req, res) => {
  const snapshot = marketData.getCachedMarketData();
  if (!snapshot) {
    return res.status(503).json({ error: 'Market cache warming up — try again shortly' });
  }
  res.json(snapshot);
});

module.exports = router;
