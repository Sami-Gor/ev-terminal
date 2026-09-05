/**
 * store.js — central data models & state (UPPER_SNAKE_CASE data constants,
 * camelCase accessors). Modules never reach into each other's internals;
 * they import this store and communicate via the event bus.
 */

/* ---------------- market data models ---------------- */

export const SECTORS = {
  PURE: { label: 'PURE-PLAY EV', color: '#00C176' },
  BATT: { label: 'BATTERY & TECH', color: '#58A6FF' },
};

export const DEFAULT_UNIVERSE = [
  { sym: 'TSLA', name: 'Tesla Inc', sector: 'PURE', last: 245.10, pct: 1.84, vol: 88.4 },
  { sym: 'RIVN', name: 'Rivian Automotive', sector: 'PURE', last: 14.87, pct: -2.31, vol: 28.9 },
  { sym: 'LCID', name: 'Lucid Group', sector: 'PURE', last: 2.41, pct: -3.05, vol: 41.2 },
  { sym: 'NIO', name: 'NIO Inc ADR', sector: 'PURE', last: 5.12, pct: 2.72, vol: 33.6 },
  { sym: 'XPEV', name: 'XPeng Inc ADR', sector: 'PURE', last: 21.36, pct: 3.41, vol: 19.8 },
  { sym: 'LI', name: 'Li Auto Inc ADR', sector: 'PURE', last: 29.84, pct: 1.22, vol: 12.4 },
  { sym: 'PSNY', name: 'Polestar Automotive', sector: 'PURE', last: 1.18, pct: -1.69, vol: 3.1 },
  { sym: 'BYDDY', name: 'BYD Co ADR (1211.HK)', sector: 'PURE', last: 58.64, pct: 1.46, vol: 4.2 },
  { sym: '300750.SZ', name: 'CATL Energy (Contemporary Amperex)', sector: 'BATT', last: 262.40, pct: 2.11, vol: 6.8 },
  { sym: '3931.HK', name: 'CALB Group (China Amperex)', sector: 'BATT', last: 41.86, pct: 1.37, vol: 3.3 },
  { sym: 'PCRFY', name: 'Panasonic Energy ADR', sector: 'BATT', last: 11.27, pct: 0.94, vol: 0.8 },
  { sym: '373220.KS', name: 'LG Energy Solution', sector: 'BATT', last: 214.60, pct: -0.82, vol: 1.5 },
  { sym: 'ALB', name: 'Albemarle (lithium)', sector: 'BATT', last: 86.43, pct: 2.15, vol: 3.4 },
];

export const MACRO = [
  { sym: 'SPX', name: 'S&P 500', last: 6412.08, pct: 0.34, state: 'CLOSED', src: 'S&P DJI', tz: 'America/New_York', reg: 'AMERICAS' },
  { sym: 'IXIC', name: 'NASDAQ Comp', last: 21155.40, pct: 0.48, state: 'CLOSED', src: 'Nasdaq', tz: 'America/New_York', reg: 'AMERICAS' },
  { sym: 'DJI', name: 'Dow Jones', last: 44938.51, pct: -0.11, state: 'CLOSED', src: 'S&P DJI', tz: 'America/New_York', reg: 'AMERICAS' },
  { sym: 'STOXX50E', name: 'STOXX 50', last: 5402.77, pct: 0.19, state: 'CLOSED', src: 'STOXX', tz: 'Europe/London', reg: 'EUROPE' },
  { sym: 'FTSE', name: 'FTSE 100', last: 9104.62, pct: -0.16, state: 'CLOSED', src: 'FTSE', tz: 'Europe/London', reg: 'EUROPE' },
  { sym: 'DAX', name: 'DAX 40', last: 24318.90, pct: 0.27, state: 'CLOSED', src: 'Deutsche Börse', tz: 'Europe/Berlin', reg: 'EUROPE' },
  { sym: 'N225', name: 'Nikkei 225', last: 41512.06, pct: 0.76, state: 'CLOSED', src: 'Nikkei', tz: 'Asia/Tokyo', reg: 'APAC' },
  { sym: 'HSI', name: 'Hang Seng', last: 25466.18, pct: 1.04, state: 'CLOSED', src: 'HSI Ltd', tz: 'Asia/Hong_Kong', reg: 'APAC' },
  { sym: 'SSE', name: 'SSE Composite', last: 3624.85, pct: 0.29, state: 'CLOSED', src: 'SSE', tz: 'Asia/Shanghai', reg: 'APAC' },
  { sym: 'NICK', name: 'Nickel LME', last: 16540, pct: 1.29, state: 'OPEN', src: 'DEMO desk', tz: 'America/New_York', reg: 'BATT METALS', dec: 0 },
  { sym: 'COPR', name: 'Copper LME', last: 10235, pct: 0.84, state: 'OPEN', src: 'DEMO desk', tz: 'America/New_York', reg: 'BATT METALS', dec: 0 },
];

export const AS_OF_SHORT = '2026-09-04';

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

const SYM_RE = /^[A-Z0-9.\-^]{1,10}$/;

/** Reject corrupted/untrusted tracker seeds read back from localStorage. */
function validTrackerSeed(a) {
  return !!a && typeof a === 'object' &&
    typeof a.sym === 'string' && SYM_RE.test(a.sym) &&
    typeof a.name === 'string' && a.name.length <= 60 &&
    (a.sector === 'PURE' || a.sector === 'BATT') &&
    Number.isFinite(a.last) && a.last > 0 && a.last < 1e7 &&
    Number.isFinite(a.pct) && a.pct >= -95 && a.pct <= 95 &&
    Number.isFinite(a.vol) && a.vol > 0;
}

export function initTracker(t) {
  t.hist = null;
  t.loading = false;
  t.chg = t.chg !== undefined ? t.chg : t.last * t.pct / (100 + t.pct);
  t.vol = t.vol !== undefined ? t.vol : 5.0;
  t.r52 = t.r52 || [t.last * 0.6, t.last * 1.4];
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
    if (typeof x === 'string' && SYM_RE.test(x)) removedSyms.add(x.toUpperCase());
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
  dataSrc: 'US demo ref',
};

/** Merge connection patches, derive derived flags, notify subscribers. */
export function setConnection(patch) {
  Object.assign(connection, patch);
  connection.live = connection.wsOk || connection.restOk;
  connection.dataSrc = connection.live
    ? (connection.provider === 'demo' ? 'server sim feed' : connection.provider + ' feed')
    : 'US demo ref';
  bus.emit('connection');
}

/* ---------------- tick fan-out ---------------- */

const dirtySymbols = new Set();

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

export function markDirty(sym) {
  dirtySymbols.add(sym);
}

export function takeDirty() {
  const ds = [...dirtySymbols];
  dirtySymbols.clear();
  return ds;
}
