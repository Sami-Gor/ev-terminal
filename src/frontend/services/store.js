/**
 * store.js — central data models & state (UPPER_SNAKE_CASE data constants,
 * camelCase accessors). Modules never reach into each other's internals;
 * they import this store and communicate via the event bus.
 */
import { isValidSymbol } from '../utils/sanitize.js';

/* ---------------- market data models ---------------- */

export const SECTORS = {
  PURE: { label: 'PURE-PLAY EV', color: '#00C176' },
  BATT: { label: 'BATTERY & TECH', color: '#58A6FF' },
};

/**
 * Tracked symbol registry. Prices are intentionally null until a genuine
 * provider/simulated tick, history finalize or quote arrives — no seeded
 * constants that could be mistaken for current market data. Custom trackers
 * added by the user carry their own entered price/pct via `addTrackerRecord`.
 */
export const DEFAULT_UNIVERSE = [
  { sym: 'TSLA', name: 'Tesla Inc', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'RIVN', name: 'Rivian Automotive', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'LCID', name: 'Lucid Group', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'NIO', name: 'NIO Inc ADR', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'XPEV', name: 'XPeng Inc ADR', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'LI', name: 'Li Auto Inc ADR', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'PSNY', name: 'Polestar Automotive', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: 'BYDDY', name: 'BYD Co ADR (1211.HK)', sector: 'PURE', last: null, pct: null, vol: null },
  { sym: '300750.SZ', name: 'CATL Energy (Contemporary Amperex)', sector: 'BATT', last: null, pct: null, vol: null },
  { sym: '3931.HK', name: 'CALB Group (China Amperex)', sector: 'BATT', last: null, pct: null, vol: null },
  { sym: 'PCRFY', name: 'Panasonic Energy ADR', sector: 'BATT', last: null, pct: null, vol: null },
  { sym: '373220.KS', name: 'LG Energy Solution', sector: 'BATT', last: null, pct: null, vol: null },
  { sym: 'ALB', name: 'Albemarle (lithium)', sector: 'BATT', last: null, pct: null, vol: null },
];

/* ---------------- event bus ---------------- */

const listeners = {};

export const bus = {
  on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
  emit(event, payload) { (listeners[event] || []).forEach(fn => fn(payload)); },
};

/* ---------------- universe state ---------------- */

export let universe = [];

export const BYSYM = {};

const TRACKER_KEY = 'evt-trackers-v1';
const removedSyms = new Set();
let addedTrackers = [];

/** Reject corrupted/untrusted tracker seeds read back from localStorage. */
function validTrackerSeed(a) {
  return !!a && typeof a === 'object' &&
    typeof a.sym === 'string' && isValidSymbol(a.sym) &&
    typeof a.name === 'string' && a.name.length <= 60 &&
    (a.sector === 'PURE' || a.sector === 'BATT') &&
    Number.isFinite(a.last) && a.last > 0 && a.last < 1e7 &&
    Number.isFinite(a.pct) && a.pct >= -95 && a.pct <= 95 &&
    Number.isFinite(a.vol) && a.vol > 0;
}

export function initTracker(t) {
  t.hist = null;
  t.loading = false;
  const priced = Number.isFinite(t.last) && t.last > 0;
  if (!priced) t.last = null;
  if (!Number.isFinite(t.pct)) t.pct = null;
  t.chg = Number.isFinite(t.chg)
    ? t.chg
    : (priced && Number.isFinite(t.pct) ? t.last * t.pct / (100 + t.pct) : null);
  if (!Number.isFinite(t.vol)) t.vol = null;
  t.r52 = t.r52 || (priced ? [t.last * 0.6, t.last * 1.4] : null);
}

export function finalizeFromHistory(t) {
  const H = t.hist;
  const prev = H[H.length - 2].c;
  t.prevClose = prev;
  t.last = H[H.length - 1].c;
  t.chg = t.last - prev;
  t.pct = t.chg / prev * 100;
  const lo = Math.min(...H.map(s => s.l));
  const hi = Math.max(...H.map(s => s.h));
  t.r52 = [lo * 0.95, hi * 1.05];
}

export function rebuildBySym() {
  for (const k in BYSYM) delete BYSYM[k];
  universe.forEach(t => { BYSYM[t.sym] = t; });
}

export function getTracker(sym) {
  return BYSYM[sym] || null;
}

export function saveTrackers() {
  try {
    localStorage.setItem(TRACKER_KEY, JSON.stringify({ removed: [...removedSyms], added: addedTrackers }));
  } catch (e) { /* storage unavailable — session-only trackers */ }
}

