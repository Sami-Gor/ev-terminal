'use strict';

/**
 * Upgrade-interest capture — demand signal for the future paid data tier.
 * Records are append-only JSON (var/upgrade-interest.json, git-ignored);
 * aggregate count is public, individual emails are never returned.
 */
const express = require('express');
const upgradeInterest = require('../services/upgrade-interest');

const router = express.Router();

router.post('/', (req, res) => {
  const result = upgradeInterest.validate(req.body && req.body.email);
  if (!result.ok) return res.status(400).json({ error: 'Enter a valid email address' });
  const total = upgradeInterest.capture(result.record);
  res.json({ ok: true, total });
});

router.get('/count', (req, res) => {
  res.json({ total: upgradeInterest.count() });
});

module.exports = router;
