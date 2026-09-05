/**
 * ws-client.js — WebSocket feed with auto-reconnect and subscription sync.
 * Consumers register via onTick((symbol, tracker) => …).
 */
import { WS_URL } from './api.js';
import { setConnection, applyTick, getTracker, universe } from './store.js';

const tickHandlers = [];
const clientSubscriptions = new Set();
let ws = null;

function wsConnect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    setConnection({ wsOk: false });
    return;
  }
  ws.onopen = () => {
    setConnection({ wsOk: true });
    wsSubscribe(clientSubscriptions.size ? [...clientSubscriptions] : universe.map(t => t.sym));
  };
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'tick' && msg.symbol) {
      if (applyTick(msg)) tickHandlers.forEach(cb => cb(msg.symbol, getTracker(msg.symbol)));
    } else if (msg.type === 'hello' && msg.provider) {
      setConnection({ provider: msg.provider });
    }
  };
  ws.onclose = () => {
    setConnection({ wsOk: false });
    setTimeout(wsConnect, 3000);          // self-healing reconnect
  };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* already closed */ } };
}

export function wsSubscribe(syms) {
  if (!syms || !syms.length) return;
  syms.forEach(s => clientSubscriptions.add(s));
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'subscribe', symbols: syms }));
}

export function wsUnsubscribe(syms) {
  if (!syms || !syms.length) return;
  syms.forEach(s => clientSubscriptions.delete(s));
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'unsubscribe', symbols: syms }));
}

export function onTick(cb) {
  tickHandlers.push(cb);
}

export { wsConnect };