function restoreTrackers() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(TRACKER_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || !Array.isArray(saved.removed) || !Array.isArray(saved.added)) {
    try { localStorage.removeItem(TRACKER_KEY); } catch (e) { /* ignore */ }
    removedSyms.clear();
    addedTrackers = [];
    return;                                        // corrupted record → clean reset
  }
  saved.removed.forEach(x => {
    if (typeof x === 'string' && isValidSymbol(x)) removedSyms.add(x.toUpperCase());
  });
  universe = universe.filter(t => !removedSyms.has(t.sym));
  saved.added.forEach(a => {
    if (!validTrackerSeed(a)) return;              // drop malformed entries
    if (universe.some(t => t.sym === a.sym)) return;
    const t = Object.assign({}, a);
    initTracker(t);
    universe.push(t);
    addedTrackers.push(Object.assign({}, a));
  });
}

/** Boot: seed the universe, apply persisted customizations, build the index. */
export function initUniverse() {
  universe = DEFAULT_UNIVERSE.map(t => Object.assign({}, t));
  universe.forEach(initTracker);
  restoreTrackers();
  rebuildBySym();
}

export function addTrackerRecord(t) {
  universe.push(t);
  addedTrackers.push({ sym: t.sym, name: t.name, sector: t.sector, last: t.last, pct: t.pct, vol: t.vol });
  removedSyms.delete(t.sym);
  saveTrackers();
  rebuildBySym();
}

export function removeTrackerRecord(sym) {
  universe = universe.filter(t => t.sym !== sym);
  removedSyms.add(sym);
  addedTrackers = addedTrackers.filter(a => a.sym !== sym);
  saveTrackers();
  rebuildBySym();
}

export function resetTrackers() {
  try { localStorage.removeItem(TRACKER_KEY); } catch (e) { /* ignore */ }
  removedSyms.clear();
  addedTrackers = [];
  universe = DEFAULT_UNIVERSE.map(t => Object.assign({}, t));
  universe.forEach(initTracker);
  rebuildBySym();
}

/* ---------------- chart & connection state ---------------- */

export const chartState = { focus: 'TSLA', cross: 59, pinned: null };

export const connection = {
  live: false,
  restOk: false,
  wsOk: false,
  provider: 'demo',
  distributionMode: 'local',      // resolved from GET /api/config at boot
  dataMode: 'simulated',          // 'simulated' | 'eod' | 'realtime' (GET /api/config)
  simulated: true,                // simulated engine OR public distribution mode
  tradingEnabled: false,          // resolved from GET /api/config (public mode → false)
  dataSrc: 'US demo ref',
};

/** Merge connection patches, derive derived flags, notify subscribers. */
export function setConnection(patch) {
  Object.assign(connection, patch);
  connection.live = connection.wsOk || connection.restOk;
  // Simulated engine = the demo provider itself, OR a public distribution
  // where vendor integrations are disabled at the config layer.
  connection.simulated = connection.distributionMode === 'public'
    || connection.dataMode === 'simulated'
    || connection.provider === 'demo';
  connection.dataSrc = connection.live
    ? (connection.simulated ? 'simulated feed'
      : connection.dataMode === 'eod' ? 'EOD · previous close'
        : connection.provider + ' feed')
    : 'US demo ref';
  bus.emit('connection');
}

/** Compact data-state label for tickers, tape and panel metadata. */
export function stateLabel() {
  if (connection.dataMode === 'eod') return 'EOD';
  if (connection.simulated) return 'SIM';
  return connection.live ? 'LIVE' : 'CLOSED';
}

/* ---------------- tick fan-out ---------------- */

/** Apply a live tick to a tracker; returns true when a tracked symbol was hit. */
export function applyTick(m) {
  const t = BYSYM[m.symbol];
  if (!t) return false;
  if (Number.isFinite(m.price) && m.price > 0) t.last = m.price;
  if (Number.isFinite(m.change)) {
    t.chg = m.change;
    t.pct = Number.isFinite(m.percentChange) ? m.percentChange : t.pct;
  } else if (Number.isFinite(m.percentChange)) {
    t.pct = m.percentChange;
  }
  if (Number.isFinite(m.volume) && m.volume > 0) t.vol = m.volume > 5000 ? m.volume / 1e6 : m.volume;
  if (t.hist && t.hist.length) {
    const lastBar = t.hist[t.hist.length - 1];
    lastBar.c = t.last;
    lastBar.h = Math.max(lastBar.h, t.last);
    lastBar.l = Math.min(lastBar.l, t.last);
  }
  return true;
}
