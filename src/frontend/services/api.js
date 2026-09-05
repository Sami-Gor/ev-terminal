/**
 * api.js — REST service layer. All network calls flow through here;
 * components never call fetch() directly.
 */
import { bus, setConnection, finalizeFromHistory, chartState } from './store.js';

import { DATES, genHist } from '../utils/demo-engine.js';

export const API_BASE = (location.protocol.startsWith('http') && location.port === '3000')
  ? '' : 'http://127.0.0.1:3000';
export const WS_URL = 'ws://localhost:3000';

/** GET JSON with unified error shape (err.status / err.message). */
export async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || 'http ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

let restFailStreak = 0;

/**
 * Load 60-session daily bars for a tracker (server first, seeded offline
 * fallback second) and finalize the derived fields. Never hangs: failures
 * mark the tracker offline-ready and the connection badge degrades gracefully.
 */
export async function ensureHistory(t) {
  if (t.hist || t.loading) return;
  t.loading = true;
  try {
    const data = await fetchJson(`${API_BASE}/api/history/${encodeURIComponent(t.sym)}`);
    const bars = (data.bars || []).slice(-60);
    if (bars.length < 10) throw new Error('insufficient bars');
    t.hist = bars.map(b => ({
      o: b.o, h: b.h, l: b.l, c: b.c,
      v: b.v > 5000 ? b.v / 1e6 : b.v,
      dt: (b.date || '').slice(0, 10),
    }));
    finalizeFromHistory(t);
    restFailStreak = 0;
    setConnection({ restOk: true, provider: data.provider || connectionProvider() });
    bus.emit('history-loaded', t.sym);
  } catch (e) {
    restFailStreak++;
    if (!t.hist) {
      t.hist = genHist(t);
      t.hist.forEach((b, i) => { b.dt = DATES[i].toISOString().slice(0, 10); });
      finalizeFromHistory(t);
    }
    if (restFailStreak >= 5) setConnection({});
    bus.emit('history-loaded', t.sym);
  }
  t.loading = false;
  if (chartState.focus === t.sym) bus.emit('focus-redraw');
}

/** Refresh last/change/volume/name from the quote endpoint (best effort). */
export async function ensureQuote(t) {
  try {
    const quote = await fetchJson(`${API_BASE}/api/quote/${encodeURIComponent(t.sym)}`);
    setConnection({ restOk: true, provider: quote.provider || connectionProvider() });
    if (quote.price > 0) t.last = quote.price;
    if (Number.isFinite(quote.change)) {
      t.chg = quote.change;
      t.pct = Number.isFinite(quote.percentChange)
        ? quote.percentChange
        : (t.prevClose ? t.chg / t.prevClose * 100 : t.pct);
    }
    if (Number.isFinite(quote.volume) && quote.volume > 0) t.vol = quote.volume > 5000 ? quote.volume / 1e6 : quote.volume;
    if (quote.name && quote.name !== t.sym) t.name = quote.name;
    bus.emit('quote-loaded', t.sym);
  } catch (e) { /* quote is best-effort */ }
}

function connectionProvider() {
  return 'demo';
}

/** Staggered boot fetch: histories first, then quotes. */
export function scheduleInitialLoads(universe) {
  universe.forEach((t, i) => setTimeout(() => ensureHistory(t), i * 150));
  setTimeout(() => {
    universe.forEach((t, i) => setTimeout(() => ensureQuote(t), i * 200));
  }, universe.length * 150 + 1500);
}
