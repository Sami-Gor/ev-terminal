'use strict';

/**
 * Express application assembly: security middleware, CORS allowlist,
 * rate limiting, static hosting, REST routes and sanitized error handling.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ALLOWED_ORIGINS, API_RATE_LIMIT } = require('./config');
const statusRoutes = require('./routes/status.routes');
const historyRoutes = require('./routes/history.routes');
const quoteRoutes = require('./routes/quote.routes');
const financialsRoutes = require('./routes/financials.routes');
const configRoutes = require('./routes/config.routes');
const tradeRoutes = require('./routes/trade.routes');
const upgradeInterestRoutes = require('./routes/upgrade-interest.routes');
const marketRoutes = require('./routes/market.routes');
const newsRoutes = require('./routes/news.routes');

const app = express();
app.disable('x-powered-by');

/* connect-src follows the same allowlist as CORS (http(s) origins plus their
 * ws(s) variants) instead of a separate hardcoded list that could drift. */
const CONNECT_SRC = [
  "'self'",
  ...ALLOWED_ORIGINS,
  ...ALLOWED_ORIGINS.map(o => o.replace(/^http/, 'ws')),
];

/* ---- security headers (CSP, X-Frame-Options, No-Sniff, Referrer-Policy…) -- */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],   // inline style="" attributes on panels
      'img-src': ["'self'", 'data:'],                // inline SVG favicon
      'connect-src': CONNECT_SRC,
      'font-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

/* ---- CORS: echo only allowlisted origins (no wildcard) -------------------- */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  next();
});

/* ---- rate limiting: /api/* max 100 requests / 15 min / IP ----------------- */
const apiLimiter = rateLimit({
  windowMs: API_RATE_LIMIT.windowMs,
  max: API_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — limit is 100 per 15 minutes' },
});
app.use('/api', apiLimiter);

/* ---- static hosting -------------------------------------------------------- */
app.use(express.json({ limit: '16kb' }));   // upgrade-interest capture bodies
app.use(express.static(path.join(__dirname, '..', '..', 'public')));
app.use('/src/frontend', express.static(path.join(__dirname, '..', '..', 'src', 'frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html')));

/* ---- REST routes ----------------------------------------------------------- */
app.use('/api/status', statusRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/financials', financialsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/upgrade-interest', upgradeInterestRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/news', newsRoutes);

/* ---- sanitized error handling: never leak stacks, provider details or keys - */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[api] ${req.method} ${req.originalUrl} → ${status}: ${err.message}`);
  // Intentional operational errors (createError with publicMessage) pass through;
  // truly unexpected errors get a generic message with no internal details.
  const publicMessage = err.publicMessage
    || (status >= 500 ? 'Internal Server Error' : 'Bad Request');
  res.status(status).json({ error: publicMessage });
});

module.exports = app;
