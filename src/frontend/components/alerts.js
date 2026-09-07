/**
 * alerts.js — price & % change alert engine: creation popover, tick
 * evaluation, self-dismissing toasts, audio chime, persisted history tray.
 */
import { getTracker, chartState } from '../services/store.js';
import { $, fnum, fpct } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

const ALERTS_KEY = 'evt-alerts-v1';
const ALERT_CONDS = ['above', 'below', 'pctup'];
const ALERT_SYM_RE = /^[A-Z0-9.\-^]{1,10}$/;
let alerts = { active: [], history: [], unread: 0, chime: true };
const lastTickPrice = {};
let audioContext = null;

/** Reject corrupted/untrusted alert records read back from localStorage. */
function validAlert(a) {
  return !!a && typeof a === 'object' &&
    typeof a.id === 'string' && a.id.length <= 40 &&
    typeof a.sym === 'string' && ALERT_SYM_RE.test(a.sym) &&
    ALERT_CONDS.includes(a.cond) &&
    Number.isFinite(a.value) && Math.abs(a.value) < 1e9;
}

function validHistoryEntry(h) {
  return !!h && typeof h === 'object' &&
    typeof h.sym === 'string' && ALERT_SYM_RE.test(h.sym) &&
    ALERT_CONDS.includes(h.cond) &&
    Number.isFinite(h.value) && Math.abs(h.value) < 1e9 &&
    Number.isFinite(h.price) && h.price >= 0 &&
    Number.isFinite(h.pct) && Math.abs(h.pct) < 1e5 &&
    Number.isFinite(h.ts) && h.ts > 0;
}

function load() {
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(ALERTS_KEY) || 'null'); } catch (e) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.active) || !Array.isArray(parsed.history)) {
    try { localStorage.removeItem(ALERTS_KEY); } catch (e) { /* ignore */ }
    alerts = { active: [], history: [], unread: 0, chime: true };   // corrupted → reset
    return;
  }
  alerts = {
    active: parsed.active.filter(validAlert),
    history: parsed.history.filter(validHistoryEntry).slice(0, 50),
    unread: Number.isFinite(parsed.unread) ? Math.max(0, Math.min(999, parsed.unread)) : 0,
    chime: parsed.chime !== false,
  };
}

function save() {
  try { localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts)); } catch (e) { /* ignore */ }
}

function conditionText(cond, value) {
  if (cond === 'above') return 'crossed above $' + fnum(value);
  if (cond === 'below') return 'crossed below $' + fnum(value);
  return 'daily change > ' + (value >= 0 ? '+' : '−') + Math.abs(value) + '%';
}

function updateBadge() {
  const el = $('alert-count');
  if (el) el.textContent = alerts.unread > 0 ? String(alerts.unread) : '';
}

function chime() {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioContext.currentTime);
    osc.frequency.setValueAtTime(1318, audioContext.currentTime + 0.12);
    gain.gain.setValueAtTime(0.07, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.45);
  } catch (e) { /* audio unavailable — silent fallback */ }
}

function showToast(items) {
  let wrap = $('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  for (const alert of items) {
    const t = getTracker(alert.sym);
    const card = document.createElement('div');
    card.className = 'toast';
    card.innerHTML = `<b>◉ ALERT — ${esc(alert.sym)}</b> ${conditionText(alert.cond, alert.value)}` +
      (t ? `<br>now <b>${fnum(t.last)}</b> (${fpct(t.pct)})` : '') +
      `<span class="tm">${new Date().toLocaleTimeString('en-US', { hour12: false })}</span>`;
    wrap.appendChild(card);
    setTimeout(() => {
      card.style.transition = 'opacity .4s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 450);
    }, 6000);
  }
  while (wrap.children.length > 5) wrap.firstChild.remove();
}

/** Evaluate active alerts against a live tick (crossings use previous tick). */
export function onTick(symbol) {
  const t = getTracker(symbol);
  if (!t) return;
  const previous = lastTickPrice[symbol];
  lastTickPrice[symbol] = t.last;
  if (previous == null) return;
  const fired = [];
  for (const alert of alerts.active) {
    if (alert.sym !== symbol) continue;
    let hit = false;
    if (alert.cond === 'above') hit = previous < alert.value && t.last >= alert.value;
    else if (alert.cond === 'below') hit = previous > alert.value && t.last <= alert.value;
    else if (alert.cond === 'pctup') hit = t.pct > alert.value;
    if (hit) fired.push(alert);
  }
  if (!fired.length) return;
  for (const alert of fired) {
    alerts.history.unshift({ sym: alert.sym, cond: alert.cond, value: alert.value, price: t.last, pct: t.pct, ts: Date.now() });
    alerts.active = alerts.active.filter(x => x.id !== alert.id);
  }
  if (alerts.history.length > 50) alerts.history.length = 50;
  alerts.unread += fired.length;
  save();
  showToast(fired);
  renderPopover();
  updateBadge();
  if (alerts.chime) chime();
}

