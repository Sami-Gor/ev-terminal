/**
 * financials.js — fundamentals card: KPI overview, income statement,
 * margins & deliveries. Fetches via the API layer with per-symbol caching.
 */
import { BYSYM } from '../services/store.js';
import { API_BASE, fetchJson } from '../services/api.js';
import { $, fnum, fmtBig, fmtPctV, fmtDeliveries, CLS } from '../utils/format.js';

const financialsCache = {};
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

function draw(d) {
  const body = $('fin-body');
  if (!d || d.error) {
    body.innerHTML = '<div class="fin-hint">fundamentals unavailable for this symbol</div>';
    return;
  }
  const unit = d.deliveryUnit || 'vehicles';
  const deliveries = d.deliveriesSim || { quarterly: null, annual: null, yoY: null, unit };
  const deliveryUnit = deliveries.unit || unit;
  $('fin-meta').innerHTML = `<b>${(d.provider || 'demo').toUpperCase()}</b>` + (d.asOf ? ' · ' + d.asOf : '');
  $('fin-asof').textContent = 'as-of ' + (d.asOf || '—');
  if (activeTab === 'ov') {
    body.innerHTML = `
      <div class="kpis">
        ${kpiHtml('MARKET CAP', fmtBig(d.marketCap), BYSYM[activeSym] ? activeSym : '')}
        ${kpiHtml('P/E (TTM)', d.peTTM == null ? '—' : fnum(d.peTTM, 1), d.peTTM == null ? 'not profitable (TTM)' : 'trailing twelve months', d.peTTM != null && d.peTTM < 0 ? 'down' : '')}
        ${kpiHtml('EV / SALES', d.evSales == null ? '—' : fnum(d.evSales, 2) + '×', 'enterprise value / revenue')}
        ${kpiHtml('FREE CASH FLOW', fmtBig(d.fcfTTM), 'TTM', d.fcfTTM < 0 ? 'down' : 'up')}
        ${kpiHtml('GROSS MARGIN', fmtPctV(d.grossMargin), 'TTM')}
      </div>
      <table class="fin">
        <tr><td class="lbl">Total Revenue (TTM)</td><td>${fmtBig(d.revenueTTM)}</td><td class="lbl">Cash &amp; Short-Term Investments</td><td>${fmtBig(d.cashSTI)}</td></tr>
        <tr><td class="lbl">Net Income (TTM)</td><td class="${CLS(d.netIncomeTTM || 0)}">${fmtBig(d.netIncomeTTM)}</td><td class="lbl">Net Margin</td><td>${fmtPctV(d.netMargin)}</td></tr>
        <tr><td class="lbl">R&amp;D Spend (TTM)</td><td>${fmtBig(d.rdSpendTTM)}</td><td class="lbl">Deliveries (Q / YoY)</td><td>${fmtDeliveries(deliveries.quarterly, deliveryUnit)} · ${fmtPctV(deliveries.yoY == null ? null : deliveries.yoY / 100)}</td></tr>
      </table>`;
  } else if (activeTab === 'is') {
    const history = d.history && d.history.length ? d.history : [];
    if (!history.length) { body.innerHTML = '<div class="fin-hint">no statement history available</div>'; return; }
    const sum = get => history.reduce((s, h) => s + (get(h) || 0), 0);
    body.innerHTML = `
      <table class="fin">
        <tr><th>PERIOD</th><th>TOTAL REVENUE</th><th>NET INCOME</th><th>R&amp;D SPEND</th><th>GROSS MARGIN TREND</th></tr>
        ${history.map(h => `<tr><td class="lbl">${h.label}</td><td>${fmtBig(h.revenue)}</td><td class="${CLS(h.netIncome || 0)}">${fmtBig(h.netIncome)}</td><td>${fmtBig(h.rd)}</td><td>${marginBar(h.revenue ? (h.netIncome || 0) / h.revenue : null)}</td></tr>`).join('')}
        <tr><td class="lbl"><b>TTM</b></td><td><b>${fmtBig(d.revenueTTM != null ? d.revenueTTM : sum(h => h.revenue))}</b></td><td class="${CLS(d.netIncomeTTM || 0)}"><b>${fmtBig(d.netIncomeTTM != null ? d.netIncomeTTM : sum(h => h.netIncome))}</b></td><td><b>${fmtBig(d.rdSpendTTM != null ? d.rdSpendTTM : sum(h => h.rd))}</b></td><td>${marginBar(d.netMargin)}</td></tr>
      </table>`;
  } else {
    body.innerHTML = `
      <div class="kpis">
        ${kpiHtml('GROSS MARGIN', fmtPctV(d.grossMargin), 'TTM')}
        ${kpiHtml('NET MARGIN', fmtPctV(d.netMargin), 'TTM')}
        ${kpiHtml('DELIVERIES / ' + (deliveryUnit === 'GWh' ? 'SHIPPED (Q)' : 'DELIVERED (Q)'), fmtDeliveries(deliveries.quarterly, deliveryUnit), deliveryUnit === 'GWh' ? 'energy capacity shipped' : 'vehicles delivered')}
        ${kpiHtml('ANNUAL RUN-RATE', fmtDeliveries(deliveries.annual, deliveryUnit), 'last 4 quarters')}
        ${kpiHtml('YoY GROWTH', fmtPctV(deliveries.yoY == null ? null : deliveries.yoY / 100), 'year over year', deliveries.yoY != null && deliveries.yoY < 0 ? 'down' : 'up')}
      </div>
      <table class="fin">
        <tr><th>METRIC</th><th>VALUE</th><th>TREND</th></tr>
        <tr><td class="lbl">Gross Margin</td><td>${fmtPctV(d.grossMargin)}</td><td>${marginBar(d.grossMargin)}</td></tr>
        <tr><td class="lbl">Net Margin</td><td>${fmtPctV(d.netMargin)}</td><td>${marginBar(d.netMargin)}</td></tr>
        <tr><td class="lbl">Deliveries (Quarterly, ${deliveryUnit})</td><td>${fmtDeliveries(deliveries.quarterly, deliveryUnit)}</td><td>${marginBar(deliveries.yoY != null ? deliveries.yoY / 100 : null)}</td></tr>
        <tr><td class="lbl">Deliveries (Annualized, ${deliveryUnit})</td><td>${fmtDeliveries(deliveries.annual, deliveryUnit)}</td><td>${marginBar(deliveries.yoY != null ? deliveries.yoY / 100 : null)}</td></tr>
        <tr><td class="lbl">Deliveries YoY Growth</td><td class="${CLS(deliveries.yoY || 0)}">${fmtPctV(deliveries.yoY == null ? null : deliveries.yoY / 100)}</td><td>${marginBar(deliveries.yoY != null ? deliveries.yoY / 100 : null)}</td></tr>
      </table>
      ${d.deliveriesNote ? `<div class="fin-hint" style="padding:6px 2px 0">${d.deliveriesNote}</div>` : ''}`;
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
}
