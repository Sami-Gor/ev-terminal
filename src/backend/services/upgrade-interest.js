'use strict';

/**
 * Upgrade-interest store — append-only JSON file capturing demand for the
 * future paid data tier.
 *
 * The file contains real email addresses: it lives in var/ which is
 * git-ignored, and must NEVER be committed. No credentials are involved —
 * the path itself is the only configuration.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const STORE_PATH = config.UPGRADE_INTEREST_FILE;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validates + normalizes a capture request; returns { ok, error?, record }. */
function validate(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(value) || value.length > 254) {
    return { ok: false, error: 'invalid email' };
  }
  return {
    ok: true,
    record: {
      email: value,
      timestamp: new Date().toISOString(),
      distributionMode: config.DISTRIBUTION_MODE,
    },
  };
}

/** Appends a validated record; returns the current total interest count. */
function capture(record) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!Array.isArray(entries)) entries = [];
  } catch (e) { entries = []; }              // missing or corrupt → start fresh
  entries.push(record);
  fs.writeFileSync(STORE_PATH, JSON.stringify(entries, null, 2));
  return entries.length;
}

/** Current count of captured interests (0 when the file is absent/corrupt). */
function count() {
  try {
    const entries = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return Array.isArray(entries) ? entries.length : 0;
  } catch (e) { return 0; }
}

module.exports = { validate, capture, count, STORE_PATH };
