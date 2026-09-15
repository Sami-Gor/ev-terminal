'use strict';

/** GET /api/config — public, non-secret client configuration:
 *  distribution mode, effective data mode, provider and upgrade hook flag.
 *  Contains no keys or credentials. */
const express = require('express');
const config = require('../config');
const marketData = require('../services/market-data');
const upgradeInterest = require('../services/upgrade-interest');

const router = express.Router();

router.get('/', (req, res) => {
  const dataMode = marketData.getDataMode();
  res.json({
    distributionMode: config.DISTRIBUTION_MODE,
    provider: config.PROVIDER_MODE,
    // Precise data provenance: 'simulated' | 'eod' (previous close only) | 'realtime'.
    dataMode,
    simulated: dataMode === 'simulated',
    // Safe capability flag only: false in public mode and until TRADING_API_TOKEN
    // is configured. Never exposes the token or broker credentials.
    tradingEnabled: config.TRADING_ENABLED,
    upgradeInterestEnabled: true
  });
});

module.exports = router;