function renderPopover() {
  const active = $('al-active');
  const history = $('al-hist');
  active.innerHTML = alerts.active.length
    ? alerts.active.map(a => `<div class="row"><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${esc(a.sym)}</b> ${conditionText(a.cond, a.value)}</span><button class="tbtn" data-alm="${esc(a.id)}" title="remove alert">✕</button></div>`).join('')
    : '<div class="hint" style="color:var(--dim2)">no active alerts</div>';
  history.innerHTML = alerts.history.length
    ? alerts.history.slice(0, 25).map(h => `<div class="row"><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${esc(h.sym)}</b> ${conditionText(h.cond, h.value)} <span style="color:var(--dim2)">@ ${fnum(h.price)}</span></span><span style="color:var(--dim2);font-size:9px">${new Date(h.ts).toLocaleTimeString('en-US', { hour12: false })}</span></div>`).join('')
    : '<div class="hint" style="color:var(--dim2)">nothing triggered yet</div>';
  const chimeBox = $('al-chime');
  if (chimeBox) chimeBox.checked = alerts.chime;
}

function flashHint(message) {
  const el = $('al-hint');
  if (!el) return;
  el.textContent = message;
  clearTimeout(flashHint.t);
  flashHint.t = setTimeout(() => { if ($('al-hint').textContent === message) $('al-hint').textContent = ''; }, 2800);
}

export function initAlerts() {
  load();
  renderPopover();
  updateBadge();
  $('alert-btn').addEventListener('click', e => {
    e.stopPropagation();
    ['cards-pop', 'tk-pop', 'up-pop'].forEach(id => $(id).classList.remove('open'));
    $('alert-pop').classList.toggle('open');
    $('alert-btn').setAttribute('aria-expanded', $('alert-pop').classList.contains('open') ? 'true' : 'false');
    if ($('alert-pop').classList.contains('open')) {
      alerts.unread = 0;
      save();
      updateBadge();
      const symInput = $('al-sym');
      if (symInput && !symInput.value && chartState.focus) symInput.value = chartState.focus;
      renderPopover();
    }
  });
  $('al-cond').addEventListener('change', () => {
    $('al-val').placeholder = $('al-cond').value === 'pctup' ? 'e.g. 5 (%)' : 'e.g. 220.00';
  });
  $('al-add').addEventListener('click', () => {
    const sym = $('al-sym').value.trim().toUpperCase();
    const cond = $('al-cond').value;
    const value = parseFloat($('al-val').value);
    if (!/^[A-Z0-9.\-^]{1,10}$/.test(sym)) { flashHint('symbol: up to 10 chars (A-Z 0-9 . - ^)'); return; }
    if (!getTracker(sym)) { flashHint(sym + ' is not tracked — add it via TRACKERS first'); return; }
    if (!isFinite(value)) { flashHint('enter a trigger value'); return; }
    if (alerts.active.some(a => a.sym === sym && a.cond === cond && a.value === value)) {
      flashHint('identical alert already active');
      return;
    }
    alerts.active.push({ id: String(Date.now()) + '-' + Math.floor(Math.random() * 1e4), sym, cond, value, created: Date.now() });
    if (lastTickPrice[sym] == null && getTracker(sym)) lastTickPrice[sym] = getTracker(sym).last;
    save();
    renderPopover();
    updateBadge();
    $('al-val').value = '';
    flashHint('alert set: ' + sym + ' ' + conditionText(cond, value));
  });
  $('al-active').addEventListener('click', e => {
    const removeButton = e.target.closest('[data-alm]');
    if (!removeButton) return;
    alerts.active = alerts.active.filter(x => x.id !== removeButton.dataset.alm);
    save();
    renderPopover();
  });
  $('al-clear').addEventListener('click', () => {
    alerts.history = [];
    alerts.unread = 0;
    save();
    renderPopover();
    updateBadge();
  });
  $('al-chime').addEventListener('change', e => { alerts.chime = e.target.checked; save(); });
  document.addEventListener('click', e => {
    if (!e.target.closest('#alert-pop') && !e.target.closest('#alert-btn')) $('alert-pop').classList.remove('open');
  });
  document.addEventListener('click', e => {   // other popovers opening close this one
    for (const id of ['up-pop']) {
      const el = $(id);
      if (el && el.classList.contains('open')) $('alert-pop').classList.remove('open');
    }
  });
}
