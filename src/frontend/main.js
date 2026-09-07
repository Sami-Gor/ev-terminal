/**
 * main.js — boot orchestrator & wiring.
 *
 * Execution order (deterministic):
 *   1. Constants & data models      → store.initUniverse()
 *   2. Static UI render init        → tape / ticker / heatmap / sector / news / journal
 *   3. Network service layer        → wsConnect() + staggered history & quote loads
 *   4. Focus & analytics cards      → setFocus() (chart + financials)
 *   5. Event listeners              → chart controls, trackers, alerts, layout, clock, bus
 */
import {
  initUniverse, rebuildBySym, getTracker, universe,
  chartState, bus,
} from './services/store.js';
import { scheduleInitialLoads, ensureHistory } from './services/api.js';
import { wsConnect, wsSubscribe, wsUnsubscribe, onTick as onTickMessage } from './services/ws-client.js';
import { bufferTick, setRenderHandlers } from './services/render-scheduler.js';
import { applyTheme, toggleHighContrast } from './utils/theme.js';

import { setBadgeState } from './components/connection-indicator.js';
import { $ } from './utils/format.js';
import * as tape from './components/tape.js';
import * as tickerTable from './components/ticker-table.js';
import * as heatmap from './components/heatmap.js';
import * as sector from './components/sector.js';
import * as news from './components/news.js';
import * as clock from './components/clock.js';
import * as focusChart from './components/focus-chart.js';
import * as financials from './components/financials.js';
import * as journal from './components/journal.js';
import * as correlation from './components/correlation.js';
import * as alerts from './components/alerts.js';
import * as trackers from './components/trackers.js';
import { initLayout, applyLayout } from './components/layout-manager.js';

/* ---- boot (wrapped: a failed init reports to the DOM instead of dying) ---- */
function boot() {
/* ---- 1. data models & state ---- */
initUniverse();
applyTheme();

/* ---- 2. static UI render init ---- */
tape.renderTape();
tickerTable.renderTickerTable();
heatmap.initHeatmap();
sector.renderSector();
news.initNews();
journal.initJournal();
setBadgeState();

/* ---- 3. network service layer ---- */
wsConnect();
scheduleInitialLoads(universe);

/* ---- 4. focus & analytics cards ---- */
setFocus(chartState.focus);
initLayout();                   // needs rendered panels; re-applies persisted order
trackers.initTrackers();        // inserts ± tools into rendered card headers
focusChart.initChartControls();
alerts.initAlerts();
correlation.initCorrelation();
clock.initClock();

/* ---- 5. event listeners & orchestration ---- */
$('hc-toggle').addEventListener('click', () => {
  toggleHighContrast();
  focusChart.renderChart();        // SVG colors are baked at draw time
  heatmap.renderHeatmap();
  sector.renderSector();
  correlation.render();
});
}

/** Boot diagnostics: a failed init surfaces in the DOM instead of a dead page. */
function reportBootError(e) {
  const div = document.createElement('div');
  div.id = 'boot-err';
  div.style.cssText = 'position:fixed;top:0;left:0;z-index:999;background:#D32F2F;color:#fff;padding:6px 10px;font:11px monospace';
  div.textContent = `BOOT ERROR: ${e.message} @ ${(e.stack || '').split('\n')[1] || ''}`;
  document.body.appendChild(div);
}

try {
  boot();
} catch (e) {
  reportBootError(e);
}

/* ---- event listeners & orchestration ---- */
setRenderHandlers({
  light(syms) {                                     // per-frame in-place patches
    tape.updateSymbols(syms);
    tickerTable.updateRows(syms);
    focusChart.applyLiveTick(syms);
  },
  heavy() {                                         // coarse re-renders (500 ms gate)
    heatmap.renderHeatmap();
    sector.renderSector();
  },
});
bus.on('focus', sym => setFocus(sym));
bus.on('universe:changed', () => rerenderAll());
bus.on('history-loaded', sym => fullFlush(sym));
bus.on('quote-loaded', sym => fullFlush(sym));
onTickMessage(symbol => {
  journal.onTick(symbol, getTracker(symbol).last);   // logic layer (no DOM)
  alerts.onTick(symbol);                             // logic layer (no DOM)
  bufferTick(symbol);                                // render layer → rAF flush
});

/* ---- global keyboard bindings ---- */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') {
    const open = ['cards-pop', 'tk-pop', 'alert-pop'].find(id => $(id).classList.contains('open'));
    if (open) {
      $(open).classList.remove('open');
      const trigger = { 'cards-pop': 'cards-btn', 'tk-pop': 'tk-btn', 'alert-pop': 'alert-btn' }[open];
      $(trigger)?.setAttribute('aria-expanded', 'false');
      e.stopImmediatePropagation();              // don't also unpin the chart crosshair
      $(trigger)?.focus();
    }
    return;
  }
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('tk-search').focus();
    $('tk-search').select();
  }
});

function setFocus(sym) {
  if (!getTracker(sym)) return;
  chartState.focus = sym;
  chartState.cross = 59;
  chartState.pinned = null;
  tickerTable.highlightRow(sym);
  focusChart.renderChart();
  financials.renderFinancials(sym);
}

/** Full surface refresh after history/quote loads (full-data events). */
function fullFlush(sym) {
  tape.updateSymbols([sym]);
  tickerTable.updateRows([sym]);
  heatmap.renderHeatmap();
  sector.renderSector();
  journal.resolveAll();
  if (sym === chartState.focus) focusChart.renderChart();
}

/** Full re-render after any tracker mutation (add / remove / reset). */
function rerenderAll() {
  rebuildBySym();
  tape.renderTape();
  tickerTable.renderTickerTable();
  heatmap.renderHeatmap();
  sector.renderSector();
  trackers.renderTrackerPop();
  universe.forEach((t, i) => setTimeout(() => ensureHistory(t), i * 100));
  wsSubscribe(universe.map(t => t.sym));
  if (!getTracker(chartState.focus)) chartState.focus = universe[0] ? universe[0].sym : 'TSLA';
  setFocus(chartState.focus);
  applyLayout();
}

