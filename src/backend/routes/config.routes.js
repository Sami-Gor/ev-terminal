'use strict';

/** GET /api/config — public, non-secret client configuration:
 *  distribution mode, effective data mode, upgrade hook flag. Contains no
 *  keys or credentials. */
const express = require('express');
const config = require('../config');
const upgradeInterest = require('../services/upgrade-interest');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    distributionMode: config.DISTRIBUTION_MODE,
    dataMode: 'simulated',                     // v1.0 ships on the simulated engine
    simulated: true,                           // explicit — real data is a future paid upgrade
    upgradeInterestEnabled: true
  });
});

module.exports = router;
