/**
 * trading.js — private Quick-Trade overlay (private mode only).
 *
 * Stage 1 hardening:
 *   - does nothing unless GET /api/config reports tradingEnabled (public mode
 *     never initialises the panel and never calls the broker);
 *   - TRADING_API_TOKEN is entered by the user and kept in sessionStorage,
 *     sent as "Authorization: Bearer <token>";
 *   - explicit confirmation (symbol/side/qty/type/limit + PAPER/LIVE) before
 *     any order or position close; submission is blocked while the broker
 *     mode is unknown;
 *   - one in-flight submission at a time (button disabled + guarded);
 *   - a client_order_id is generated per intended order and reused when a
 *     failed transport request is retried.
 */
import { API_BASE } from '../services/api.js';
import { getTracker, connection, bus } from '../services/store.js';
import { $, fnum, fnumOr } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

const lastPrices = new Map();
const TOKEN_KEY = 'evt-trade-token';
let refreshTimer = null;
let brokerKnown = false;
let brokerPaper = null;
let submitting = false;
let pendingIntent = null;          // { sig, id } — reused when a failed request is retried

function fmtMoney(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '—';   // missing ≠ $0.00
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function flash(message) {
  const el = $('qt-msg');
  if (!el) return;
  el.textContent = message;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { if ($('qt-msg').textContent === message) el.textContent = ''; }, 4000);
}

/* ---- token handling (session-only, never persisted to localStorage) ---- */

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

function storeToken(value) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* storage unavailable — token stays session-only */ }
}

async function tradeFetch(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(API_BASE + path, Object.assign({}, options, { headers }));
}

/* ---- broker mode (PAPER / LIVE) is explicit text, never inferred ---- */

function modeLabel() {
  if (!brokerKnown) return 'MODE UNKNOWN';
  return brokerPaper ? 'ALPACA PAPER' : 'ALPACA LIVE';
}

function setModeLabel() {
  const el = $('qt-paper');
  if (el) el.textContent = modeLabel();
}

function setSubmitEnabled() {
  const btn = $('qt-submit');
  if (btn) btn.disabled = submitting || connection.tradingEnabled !== true || !brokerKnown;
}

