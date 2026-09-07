'use strict';

const express = require('express');
const config = require('../config');
const marketData = require('../services/market-data');
const feedManager = require('../websocket/feed-manager');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    distributionMode: config.DISTRIBUTION_MODE,
    provider: config.PROVIDER_MODE,
    // Honest mode reporting: a distributed (public) build ALWAYS reports
    // simulated — even if vendor keys happen to sit unused in the env.
    mode: config.PROVIDER_MODE === 'demo' || config.FORCE_SIMULATED ? 'simulated' : 'live-keys',
    wsClients: feedManager.clientCount(),
    subscribed: feedManager.subscribedSymbols(),
    defaultUniverse: marketData.defaultUniverse().map(u => u.sym),
  });
});

module.exports = router;
