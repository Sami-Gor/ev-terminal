'use strict';

/**
 * WebSocket broadcast hub (hardened):
 *   - managed client registry (Map) with clean disconnect handling
 *   - origin verification at the HTTP upgrade handshake (allowlist only)
 *   - immediate cache snapshot to every newly connected client (no cold start)
 *   - onCacheUpdate → tick broadcast to all OPEN, subscribed clients
 *   - per-client subscription cap (50 symbols)
 *   - ping/pong heartbeat (30 s) terminates dead connections
 */
const { WebSocketServer } = require('ws');
const config = require('../config');
const marketData = require('../services/market-data');
const { okSymbol } = require('../services/symbol-utils');

let wss = null;

/**
 * Managed registry of active client connections.
 *   ws → { subscriptions: Set<sym>, alive: bool }
 */
const clients = new Map();
const globalSubscriptions = new Set();

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
    try { ws.send(JSON.stringify(payload)); } catch (e) { dropClient(ws); }
  }
}

/** Remove a socket from the registry and prune orphaned global subscriptions. */
function dropClient(ws) {
  const info = clients.get(ws);
  clients.delete(ws);
  if (info) {
    for (const sym of info.subscriptions) {
      const stillWanted = [...clients.values()].some(c => c !== ws && c.subscriptions.has(sym));
      if (!stillWanted) globalSubscriptions.delete(sym);
    }
  }
}

/**
 * Push the latest cached ticks to one client (cold-start elimination).
 * A client with no explicit subscriptions receives the full board; after any
 * subscribe/unsubscribe it receives only its subscribed symbols.
 */
function sendSnapshot(ws, info) {
  const cached = marketData.getCachedMarketData();
  if (!cached) return;
  for (const t of cached.tickers) {
    if (info.subscriptions.size && !info.subscriptions.has(t.symbol)) continue;
    safeSend(ws, {
      type: 'tick', symbol: t.symbol, price: t.price,
      change: Number.isFinite(t.change) ? t.change : 0,
      percentChange: Number.isFinite(t.percentChange) ? t.percentChange : 0,
      volume: Number.isFinite(t.volume) ? t.volume : 0,
    });
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
    if (!originAllowed(req.headers.origin)) {        // defense in depth
      ws.close(1008, 'Origin not allowed');
      return;
    }

    // register in the managed client registry
    clients.set(ws, { subscriptions: new Set(), alive: true });
    ws.on('pong', () => { const info = clients.get(ws); if (info) info.alive = true; });

    // cold-start elimination: latest cache snapshot immediately on connect
    sendSnapshot(ws, clients.get(ws));

    ws.on('message', raw => {
      const info = clients.get(ws);
      if (!info) return;                             // unregistered socket — ignore
      info.alive = true;
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { safeSend(ws, { type: 'error', error: 'Malformed message' }); return; }

      if (msg.type === 'subscribe') {
        const requested = normalizeSymbols(msg.symbols);
        const accepted = [];
        for (const sym of requested) {
          if (info.subscriptions.has(sym)) { accepted.push(sym); continue; }
          if (info.subscriptions.size >= config.WS_MAX_SYMBOLS_PER_CLIENT) {
            safeSend(ws, { type: 'error', error: `Subscription limit reached (max ${config.WS_MAX_SYMBOLS_PER_CLIENT} symbols)` });
            continue;
          }
          info.subscriptions.add(sym);
          globalSubscriptions.add(sym);
          accepted.push(sym);
        }
        safeSend(ws, { type: 'subscribed', symbols: accepted });
        sendSnapshot(ws, info);                      // snapshot covering the new symbols
      } else if (msg.type === 'unsubscribe') {
        const syms = normalizeSymbols(msg.symbols);
        syms.forEach(s => info.subscriptions.delete(s));
        safeSend(ws, { type: 'unsubscribed', symbols: syms });
      } else {
        safeSend(ws, { type: 'error', error: 'Unsupported message type' });
      }
    });

    // clean disconnect: remove from the registry and prune orphaned symbols
    ws.on('close', () => dropClient(ws));
    ws.on('error', () => { try { ws.close(); } catch (e) { /* already closed */ } });
  });

  // heartbeat: terminate dead sockets every WS_HEARTBEAT_MS
  setInterval(() => {
    for (const [ws, info] of clients) {
      if (!info.alive) { ws.terminate(); clients.delete(ws); continue; }
      info.alive = false;
      try { ws.ping(); } catch (e) { ws.terminate(); }
    }
  }, config.WS_HEARTBEAT_MS);

  // market-data cache refresh → broadcast to all OPEN registered clients
  marketData.onCacheUpdate(snapshot => {
    for (const [ws, info] of clients) {
      if (ws.readyState !== 1) continue;             // OPEN only
      for (const t of snapshot.tickers) {
        if (info.subscriptions.size && !info.subscriptions.has(t.symbol)) continue;  // subscribed → only their symbols
        safeSend(ws, {
          type: 'tick', symbol: t.symbol, price: t.price,
          change: Number.isFinite(t.change) ? t.change : 0,
          percentChange: Number.isFinite(t.percentChange) ? t.percentChange : 0,
          volume: Number.isFinite(t.volume) ? t.volume : 0,
        });
      }
    }
  });
}

function clientCount() {
  return clients.size;
}

function subscribedSymbols() {
  return [...globalSubscriptions];
}

module.exports = { init, clientCount, subscribedSymbols };
