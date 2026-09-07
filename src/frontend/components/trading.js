/**
 * trading.js — private Quick-Trade overlay (distributionMode local only).
 *
 * Account summary, open positions with live P&L (5 s poll + tick-merged
 * prices), and market/limit order submission through /api/trade.
 */
import { API_BASE } from '../services/api.js';
import { getTracker } from '../services/store.js';
import { $, fnum } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

const lastPrices = new Map();
let refreshTimer = null;

function fmtMoney(v) {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function flash(message) {
  const el = $('qt-msg');
  if (!el) return;
  el.textContent = message;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { if ($('qt-msg').textContent === message) el.textContent = ''; }, 4000);
}

/** Account + positions refresh (5 s poll). */
async function refresh() {
  try {
    const acct = await (await fetch(`${API_BASE}/api/trade/account`)).json();
    $('qt-account').textContent =
      `Equity ${fmtMoney(acct.equity)} · Cash ${fmtMoney(acct.cash)} · BP ${fmtMoney(acct.buyingPower)}` +
      (acct.paper ? ' · PAPER' : ' · LIVE MONEY');
  } catch (e) { /* gated upstream */ }
  try {
    const res = await fetch(`${API_BASE}/api/trade/positions`);
    if (!res.ok) return;
    const { positions } = await res.json();
    renderPositions(positions);
  } catch (e) { /* gated upstream */ }
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

/** Live-tick P&L recompute: merge the latest price into each open row. */
export function updateRowsPnl(syms) {
  syms.forEach(sym => {
    const t = getTracker(sym);
    if (t) lastPrices.set(sym, t.last);
  });
  document.querySelectorAll('#qt-positions tr[data-sym]').forEach(tr => {
    const sym = tr.dataset.sym;
    const last = lastPrices.get(sym);
    const qty = Number(tr.dataset.qty);
    const sideDir = tr.dataset.side === 'short' ? -1 : 1;
    const avg = Number(tr.dataset.avg);
    if (last == null || !qty) return;
    const pl = (last - avg) * qty * sideDir;
    tr.children[3].textContent = fnum(last);
    const plCell = tr.children[5];
    plCell.textContent = fmtMoney(pl);
    plCell.className = pl >= 0 ? 'up' : 'down';
  });
}

async function submitOrder(payload) {
  try {
    const res = await fetch(`${API_BASE}/api/trade/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    flash(res.ok ? `✓ ${payload.side} ${payload.qty} ${payload.symbol} — order accepted` : (out.error || 'order failed'));
    await refresh();
  } catch (e) {
    flash('order failed — backend unreachable');
  }
}

export function initTrading(getFocusedSymbol) {
  $('trade-btn').addEventListener('click', e => {
    e.stopPropagation();
    ['cards-pop', 'tk-pop', 'alert-pop', 'up-pop'].forEach(id => $(id).classList.remove('open'));
    $('trade-btn').setAttribute('aria-expanded', $('trade-pop').classList.contains('open') ? 'false' : 'true');
    $('trade-pop').classList.toggle('open');
    if ($('trade-pop').classList.contains('open')) {
      $('qt-symbol').value = getFocusedSymbol();
      refresh();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#trade-pop') && !e.target.closest('#trade-btn')) $('trade-pop').classList.remove('open');
  });
  $('qt-type').addEventListener('change', () => {
    $('qt-limit').parentElement.style.display = $('qt-type').value === 'limit' ? '' : 'none';
  });
  $('qt-submit').addEventListener('click', () => {
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
    if (!close) return;
    close.disabled = true;
    try {
      await fetch(`${API_BASE}/api/trade/positions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: close.dataset.close }),
      });
      await refresh();
    } catch (err) { /* gated upstream */ }
  });
  refreshTimer = setInterval(refresh, 5000);
}
