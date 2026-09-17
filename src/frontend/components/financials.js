/**
 * financials.js — fundamentals card: KPI overview, income statement,
 * margins & deliveries. Fetches via the API layer with per-symbol caching.
 */
import { BYSYM } from '../services/store.js';
import { API_BASE, fetchJson } from '../services/api.js';
import { $, fnum, fmtBig, fmtPctV, fmtDeliveries, CLS } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

const financialsCache = {};
/** Growth is fetched lazily per symbol (only when the Growth view opens). */
const growthCache = {};
let growthPending = null;
let incomeView = 'q';
let activeTab = 'ov';
let activeSym = null;
let pendingSym = null;

function kpiHtml(label, value, sub, cls) {
  return `<div class="kpi"><div class="l">${label}</div><div class="v ${cls || ''}">${value}</div><div class="s">${sub || ''}</div></div>`;
}

function marginBar(v) {
  if (v == null || !isFinite(v)) return '—';
  const w = Math.min(Math.abs(v) * 100, 100) / 2;
  return `<div class="bar-m"><i class="${v < 0 ? 'neg' : ''}" style="width:${w}%"></i></div>`;
}

/**
 * Renders a quarter-by-quarter statement matrix: one column per quarter
 * (newest first), one row per metric. Missing values use the app's `—`
 * convention; signs are preserved as provided by the backend.
 */
function seriesTable(rows, metrics) {
  const head = `<tr><th>METRIC</th>${rows.map(r => `<th>${esc(r.label || '—')}</th>`).join('')}</tr>`;
  const body = metrics.map(m => `<tr><td class="lbl">${m.label}</td>` +
    rows.map(r => {
      const v = r[m.key];
      const cls = m.signed && Number.isFinite(v) ? CLS(v) : '';
      return `<td class="${cls}">${fmtBig(v)}</td>`;
    }).join('') + '</tr>').join('');
  return `<table class="fin">${head}${body}</table>`;
}

const BALANCE_METRICS = [
  { key: 'cashAndEquivalents', label: 'Cash &amp; Equivalents' },
  { key: 'shortTermInvestments', label: 'Short-Term Investments' },
  { key: 'cashAndShortTermInvestments', label: 'Cash + STI' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'currentAssets', label: 'Current Assets' },
  { key: 'totalAssets', label: 'Total Assets' },
  { key: 'currentLiabilities', label: 'Current Liabilities' },
  { key: 'totalLiabilities', label: 'Total Liabilities' },
  { key: 'stockholdersEquity', label: "Stockholders' Equity" },
  { key: 'totalDebt', label: 'Total Debt' },
  { key: 'netDebt', label: 'Net Debt', signed: true },
];

const CASHFLOW_METRICS = [
  { key: 'operatingCashFlow', label: 'Operating Cash Flow', signed: true },
  { key: 'capitalExpenditure', label: 'Capital Expenditure', signed: true },
  { key: 'freeCashFlow', label: 'Free Cash Flow', signed: true },
  { key: 'investingCashFlow', label: 'Investing Cash Flow', signed: true },
  { key: 'financingCashFlow', label: 'Financing Cash Flow', signed: true },
  { key: 'netChangeInCash', label: 'Net Change in Cash', signed: true },
  { key: 'cashAtEndOfPeriod', label: 'Cash at End of Period' },
];

const GROWTH_METRICS = [
  { key: 'revenueGrowth', label: 'Revenue Growth' },
  { key: 'grossProfitGrowth', label: 'Gross Profit Growth' },
  { key: 'operatingIncomeGrowth', label: 'Operating Income Growth' },
  { key: 'netIncomeGrowth', label: 'Net Income Growth' },
  { key: 'epsGrowth', label: 'EPS Growth' },
];

/** Growth percentages: zero stays neutral (`0.0%`), missing values use `—`,
 *  signs are preserved otherwise. */
const fmtGrowth = v => (v == null || !isFinite(v) ? '—' : v === 0 ? '0.0%' : (v > 0 ? '+' : '−') + (Math.abs(v) * 100).toFixed(1) + '%');

/** Reported growth matrix: rows are metrics, columns are quarters. */
function growthTable(rows) {
  const head = `<tr><th>METRIC</th>${rows.map(r => `<th>${esc(r.label || '—')}</th>`).join('')}</tr>`;
  const body = GROWTH_METRICS.map(m => `<tr><td class="lbl">${m.label}</td>` +
    rows.map(r => {
      const v = r[m.key];
      const cls = Number.isFinite(v) ? CLS(v) : '';
      return `<td class="${cls}">${fmtGrowth(v)}</td>`;
    }).join('') + '</tr>').join('');
  return `<table class="fin">${head}${body}</table>`;
}

