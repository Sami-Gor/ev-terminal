'use strict';

/**
 * Polygon real-time trade stream (local mode with POLYGON_API_KEY only).
 *
 * Connects to the stocks cluster, authenticates, subscribes to trades for
 * the tracked universe, and hands each trade to `onTick`. Reconnects with
 * backoff; when the stream stays down, `degraded` flips true so the owner
 * can fall back to REST polling.
 */
const WebSocket = require('ws');
const config = require('../config');

const CLUSTER_URL = 'wss://socket.polygon.io/stocks';
const BASE_RECONNECT_MS = 5000;
const MAX_RECONNECT_MS = 60000;

let ws = null;
let tickHandler = null;
let getSymbols = () => [];
let reconnectTimer = null;
let attempts = 0;
let degraded = false;

function authOk() {
  return config.POLYGON_KEY !== '' && config.PROVIDER_MODE === 'polygon';
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function connect() {
  if (!authOk()) return;
  ws = new WebSocket(CLUSTER_URL);

  ws.on('open', () => {
    attempts = 0;
    send({ action: 'auth', params: config.POLYGON_KEY });
  });

  ws.on('message', raw => {
    let events;
    try { events = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(events)) events = [events];
    for (const ev of events) {
      if (ev.status === 'auth_success') {
        degraded = false;
        const params = getSymbols().map(s => `T.${s}`).join(',');
        if (params) send({ action: 'subscribe', params });
      } else if (ev.status === 'error') {
        console.error('[polygon-stream] auth/subscribe error:', ev.message || ev.reason);
        degraded = true;
      } else if (ev.ev === 'T' && ev.sym && typeof ev.p === 'number') {
        if (tickHandler) tickHandler(ev.sym, ev.p, ev.s, ev.t);
      }
    }
  });

  ws.on('close', () => { scheduleReconnect(); });
  ws.on('error', e => {
    console.error('[polygon-stream] error:', e.message);
    try { ws.close(); } catch (err) { /* already closing */ }
  });
}

function scheduleReconnect() {
  ws = null;
  degraded = true;
  const delay = Math.min(BASE_RECONNECT_MS * 2 ** Math.min(attempts, 4), MAX_RECONNECT_MS);
  attempts++;
  console.error(`[polygon-stream] reconnecting in ${delay}ms (attempt ${attempts})`);
  reconnectTimer = setTimeout(connect, delay);
}

/**
 * Starts the stream.
 *   getSymbols() → currently tracked symbols (re-read on each connect)
 *   onTick(symbol, price, size, timestamp) — live trade callback
 */
function start(opts) {
  if (!authOk()) return false;
  getSymbols = opts.getSymbols;
  tickHandler = opts.onTick;
  connect();
  return true;
}

function stop() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
}

module.exports = { start, stop, get degraded() { return degraded; } };
