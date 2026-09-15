'use strict';

/**
 * Stage 1 trading guard — middleware factories for /api/trade/*.
 *
 * Layered protection (applied before any route handler):
 *   1. createAccessGate() — hard 404 in public distribution mode. Broker
 *      credentials are never touched and private functionality is not
 *      advertised.
 *   2. createTokenGate()  — Authorization: Bearer <TRADING_API_TOKEN> is
 *      required. Trading stays disabled (503) until a token is configured;
 *      missing/wrong tokens get a generic 401.
 *
 * Factories take explicit options so behaviour is unit-testable without
 * mutating environment or config.
 */
const crypto = require('crypto');
const config = require('../config');

/** SHA-256 digests make timingSafeEqual length-safe for arbitrary input. */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

/** Constant-time comparison of two token strings (no length leak). */
function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected === '') return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

/** Extracts the value from an "Authorization: Bearer <token>" header. */
function extractBearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  return m ? m[1].trim() : '';
}

/** Public mode: respond as if the trading API does not exist. */
function createAccessGate({ publicMode = config.FORCE_SIMULATED } = {}) {
  return function accessGate(req, res, next) {
    if (publicMode) return res.status(404).json({ error: 'Not Found' });
    next();
  };
}

/**
 * Token gate. The 503 branch never compares the supplied token, so it reveals
 * nothing about token correctness when trading is not configured.
 */
function createTokenGate({ expectedToken = config.TRADING_TOKEN } = {}) {
  return function tokenGate(req, res, next) {
    if (!expectedToken) return res.status(503).json({ error: 'Trading disabled' });
    const provided = extractBearer(req.headers && req.headers.authorization);
    if (!tokensMatch(provided, expectedToken)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

module.exports = { sha256, tokensMatch, extractBearer, createAccessGate, createTokenGate };