function fetchFinancials(sym) {
  if (pendingSym === sym) return;
  pendingSym = sym;
  fetchJson(`${API_BASE}/api/financials/${encodeURIComponent(sym)}`)
    .then(data => { financialsCache[sym] = data; })
    .catch(() => { financialsCache[sym] = { error: true }; })
    .finally(() => {
      pendingSym = null;
      if (activeSym === sym) draw(financialsCache[sym]);
    });
}

/** Lazy growth fetch — one request per symbol per session; the response is
 *  only drawn if the Growth tab is still showing the same symbol (guards
 *  against slow responses for a previously selected symbol). */
function fetchGrowth(sym) {
  if (growthPending === sym) return;
  growthPending = sym;
  fetchJson(`${API_BASE}/api/financials/${encodeURIComponent(sym)}/growth`)
    .then(data => { growthCache[sym] = data; })
    .catch(() => { growthCache[sym] = { error: true }; })
    .finally(() => {
      growthPending = null;
      if (activeSym === sym && activeTab === 'gr' && financialsCache[sym]) draw(financialsCache[sym]);
    });
}

function draw(d) {
  const body = $('fin-body');
  if (!d || d.error) {
    body.innerHTML = '<div class="fin-hint">fundamentals unavailable for this symbol</div>';
    return;
  }
  const unit = d.deliveryUnit || 'vehicles';
  const deliveries = d.deliveriesSim || { quarterly: null, annual: null, yoY: null, unit };
  const deliveryUnit = deliveries.unit || unit;
  const mode = d.financialsMode === 'real' ? 'REAL' : 'MODELED';
  $('fin-meta').innerHTML = `<b>${esc((d.provider || 'demo').toUpperCase())}</b> · ${mode}` + (d.asOf ? ' · ' + esc(d.asOf) : '');
  $('fin-asof').textContent = 'as-of ' + (d.asOf || '—');
  const note = d.note ? `<div class="fin-hint">${esc(d.note)}</div>` : '';
  if (activeTab === 'ov') {
    body.innerHTML = `${note}
      <div class="kpis">
        ${kpiHtml('MARKET CAP', fmtBig(d.marketCap), BYSYM[activeSym] ? activeSym : '')}
        ${kpiHtml('P/E (TTM)', d.peTTM == null ? '—' : fnum(d.peTTM, 1), d.peTTM == null ? 'not profitable (TTM)' : 'trailing twelve months', d.peTTM != null && d.peTTM < 0 ? 'down' : '')}
        ${kpiHtml('EV / SALES', d.evSales == null ? '—' : fnum(d.evSales, 2) + '×', 'enterprise value / revenue')}
        ${kpiHtml('FREE CASH FLOW', fmtBig(d.fcfTTM), 'TTM', d.fcfTTM != null && d.fcfTTM < 0 ? 'down' : '')}
        ${kpiHtml('GROSS MARGIN', fmtPctV(d.grossMargin), 'TTM')}
      </div>
      <table class="fin">
        <tr><td class="lbl">Total Revenue (TTM)</td><td>${fmtBig(d.revenueTTM)}</td><td class="lbl">Cash &amp; Short-Term Investments</td><td>${fmtBig(d.cashSTI)}</td></tr>
        <tr><td class="lbl">Net Income (TTM)</td><td class="${CLS(d.netIncomeTTM || 0)}">${fmtBig(d.netIncomeTTM)}</td><td class="lbl">Net Margin</td><td>${fmtPctV(d.netMargin)}</td></tr>
        <tr><td class="lbl">R&amp;D Spend (TTM)</td><td>${fmtBig(d.rdSpendTTM)}</td><td class="lbl">Deliveries (Q / YoY · modeled)</td><td>${fmtDeliveries(deliveries.quarterly, deliveryUnit)} · ${fmtPctV(deliveries.yoY == null ? null : deliveries.yoY / 100)}</td></tr>
      </table>`;
  } else if (activeTab === 'is') {
    const quarterly = Array.isArray(d.history) ? d.history : [];
    const annualRows = Array.isArray(d.annual) ? d.annual : [];
    const rows = incomeView === 'a' ? annualRows : quarterly;
    const toggle = `<div class="fin-toggle">
        <button class="ftab${incomeView === 'q' ? ' on' : ''}" data-inc="q">QUARTERLY</button>
        <button class="ftab${incomeView === 'a' ? ' on' : ''}" data-inc="a">ANNUAL</button>
      </div>`;
    if (!rows.length) {
      body.innerHTML = `${note}${toggle}<div class="fin-hint">no statement history available</div>`;
      return;
    }
    const ttmRow = incomeView === 'q'
      ? `<tr><td class="lbl"><b>TTM</b></td><td><b>${fmtBig(d.revenueTTM)}</b></td><td class="${CLS(d.netIncomeTTM || 0)}"><b>${fmtBig(d.netIncomeTTM)}</b></td><td><b>${fmtBig(d.rdSpendTTM)}</b></td><td>${marginBar(d.netMargin)}</td></tr>`
      : '';
    body.innerHTML = `${note}${toggle}
      <table class="fin">
        <tr><th>PERIOD</th><th>TOTAL REVENUE</th><th>NET INCOME</th><th>R&amp;D SPEND</th><th>GROSS MARGIN TREND</th></tr>
        ${rows.map(h => `<tr><td class="lbl">${esc(h.label)}</td><td>${fmtBig(h.revenue)}</td><td class="${CLS(h.netIncome || 0)}">${fmtBig(h.netIncome)}</td><td>${fmtBig(h.rd)}</td><td>${marginBar(h.revenue ? (h.netIncome || 0) / h.revenue : null)}</td></tr>`).join('')}
        ${ttmRow}
      </table>`;
  } else if (activeTab === 'bs') {
    const series = Array.isArray(d.balanceHistory) ? d.balanceHistory : [];
    if (!series.length) {
      body.innerHTML = `${note}<div class="fin-hint">balance sheet data unavailable for this symbol</div>`;
      return;
    }
    const l = series[0];
    body.innerHTML = `${note}
      <div class="kpis">
        ${kpiHtml('CASH + STI', fmtBig(l.cashAndShortTermInvestments), 'latest quarter')}
        ${kpiHtml('TOTAL ASSETS', fmtBig(l.totalAssets), 'latest quarter')}
        ${kpiHtml('TOTAL DEBT', fmtBig(l.totalDebt), 'latest quarter')}
        ${kpiHtml('NET DEBT', fmtBig(l.netDebt), 'latest quarter', Number.isFinite(l.netDebt) && l.netDebt < 0 ? 'up' : '')}
      </div>
      ${seriesTable(series, BALANCE_METRICS)}`;
  } else if (activeTab === 'cf') {
    const series = Array.isArray(d.cashFlowHistory) ? d.cashFlowHistory : [];
    if (!series.length) {
      body.innerHTML = `${note}<div class="fin-hint">cash flow data unavailable for this symbol</div>`;
      return;
    }
    const l = series[0];
    body.innerHTML = `${note}
      <div class="kpis">
        ${kpiHtml('OPERATING CASH FLOW', fmtBig(l.operatingCashFlow), 'latest quarter', Number.isFinite(l.operatingCashFlow) && l.operatingCashFlow < 0 ? 'down' : 'up')}
        ${kpiHtml('CAPEX', fmtBig(l.capitalExpenditure), 'latest quarter (reported sign)')}
        ${kpiHtml('FREE CASH FLOW', fmtBig(l.freeCashFlow), 'latest quarter', Number.isFinite(l.freeCashFlow) && l.freeCashFlow < 0 ? 'down' : 'up')}
      </div>
      ${seriesTable(series, CASHFLOW_METRICS)}`;
  } else if (activeTab === 'gr') {
    const g = growthCache[d.symbol];
    if (!g) {
      body.innerHTML = `${note}<div class="fin-hint">Loading growth data…</div>`;
      fetchGrowth(d.symbol);
      return;
    }
    if (g.error) {
      body.innerHTML = `${note}<div class="fin-hint">Growth data unavailable — request failed.</div>`;
      return;
    }
    const series = Array.isArray(g.growthHistory) ? g.growthHistory : [];
    if (g.growthMode !== 'real' || !series.length) {
      body.innerHTML = `${note}<div class="fin-hint">${esc(g.note || 'Growth data unavailable for this symbol.')}</div>`;
      return;
    }
    const l = series[0];
    const gcls = v => (Number.isFinite(v) ? CLS(v) : '');
    body.innerHTML = `${note}${g.stale ? '<div class="fin-hint">showing last known growth data — refresh pending</div>' : ''}
      <div class="kpis">
        ${kpiHtml('REVENUE GROWTH', fmtGrowth(l.revenueGrowth), 'reported growth', gcls(l.revenueGrowth))}
        ${kpiHtml('OPERATING INCOME GROWTH', fmtGrowth(l.operatingIncomeGrowth), 'reported growth', gcls(l.operatingIncomeGrowth))}
        ${kpiHtml('EPS GROWTH', fmtGrowth(l.epsGrowth), 'reported growth', gcls(l.epsGrowth))}
      </div>
      <div class="fin-hint">Reported growth as provided by the data provider; the percentage basis is the provider's reported growth measure, not a computed year-over-year comparison.</div>
      ${growthTable(series)}`;
  } else {
    body.innerHTML = `${note}
      <div class="kpis">
        ${kpiHtml('GROSS MARGIN', fmtPctV(d.grossMargin), 'TTM')}
        ${kpiHtml('NET MARGIN', fmtPctV(d.netMargin), 'TTM')}
        ${kpiHtml('DELIVERIES / ' + (deliveryUnit === 'GWh' ? 'SHIPPED (Q)' : 'DELIVERED (Q)'), fmtDeliveries(deliveries.quarterly, deliveryUnit), 'modeled estimate')}
        ${kpiHtml('ANNUAL RUN-RATE', fmtDeliveries(deliveries.annual, deliveryUnit), 'modeled run-rate')}
        ${kpiHtml('YoY GROWTH', fmtPctV(deliveries.yoY == null ? null : deliveries.yoY / 100), 'modeled, year over year', deliveries.yoY != null && deliveries.yoY < 0 ? 'down' : 'up')}
      </div>
      <table class="fin">
        <tr><th>METRIC</th><th>VALUE</th><th>TREND</th></tr>
        <tr><td class="lbl">Gross Margin</td><td>${fmtPctV(d.grossMargin)}</td><td>${marginBar(d.grossMargin)}</td></tr>
        <tr><td class="lbl">Net Margin</td><td>${fmtPctV(d.netMargin)}</td><td>${marginBar(d.netMargin)}</td></tr>
        <tr><td class="lbl">Deliveries (Quarterly, ${deliveryUnit})</td><td>${fmtDeliveries(deliveries.quarterly, deliveryUnit)}</td><td>${marginBar(deliveries.yoY != null ? deliveries.yoY / 100 : null)}</td></tr>
        <tr><td class="lbl">Deliveries (Annualized, ${deliveryUnit})</td><td>${fmtDeliveries(deliveries.annual, deliveryUnit)}</td><td>${marginBar(deliveries.yoY != null ? deliveries.yoY / 100 : null)}</td></tr>
        <tr><td class="lbl">Deliveries YoY Growth</td><td class="${CLS(deliveries.yoY || 0)}">${fmtPctV(deliveries.yoY == null ? null : deliveries.yoY / 100)}</td><td>${marginBar(deliveries.yoY != null ? deliveries.yoY / 100 : null)}</td></tr>
      </table>
      ${d.deliveriesNote ? `<div class="fin-hint" style="padding:6px 2px 0">${esc(d.deliveriesNote)}</div>` : ''}`;
  }
}

export function renderFinancials(sym) {
  activeSym = sym;
  $('fin-title').textContent = 'FINANCIALS — ' + sym;
  if (!BYSYM[sym]) { $('fin-body').innerHTML = '<div class="fin-hint">unknown symbol</div>'; return; }
  const cached = financialsCache[sym];
  if (!cached) {
    $('fin-body').innerHTML = `<div class="fin-hint">loading fundamentals for ${sym} …</div>`;
    fetchFinancials(sym);
    return;
  }
  draw(cached);
}

export function initFinancials() {
  $('fin-tabs').addEventListener('click', e => {
    const b = e.target.closest('.ftab');
    if (!b) return;
    activeTab = b.dataset.tab;
    document.querySelectorAll('#fin-tabs .ftab').forEach(x => x.classList.toggle('on', x === b));
    if (activeSym) renderFinancials(activeSym);
  });
  $('fin-body').addEventListener('click', e => {
    const b = e.target.closest('[data-inc]');
    if (!b || b.dataset.inc === incomeView) return;
    incomeView = b.dataset.inc;
    if (activeSym && financialsCache[activeSym]) draw(financialsCache[activeSym]);
  });
}
