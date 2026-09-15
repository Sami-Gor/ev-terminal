'use strict';

/**
 * Polygon real-time trade stream (local mode with POLYGON_API_KEY only).
 *
 * Connects to the stocks cluster, authenticates, subscribes to trades for the
 * tracked universe and hands each trade to `onTick`.
 *
 * Failure handling distinguishes:
 *   - transient (network/socket) failures → reconnect with capped backoff;
 *   - a permanent authentication/entitlement rejection (e.g. a plan without
 *     realtime access) → disable the stream for the session after one concise
 *     log line and notify `onUnavailable` so the poller can keep serving REST
 *     quotes at the normal provider cadence.
 */
const WebSocket = require('ws');
const config = require('../config');

const CLUSTER_URL = 'wss://socket.polygon.io/stocks';
const BASE_RECONNECT_MS = 5000;
const MAX_RECONNECT_MS = 60000;

/** Polygon statuses that mean the plan/key cannot use the realtime stream. */
const PERMANENT_STATUSES = new Set(['auth_failed', 'auth_timeout']);
const PERMANENT_MESSAGE_RE = /not[\s_-]*authoriz|entitlement|invalid[\s_-]*api[\s_-]*key|unauthorized|authentication/i;

/** Classifies a stream status event ('auth_ok' | 'permanent' | 'error' | 'ignore'). */
function classifyStatus(status, message) {
  if (status === 'auth_success') return 'auth_ok';
  if (PERMANENT_STATUSES.has(status)) return 'permanent';
  if (status === 'error' && PERMANENT_MESSAGE_RE.test(String(message || ''))) return 'permanent';
  if (status === 'error') return 'error';
  return 'ignore';
}

/**
 * Creates an isolated stream instance (the module exports a singleton wired
 * to the configured key; tests create instances with a fake socket factory).
 */
function createStream(options = {}) {
  const {
    apiKey = config.POLYGON_KEY,
    url = CLUSTER_URL,
    socketFactory = WebSocket,
    baseReconnectMs = BASE_RECONNECT_MS,
    maxReconnectMs = MAX_RECONNECT_MS,
  } = options;

  let ws = null;
  let tickHandler = null;
  let getSymbols = () => [];
  let reconnectTimer = null;
  let attempts = 0;
  let degraded = false;
  let unavailable = false;
  let onUnavailable = null;

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function subscribe() {
    const params = getSymbols().map(s => `T.${s}`).join(',');
    if (params) send({ action: 'subscribe', params });
  }

  /** Permanent rejection: stop reconnecting for this session, notify the poller. */
  function disable(reason) {
    if (unavailable) return;
    unavailable = true;
    degraded = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    console.warn(`[polygon-stream] ${reason} — realtime stream unavailable; using REST fallback`);
    if (ws) { try { ws.close(); } catch (e) { /* already closed */ } }
    if (onUnavailable) {
      try { onUnavailable(); } catch (e) { /* listener errors must not break polling */ }
    }
  }

  function connect() {
    if (!apiKey || unavailable) return;
    ws = new socketFactory(url);

    ws.on('open', () => {
      attempts = 0;
      send({ action: 'auth', params: apiKey });
    });

    ws.on('message', raw => {
      let events;
      try { events = JSON.parse(raw); } catch (e) { return; }
      if (!Array.isArray(events)) events = [events];
      for (const ev of events) {
        if (ev.ev === 'T' && ev.sym && typeof ev.p === 'number') {
          degraded = false;
          if (tickHandler) tickHandler(ev.sym, ev.p, ev.s, ev.t);
          continue;
        }
        const kind = classifyStatus(ev.status, ev.message || ev.reason);
        if (kind === 'auth_ok') {
          degraded = false;
          subscribe();
        } else if (kind === 'permanent') {
          disable('realtime entitlement rejected by the provider for the current plan');
          return;
        } else if (kind === 'error') {
          degraded = true;
          console.error('[polygon-stream] stream error:', ev.message || ev.reason || 'unknown');
        }
      }
    });

    ws.on('close', (code, reason) => {
      ws = null;
      if (unavailable) return;
      const text = String(reason || '');
      if ((code === 1008 || code === 401 || code === 403) && PERMANENT_MESSAGE_RE.test(text)) {
        disable('realtime entitlement rejected by the provider for the current plan');
        return;
      }
      scheduleReconnect();
    });

    ws.on('error', e => {
      console.error('[polygon-stream] error:', e.message || String(e));
      try { if (ws) ws.close(); } catch (err) { /* already closing */ }
    });
  }

  function scheduleReconnect() {
    degraded = true;
    const delay = Math.min(baseReconnectMs * 2 ** Math.min(attempts, 4), maxReconnectMs);
    attempts++;
    console.error(`[polygon-stream] reconnecting in ${delay}ms (attempt ${attempts})`);
    reconnectTimer = setTimeout(connect, delay);
  }

  /**
   * Starts the stream.
   *   getSymbols() → currently tracked symbols (re-read on each connect)
   *   onTick(symbol, price, size, timestamp) — live trade callback
   *   onUnavailable() — called once if the provider permanently rejects the stream
   */
  function start(opts = {}) {
    if (!apiKey || unavailable) return false;
    getSymbols = opts.getSymbols || (() => []);
    tickHandler = opts.onTick || null;
    onUnavailable = opts.onUnavailable || null;
    connect();
    return true;
  }

  function stop() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
  }

  return {
    start,
    stop,
    get degraded() { return degraded; },
    get unavailable() { return unavailable; },
  };
}

const singleton = createStream();

module.exports = {
  start: opts => singleton.start(opts),
  stop: () => singleton.stop(),
  get degraded() { return singleton.degraded; },
  get unavailable() { return singleton.unavailable; },
  // Pure/factory exports (used by tests and by future dynamic-universe wiring).
  createStream,
  classifyStatus,
};
