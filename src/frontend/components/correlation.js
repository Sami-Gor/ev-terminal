/**
 * correlation.js — EV supply-chain vs commodity correlation matrix.
 * 30-session returns-based Pearson r, auto-refreshed every minute.
 */
import { getTracker } from '../services/store.js';
import { API_BASE, fetchJson } from '../services/api.js';
import { pearson, returnsN } from '../utils/indicators.js';
import { upRgb, downRgb } from '../utils/theme.js';
import { $ } from '../utils/format.js';

const EV_SYMBOLS = ['TSLA', 'RIVN', 'NIO', 'BYDDY'];
const COMMODITIES = [
  { sym: 'ALB', label: 'ALB · LITHIUM' },
  { sym: 'NICK', label: 'NICKEL LME' },
  { sym: 'WTI', label: 'WTI CRUDE' },
];
const CACHE_TTL_MS = 300000;

const seriesCache = {};

function closesFor(sym) {
  const t = getTracker(sym);
  if (t && t.hist && t.hist.length) return t.hist.map(b => b.c);
  const cached = seriesCache[sym];
  return cached && Date.now() - cached.ts < CACHE_TTL_MS ? cached.closes : null;
}

function returnsFor(sym) {
  const closes = closesFor(sym);
  return closes && closes.length > 10 ? returnsN(closes, 30) : null;
}

function fetchMissing() {
  [...EV_SYMBOLS, ...COMMODITIES.map(c => c.sym)].forEach(sym => {
    if (getTracker(sym) && getTracker(sym).hist && getTracker(sym).hist.length) return;
    const cached = seriesCache[sym];
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return;
    fetchJson(`${API_BASE}/api/history/${encodeURIComponent(sym)}`)
      .then(data => {
        seriesCache[sym] = { ts: Date.now(), closes: (data.bars || []).map(b => b.c) };
        render();
      })
      .catch(err => {
        seriesCache[sym] = { ts: Date.now(), closes: [], failed: String(err.message || 'fetch failed') };
        render();
      });
  });
}

export function render() {
  const body = $('corr-body');
  if (!body) return;
  const returnsFor = sym => {
    const closes = closesFor(sym);
    return closes && closes.length > 10 ? returnsN(closes, 30) : null;
  };
  let anyData = false;
  let html = `<table class="fin"><tr><th>EV STOCK \ COMMODITY</th>${COMMODITIES.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
  for (const ev of EV_SYMBOLS) {
    html += `<tr><td class="lbl"><b>${ev}</b></td>`;
    const evReturns = returnsFor(ev);
    for (const commodity of COMMODITIES) {
      const commodityReturns = returnsFor(commodity.sym);
      const r = (evReturns && commodityReturns) ? pearson(evReturns, commodityReturns) : null;
      if (r == null) { html += `<td style="color:var(--dim2);font-weight:400">—</td>`; continue; }
      anyData = true;
      const intensity = Math.min(Math.abs(r), 1);
      const rgb = r > 0.6 ? upRgb() : r < -0.6 ? downRgb() : '110,118,129';
      const bg = `rgba(${rgb},${(0.1 + intensity * 0.45).toFixed(2)})`;
      const color = r > 0.6 ? 'var(--green)' : r < -0.6 ? 'var(--red)' : '#98a2ad';
      html += `<td style="background:${bg}"><span style="color:${color}">${(r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2)}</span></td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  if (!anyData && EV_SYMBOLS.some(ev => !returnsFor(ev))) {
    html = '<div class="fin-hint">loading correlation series (30 sessions per symbol)…</div>';
  }
  body.innerHTML = html;
  const windowLabel = $('corr-window');
  if (windowLabel) windowLabel.textContent = 'window: last 30 sessions';
}

export function initCorrelation() {
  fetchMissing();
  render();
  setInterval(() => { fetchMissing(); render(); }, 60000);
}
