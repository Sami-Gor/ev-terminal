/**
 * journal.js — trade journal & backtest: paper trades are logged from the
 * risk toolbar snapshot, resolved against 60-session history and live ticks,
 * and persisted to localStorage. Metrics + equity curve summarize results.
 */
import { getTracker } from '../services/store.js';
import { $, fnum, fmtBig, CLS } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

const JOURNAL_KEY = 'evt-journal-v1';
const TRADE_SYM_RE = /^[A-Z0-9.\-^]{1,10}$/;
let journal = [];

/** Reject corrupted/untrusted trade records read back from localStorage. */
function validTrade(t) {
  return !!t && typeof t === 'object' &&
    typeof t.id === 'string' && t.id.length <= 40 &&
    typeof t.sym === 'string' && TRADE_SYM_RE.test(t.sym) &&
    (t.type === 'LONG' || t.type === 'SHORT') &&
    Number.isFinite(t.entry) && t.entry > 0 && t.entry < 1e7 &&
    Number.isFinite(t.sl) && t.sl > 0 && t.sl < 1e7 &&
    Number.isFinite(t.tp) && t.tp > 0 && t.tp < 1e7 &&
    Number.isFinite(t.riskDist) && t.riskDist > 0 &&
    Number.isFinite(t.riskD) && t.riskD >= 0 &&
    (t.status === 'OPEN' || t.status === 'WIN' || t.status === 'LOSS') &&
    (t.rr === null || t.rr === undefined || (Number.isFinite(t.rr) && t.rr > -100 && t.rr < 100)) &&
    typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
}

function load() {
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(JOURNAL_KEY) || 'null'); } catch (e) { parsed = null; }
  if (!Array.isArray(parsed)) {
    try { localStorage.removeItem(JOURNAL_KEY); } catch (e) { /* ignore */ }
    journal = [];                                   // corrupted record → clean reset
    return;
  }
  journal = parsed.filter(validTrade);              // drop malformed entries
}

function save() {
  try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal)); } catch (e) { /* ignore */ }
}

/** Walk bars after the entry date; stop wins ties (conservative). */
function resolveAgainstHistory(trade, bars) {
  const start = bars.findIndex(b => b.dt > trade.date);
  if (start < 0) return null;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    if (trade.type === 'LONG') {
      if (b.l <= trade.sl) return { status: 'LOSS', exit: trade.sl };
      if (b.h >= trade.tp) return { status: 'WIN', exit: trade.tp };
    } else {
      if (b.h >= trade.sl) return { status: 'LOSS', exit: trade.sl };
      if (b.l <= trade.tp) return { status: 'WIN', exit: trade.tp };
    }
  }
  return null;
}

function settle(trade, result) {
  trade.status = result.status;
  trade.exit = result.exit;
  trade.rr = result.status === 'WIN' ? Math.abs(trade.tp - trade.entry) / (trade.riskDist || 1) : -1;
}

/** Live resolution of open trades on every tick. */
export function onTick(symbol, price) {
  let changed = false;
  for (const trade of journal) {
    if (trade.sym !== symbol || trade.status !== 'OPEN') continue;
    if (trade.type === 'LONG') {
      if (price <= trade.sl) { settle(trade, { status: 'LOSS', exit: trade.sl }); changed = true; }
      else if (price >= trade.tp) { settle(trade, { status: 'WIN', exit: trade.tp }); changed = true; }
    } else {
      if (price >= trade.sl) { settle(trade, { status: 'LOSS', exit: trade.sl }); changed = true; }
      else if (price <= trade.tp) { settle(trade, { status: 'WIN', exit: trade.tp }); changed = true; }
    }
  }
  if (changed) { save(); render(); }
}

/** Backtest resolution of open trades once history is available. */
export function resolveAll() {
  let changed = false;
  for (const trade of journal) {
    if (trade.status !== 'OPEN') continue;
    const t = getTracker(trade.sym);
    if (!t || !t.hist) continue;
    const result = resolveAgainstHistory(trade, t.hist);
    if (result) { settle(trade, result); changed = true; }
  }
  if (changed) { save(); render(); }
}

/** Log a paper trade from the chart's risk toolbar snapshot. */
export function logTrade(snapshot) {
  const t = getTracker(snapshot.sym);
  if (!t || !t.hist) return { ok: false, message: 'chart not ready' };
  if (snapshot.entry == null || snapshot.sl == null || Math.abs(snapshot.entry - snapshot.sl) < 1e-9) {
    return { ok: false, message: 'entry and stop must differ' };
  }
  const trade = {
    id: String(Date.now()) + '-' + Math.floor(Math.random() * 1e4),
    date: t.hist[t.hist.length - 1].dt,
    sym: snapshot.sym,
    type: snapshot.type,
    entry: snapshot.entry,
    sl: snapshot.sl,
    tp: snapshot.tp,
    riskDist: snapshot.riskDist,
    riskD: snapshot.riskD,
    status: 'OPEN', rr: null, exit: null,
  };
  const result = resolveAgainstHistory(trade, t.hist);
  if (result) settle(trade, result);
  journal.push(trade);
  save();
  render();
  return { ok: true, message: `${trade.sym} ${trade.type} logged @ ${fnum(trade.entry)} · TP ${fnum(trade.tp)}` };
}

export function deleteTrade(id) {
  journal = journal.filter(t => t.id !== id);
  save();
  render();
}

