/**
 * api.js — REST service layer. All network calls flow through here;
 * components never call fetch() directly.
 */
import { bus, setConnection, finalizeFromHistory, chartState, getTracker } from './store.js';

import { DATES, genHist } from '../utils/demo-engine.js';

/** Fallback origin for pages not served by the app itself (dev ports). */
export const API_ORIGIN = 'http://127.0.0.1:3000';

const SERVED_BY_APP = location.protocol.startsWith('http') && location.port === '3000';

export const API_BASE = SERVED_BY_APP ? '' : API_ORIGIN;
/** WS endpoint: same host when served by the app, local dev server otherwise. */
export const WS_URL = SERVED_BY_APP
  ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
  : 'ws://localhost:3000';

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
 * `priority: 'low'` is for background prefetch so it yields to the visible
 * chart's history in the provider rate-limit queue.
 */
export async function ensureHistory(t, priority = 'high') {
  if (t.hist || t.loading) return;
  t.loading = true;
  try {
    const suffix = priority === 'low' ? '?priority=low' : '';
    const data = await fetchJson(`${API_BASE}/api/history/${encodeURIComponent(t.sym)}${suffix}`);
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

/** Refresh last/change/volume/name from the quote endpoint (best effort).
 *  Deduplicated per tracker; used for direct/on-demand refreshes only —
 *  the background board is populated by the market cache feed. */
export async function ensureQuote(t, priority = 'high') {
  if (t.quoteLoading) return;
  t.quoteLoading = true;
  try {
    const suffix = priority === 'low' ? '?priority=low' : '';
    const quote = await fetchJson(`${API_BASE}/api/quote/${encodeURIComponent(t.sym)}${suffix}`);
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
  } catch (e) { /* quote is best-effort */ } finally { t.quoteLoading = false; }
}

function connectionProvider() {
  return 'demo';
}

/**
 * Resolves the server's public configuration (distribution mode, provider,
 * effective data mode, trading capability). Refreshed periodically so a
 * free-tier downgrade (realtime → EOD) is reflected in the UI labels.
 */
export async function fetchAppConfig() {
  try {
    const cfg = await fetchJson(`${API_BASE}/api/config`);
    const dataMode = cfg.dataMode || (cfg.simulated === false ? 'realtime' : 'simulated');
    setConnection({
      restOk: true,
      provider: cfg.provider || (dataMode === 'simulated' ? 'demo' : connectionProvider()),
      distributionMode: cfg.distributionMode || 'local',
      dataMode,
      tradingEnabled: cfg.tradingEnabled === true,
    });
    return cfg;
  } catch (e) {
    setConnection({});                       // offline → deterministic demo
    return null;
  }
}

/** Boot fetch: the visible chart's history only (high priority). The board is
 *  populated by the provider poller / live stream via the market cache, so no
 *  per-symbol quote or all-universe history burst is issued here. */
export function scheduleInitialLoads(universe) {
  fetchAppConfig();
  // The first provider poll can downgrade realtime → EOD moments after boot;
  // refresh shortly after and then periodically to keep labels honest.
  setTimeout(fetchAppConfig, 8000);
  setInterval(fetchAppConfig, 60000);
  const focused = getTracker(chartState.focus);
  if (focused) ensureHistory(focused);
}
