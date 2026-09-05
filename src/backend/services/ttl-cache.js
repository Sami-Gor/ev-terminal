'use strict';

/**
 * TTL cache used by the market-data service layer.
 */
class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) return null;
    return entry.payload;
  }

  set(key, payload) {
    this.entries.set(key, { ts: Date.now(), payload });
  }
}

module.exports = { TtlCache };