function metrics() {
  const closed = journal.filter(t => t.status !== 'OPEN');
  const wins = closed.filter(t => t.status === 'WIN');
  const losses = closed.filter(t => t.status === 'LOSS');
  const pnl = t => (t.rr || 0) * t.riskD;
  const grossProfit = wins.reduce((s, t) => s + pnl(t), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + pnl(t), 0));
  const totalPnl = closed.reduce((s, t) => s + pnl(t), 0);
  let equity = 0;
  const equityPoints = [0];
  for (const t of journal) {
    if (t.status === 'OPEN') continue;
    equity += pnl(t);
    equityPoints.push(equity);
  }
  return {
    total: journal.length,
    closed: closed.length,
    open: journal.length - closed.length,
    winRate: closed.length ? wins.length / closed.length * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
    expectancy: closed.length ? totalPnl / closed.length : null,
    totalPnl,
    equityPoints,
  };
}

function equitySvg(points) {
  const W = 170, H = 48;
  if (points.length < 2) {
    return `<svg viewBox="0 0 ${W} ${H}" class="eqsvg"><line x1="4" x2="${W - 4}" y1="${H - 10}" y2="${H - 10}" stroke="#26282b" stroke-dasharray="2 2"/><text x="${W / 2}" y="${H / 2}" fill="#6E7681" font-size="8.5" text-anchor="middle" font-family="inherit">no closed trades yet</text></svg>`;
  }
  const lo = Math.min(0, ...points), hi = Math.max(0, ...points);
  const X = i => 4 + i / (points.length - 1) * (W - 8);
  const Y = v => 6 + (hi - v) / ((hi - lo) || 1) * (H - 18);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="eqsvg">`;
  if (hi > 0 && lo < 0) s += `<line x1="4" x2="${W - 4}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#3d444d" stroke-dasharray="2 2"/>`;
  const up = points[points.length - 1] >= 0;
  s += `<polyline points="${points.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="${up ? '#00C176' : '#E5484D'}" stroke-width="1.3"/>`;
  s += `<circle cx="${X(points.length - 1).toFixed(1)}" cy="${Y(points[points.length - 1]).toFixed(1)}" r="2" fill="#F28C00"/></svg>`;
  return s;
}

function flash(message) {
  const el = $('jnl-meta');
  if (!el) return;
  const keep = el.textContent;
  el.textContent = message;
  el.style.color = 'var(--amber)';
  setTimeout(() => { el.textContent = keep; el.style.color = ''; }, 2600);
}

export function render() {
  const m = metrics();
  const kpi = (label, value, cls) => `<div class="kpi"><div class="l">${label}</div><div class="v ${cls || ''}">${value}</div></div>`;
  $('jnl-kpis').innerHTML =
    kpi('TOTAL TRADES', m.total) +
    kpi('WIN RATE', m.winRate == null ? '—' : m.winRate.toFixed(1) + '%', m.winRate != null && m.winRate >= 50 ? 'up' : '') +
    kpi('PROFIT FACTOR', m.profitFactor == null ? '—' : (m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)), m.profitFactor == null ? '' : (m.profitFactor >= 1 ? 'up' : 'down')) +
    kpi('EXPECTANCY', m.expectancy == null ? '—' : fmtBig(m.expectancy) + '<span class="s" style="display:inline"> /trade</span>', m.expectancy != null ? (m.expectancy >= 0 ? 'up' : 'down') : '') +
    `<div class="kpi"><div class="l">EQUITY CURVE <span style="color:var(--dim2)">${m.closed ? '(' + fmtBig(m.totalPnl) + ')' : ''}</span></div>${equitySvg(m.equityPoints)}</div>`;
  $('jnl-meta').textContent = `${m.total} logged · ${m.open} open · ${m.closed} closed`;
  const rows = [...journal].reverse().map(t => {
    const outcome = t.status === 'WIN' ? '<span class="up">WIN</span>' : t.status === 'LOSS' ? '<span class="down">LOSS</span>' : '<span style="color:var(--dim)">OPEN</span>';
    const rr = t.status === 'OPEN' ? '—' : ((t.rr >= 0 ? '+' : '−') + Math.abs(t.rr).toFixed(2) + 'R');
    const rrCls = t.status === 'OPEN' ? '' : (t.rr >= 0 ? 'up' : 'down');
    const pnl = t.status === 'OPEN' ? '—' : fmtBig((t.rr || 0) * t.riskD);
    const pnlCls = t.status === 'OPEN' ? '' : ((t.rr || 0) >= 0 ? 'up' : 'down');
    return `<tr><td class="lbl">${esc(t.date)}</td><td><b>${esc(t.sym)}</b></td><td class="${t.type === 'LONG' ? 'up' : 'down'}">${esc(t.type)}</td>` +
      `<td>${fnum(t.entry)}</td><td class="down">${fnum(t.sl)}</td><td class="up">${fnum(t.tp)}</td><td>${outcome}</td>` +
      `<td class="${rrCls}">${rr}</td><td class="${pnlCls}">${pnl}</td>` +
      `<td class="rm" data-del="${esc(t.id)}" title="delete entry">✕</td></tr>`;
  }).join('');
  $('jnl-table').innerHTML =
    `<tr><th>DATE</th><th>SYM</th><th>TYPE</th><th>ENTRY</th><th>SL</th><th>TP</th><th>OUTCOME</th><th>R:R</th><th>P&amp;L</th><th></th></tr>` +
    (rows || `<tr><td colspan="10" class="lbl" style="padding:10px 6px">no trades logged yet — set entry/stop in the risk toolbar above, then press ＋ LOG HYPOTHETICAL TRADE</td></tr>`);
}

export function initJournal() {
  load();
  render();
  $('jnl-table').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) deleteTrade(del.dataset.del);
  });
}
