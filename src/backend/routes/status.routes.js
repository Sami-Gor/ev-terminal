'use strict';

const express = require('express');
const config = require('../config');
const marketData = require('../services/market-data');
const feedManager = require('../websocket/feed-manager');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    provider: config.PROVIDER_MODE,
    mode: config.PROVIDER_MODE === 'demo' ? 'simulated' : 'live-keys',
    wsClients: feedManager.clientCount(),
    subscribed: feedManager.subscribedSymbols(),
    defaultUniverse: marketData.defaultUniverse().map(u => u.sym),
  });
});

module.exports = router;
