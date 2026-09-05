'use strict';

/**
 * WebSocket feed manager (hardened):
 *   - origin verification on upgrade (allowlist only)
 *   - max 50 tracked symbols per client socket
 *   - ping/pong heartbeat (30 s) terminates dead connections
 *   - JSON-safe message parsing and generic error frames
 */
const { WebSocketServer } = require('ws');
const config = require('../config');
const marketData = require('../services/market-data');
const { okSymbol } = require('../services/symbol-utils');

let wss = null;
const globalSubscriptions = new Set();

const HEARTBEAT_OK = Symbol('heartbeat-ok');

function originAllowed(origin) {
  if (!origin) return false;                       // same-origin browsers send Origin; reject missing
  return config.ALLOWED_ORIGINS.includes(origin);
}

function normalizeSymbols(raw) {
  return Array.isArray(raw)
    ? raw.filter(s => typeof s === 'string' && okSymbol(s)).map(s => s.toUpperCase())
    : [];
}

function safeSend(ws, payload) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(payload)); } catch (e) { /* socket dying — heartbeat will reap it */ }
  }
}

function init(httpServer) {
  // Origin gate at the HTTP upgrade handshake — rejected sockets never become WS connections.
  httpServer.on('upgrade', (req, socket, head) => {
    if (!originAllowed(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  wss.on('connection', (ws, req) => {
    if (!originAllowed(req.headers.origin)) {           // defense in depth
      ws.close(1008, 'Origin not allowed');
      return;
    }
    ws.isAlive = true;
    ws.clientSubscriptions = new Set();
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', raw => {
      ws.isAlive = true;
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { safeSend(ws, { type: 'error', error: 'Malformed message' }); return; }
      if (msg.type === 'subscribe') {
        const requested = normalizeSymbols(msg.symbols);
        const accepted = [];
        for (const sym of requested) {
          if (ws.clientSubscriptions.has(sym)) { accepted.push(sym); continue; }
          if (ws.clientSubscriptions.size >= config.WS_MAX_SYMBOLS_PER_CLIENT) {
            safeSend(ws, { type: 'error', error: `Subscription limit reached (max ${config.WS_MAX_SYMBOLS_PER_CLIENT} symbols)` });
            continue;
          }
          ws.clientSubscriptions.add(sym);
          globalSubscriptions.add(sym);
          accepted.push(sym);
        }
        safeSend(ws, { type: 'subscribed', symbols: accepted });
      } else if (msg.type === 'unsubscribe') {
        const syms = normalizeSymbols(msg.symbols);
        syms.forEach(s => {
          ws.clientSubscriptions.delete(s);
          const stillWanted = [...wss.clients].some(c => c !== ws && c.clientSubscriptions && c.clientSubscriptions.has(s));
          if (!stillWanted) globalSubscriptions.delete(s);
        });
        safeSend(ws, { type: 'unsubscribed', symbols: syms });
      } else {
        safeSend(ws, { type: 'error', error: 'Unsupported message type' });
      }
    });
  });

  // heartbeat: terminate dead sockets every WS_HEARTBEAT_MS
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) { ws.terminate(); return; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { ws.terminate(); }
    });
  }, config.WS_HEARTBEAT_MS);

  // tick poller → broadcast quotes to all subscribed clients
  setInterval(pollOnce, config.POLL_INTERVAL_MS);
}

async function pollOnce() {
  if (!globalSubscriptions.size) return;
  try {
    const quotes = await marketData.getQuotes([...globalSubscriptions]);
    for (const [sym, quote] of quotes) {
      if (!(quote.price > 0)) continue;
      const message = JSON.stringify({
        type: 'tick',
        symbol: sym,
        price: quote.price,
        change: Number.isFinite(quote.change) ? quote.change : 0,
        percentChange: Number.isFinite(quote.percentChange) ? quote.percentChange : 0,
        volume: Number.isFinite(quote.volume) ? quote.volume : 0,
      });
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          try { client.send(message); } catch (e) { /* reaped by heartbeat */ }
        }
      }
    }
  } catch (e) {
    console.error('[feed-manager] poll failed:', e.message);
  }
}

function clientCount() {
  return wss ? wss.clients.size : 0;
}

function subscribedSymbols() {
  return [...globalSubscriptions];
}

module.exports = { init, clientCount, subscribedSymbols };