function setBusy(busy) {
  submitting = busy;
  const btn = $('qt-submit');
  if (btn) {
    btn.textContent = busy ? 'SUBMITTING…' : 'SUBMIT ORDER';
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  setSubmitEnabled();
}

function syncTradingVisibility() {
  const enabled = connection.tradingEnabled === true;
  const btn = $('trade-btn');
  if (btn) btn.style.display = enabled ? '' : 'none';
  if (!enabled) {
    const pop = $('trade-pop');
    if (pop) pop.classList.remove('open');
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    brokerKnown = false;
    brokerPaper = null;
    setModeLabel();
  } else if (!refreshTimer) {
    refreshTimer = setInterval(refresh, 5000);
  }
  setSubmitEnabled();
}

/* ---- account + positions ---- */

async function refresh() {
  if (connection.tradingEnabled !== true) return;
  try {
    const res = await tradeFetch('/api/trade/account');
    if (res.status === 401) {
      brokerKnown = false;
      brokerPaper = null;
      setModeLabel();
      setSubmitEnabled();
      flash('trading token missing or invalid');
      return;
    }
    if (!res.ok) {
      brokerKnown = false;
      brokerPaper = null;
      setModeLabel();
      setSubmitEnabled();
      flash('broker account unavailable');
      return;
    }
    const acct = await res.json();
    brokerKnown = true;
    brokerPaper = acct.paper === true;
    setModeLabel();
    $('qt-account').textContent =
      `Equity ${fmtMoney(acct.equity)} · Cash ${fmtMoney(acct.cash)} · BP ${fmtMoney(acct.buyingPower)}` +
      (brokerPaper ? ' · PAPER' : ' · LIVE MONEY');
  } catch (e) {
    brokerKnown = false;
    brokerPaper = null;
    setModeLabel();
    setSubmitEnabled();
    return;
  }
  setSubmitEnabled();
  try {
    const res = await tradeFetch('/api/trade/positions');
    if (!res.ok) return;
    const { positions } = await res.json();
    renderPositions(positions);
  } catch (e) { /* positions are best-effort */ }
}

function renderPositions(positions) {
  const wrap = $('qt-positions');
  if (!positions.length) {
    wrap.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:6px 0">no open positions</div>';
    return;
  }
  wrap.innerHTML = positions.map(p => `
    <tr data-sym="${esc(p.symbol)}" data-qty="${p.qty}" data-side="${p.side}" data-avg="${p.avgEntryPrice}">
      <td><b>${esc(p.symbol)}</b></td>
      <td>${p.qty}</td>
      <td>${fmtMoney(p.avgEntryPrice)}</td>
      <td class="qt-last">${fmtMoney(p.currentPrice ?? p.lastPrice)}</td>
      <td class="${p.unrealizedPL >= 0 ? 'up' : 'down'}">${fmtMoney(p.unrealizedPL)}</td>
      <td><button class="tbtn" data-close="${esc(p.symbol)}" title="close position at market">✕</button></td>
    </tr>`).join('');
}

/** Live-tick P&L recompute for the affected symbols only (render-scheduler
 *  light pass). Periodic GET /api/trade/positions polling stays authoritative
 *  for reconciliation — live ticks only refresh the displayed numbers. */
export function updateRowsPnl(syms) {
  syms.forEach(sym => {
    const t = getTracker(sym);
    if (!t) return;
    lastPrices.set(sym, t.last);
    if (!Number.isFinite(t.last)) return;
    document.querySelectorAll(`#qt-positions tr[data-sym="${sym}"]`).forEach(tr => {
      const qty = Number(tr.dataset.qty);
      if (!qty) return;
      const sideDir = tr.dataset.side === 'short' ? -1 : 1;
      const avg = Number(tr.dataset.avg);
      const pl = (t.last - avg) * qty * sideDir;
      tr.children[3].textContent = fnumOr(t.last);
      const plCell = tr.children[4];
      plCell.textContent = fmtMoney(pl);
      plCell.className = pl >= 0 ? 'up' : 'down';
    });
  });
}

/* ---- order submission ---- */

/** One ID per intended order; UUID when available, timestamp fallback. */
function newOrderId() {
  const c = window.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function orderConfirmationText(payload, reused) {
  const lines = [
    `CONFIRM ORDER — ${modeLabel()}`,
    `Symbol: ${payload.symbol}`,
    `Side: ${String(payload.side).toUpperCase()}`,
    `Quantity: ${payload.qty}`,
    `Order type: ${String(payload.type).toUpperCase()}`,
  ];
  if (payload.type === 'limit') lines.push(`Limit price: $${payload.limitPrice}`);
  lines.push(reused
    ? 'Retry of the previous failed request (same client order id).'
    : 'This sends a real order to Alpaca.');
  return lines.join('\n');
}

async function submitOrder(payload) {
  if (connection.tradingEnabled !== true) return;              // public/disabled: no broker call
  if (!brokerKnown || brokerPaper === null) {
    flash('order blocked — broker mode unknown (enter a valid token and retry)');
    return;
  }
  const sig = JSON.stringify(payload);
  const reused = !!(pendingIntent && pendingIntent.sig === sig);
  const clientOrderId = reused ? pendingIntent.id : newOrderId();
  if (!window.confirm(orderConfirmationText(payload, reused))) return;

  setBusy(true);
  try {
    const res = await tradeFetch('/api/trade/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, payload, { clientOrderId })),
    });
    const out = await res.json().catch(() => ({}));
    pendingIntent = null;                                      // any HTTP response resolves the intent
    flash(res.ok
      ? `✓ ${payload.side} ${payload.qty} ${payload.symbol} — order accepted`
      : (out.error || 'order failed'));
    await refresh();
  } catch (e) {
    pendingIntent = { sig, id: clientOrderId };                // transport failure: retry reuses the ID
    flash('order request failed — retry reuses the same client order id');
  } finally {
    setBusy(false);
  }
}

/* ---- init ---- */

export function initTrading(getFocusedSymbol) {
  syncTradingVisibility();
  bus.on('connection', syncTradingVisibility);                  // config resolves after boot

  $('trade-btn').addEventListener('click', e => {
    if (connection.tradingEnabled !== true) return;
    e.stopPropagation();
    ['cards-pop', 'tk-pop', 'alert-pop', 'up-pop'].forEach(id => $(id).classList.remove('open'));
    $('trade-btn').setAttribute('aria-expanded', $('trade-pop').classList.contains('open') ? 'false' : 'true');
    $('trade-pop').classList.toggle('open');
    if ($('trade-pop').classList.contains('open')) {
      $('qt-symbol').value = getFocusedSymbol();
      const tokenInput = $('qt-token');
      if (tokenInput) tokenInput.value = getToken();
      refresh();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#trade-pop') && !e.target.closest('#trade-btn')) $('trade-pop').classList.remove('open');
  });
  $('qt-type').addEventListener('change', () => {
    $('qt-limit').parentElement.style.display = $('qt-type').value === 'limit' ? '' : 'none';
  });

  const applyToken = () => {
    storeToken($('qt-token').value.trim());
    $('qt-token').value = getToken();
    flash('trading token saved for this browser session');
    refresh();
  };
  $('qt-token-apply').addEventListener('click', applyToken);
  $('qt-token').addEventListener('keydown', e => { if (e.key === 'Enter') applyToken(); });

  $('qt-submit').addEventListener('click', () => {
    if (submitting) return;                                    // in-flight lock
    const payload = {
      symbol: $('qt-symbol').value.trim().toUpperCase(),
      side: document.querySelector('input[name="qt-side"]:checked').value,
      qty: Number($('qt-qty').value),
      type: $('qt-type').value,
    };
    if (payload.type === 'limit') payload.limitPrice = Number($('qt-limit').value);
    submitOrder(payload);
  });

  $('qt-positions').addEventListener('click', async e => {
    const close = e.target.closest('[data-close]');
    if (!close || connection.tradingEnabled !== true) return;
    if (!brokerKnown || brokerPaper === null) {
      flash('close blocked — broker mode unknown');
      return;
    }
    const sym = close.dataset.close;
    if (!window.confirm(`CLOSE POSITION — ${modeLabel()}\nMarket-close ${sym}? This sends a real order to Alpaca.`)) return;
    close.disabled = true;
    try {
      await tradeFetch('/api/trade/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      });
      await refresh();
    } catch (err) { /* gated upstream */ }
  });
}
