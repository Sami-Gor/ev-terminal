'use strict';

/** GET /api/news — enriched EV news wire (mock headlines + correlation engine). */
const express = require('express');
const demoProvider = require('../providers/demo-provider');

const router = express.Router();

router.get('/', (req, res) => {
  const news = demoProvider.demoNews();
  res.json({
    engine: 'Built-in EV Maker Topic Correlation Engine (Active)',
    count: news.length,
    news,
  });
});

module.exports = router;
