/**
 * trackers.js — TRACKERS popover: add custom tickers (backend-validated),
 * remove/reset the universe. Emits 'universe:changed' on every mutation so
 * main.js can re-render all panels and resync subscriptions.
 */
import {
  SECTORS, universe,
  initTracker, addTrackerRecord, removeTrackerRecord, resetTrackers, saveTrackers,
} from '../services/store.js';
import { bus } from '../services/store.js';
import { API_BASE, fetchJson } from '../services/api.js';
import { wsSubscribe, wsUnsubscribe } from '../services/ws-client.js';
import { $ } from '../utils/format.js';
import { esc, sanitizeSymbol, sanitizeName } from '../utils/sanitize.js';

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,10}$/;

function flash(message) {
  const el = $('tk-hint');
  if (!el) return;
  el.textContent = message;
  setTimeout(() => { if ($('tk-hint').textContent === message) el.textContent = ''; }, 4000);
}

export function renderTrackerPop() {
  $('tk-list').innerHTML = Object.keys(SECTORS).map(key => {
    const members = universe.filter(t => t.sector === key);
    if (!members.length) return '';
    return `<div class="cp-title" style="margin:4px 0 2px;color:${SECTORS[key].color}">${SECTORS[key].label}</div>` +
      members.map(t => `<div class="row"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(t.sym)}</b> <span style="color:var(--dim)">${esc(t.name)}</span></span><button class="tbtn" data-rm="${esc(t.sym)}" title="remove ${esc(t.sym)}">✕</button></div>`).join('');
  }).join('') || '<div class="hint">no trackers — add one below</div>';
}

export function removeTracker(sym) {
  if (universe.length <= 1) { flash('cannot remove the last tracker'); return; }
  removeTrackerRecord(sym);
  wsUnsubscribe([sym]);
  bus.emit('universe:changed');
  flash(sym + ' removed');
}

async function addTracker() {
  const sym = sanitizeSymbol($('tk-sym').value);
  const name = sanitizeName($('tk-name').value);
  const sector = $('tk-sector').value;
  const typedLast = parseFloat($('tk-last').value);
  const typedPct = parseFloat($('tk-pct').value);
  if (!sym) { flash('symbol: up to 10 chars (A-Z 0-9 . - ^)'); return; }
  if (universe.some(t => t.sym === sym)) { flash(sym + ' is already tracked'); return; }
  flash('validating ' + sym + ' against backend…');
  let profile = null;
  try {
    profile = await fetchJson(`${API_BASE}/api/quote/${encodeURIComponent(sym)}`);
  } catch (e) {
    if (e.status) { flash(e.message || (sym + ' not found at provider')); return; }
    flash('backend unreachable — will use typed values / offline seed');
  }
  const price = profile && Number.isFinite(profile.price) && profile.price > 0 ? profile.price : typedLast;
  const pct = profile && Number.isFinite(profile.percentChange) ? profile.percentChange : typedPct;
  if (!(price > 0)) { flash('enter a last price (backend offline)'); return; }
  if (!(pct >= -95 && pct <= 95)) { flash('chg% must be between -95 and 95'); return; }
  const volumeRaw = profile && Number.isFinite(profile.volume) && profile.volume > 0 ? profile.volume : 5e6;
  const tracker = {
    sym,
    name: (profile && profile.name && profile.name !== sym) ? profile.name : (name || sym),
    sector,
    last: price,
    pct,
    vol: volumeRaw > 5000 ? volumeRaw / 1e6 : volumeRaw,
    profile: profile ? profile.profile || null : null,
  };
  initTracker(tracker);
  addTrackerRecord(tracker);
  bus.emit('universe:changed');
  wsSubscribe([sym]);
  $('tk-sym').value = ''; $('tk-name').value = ''; $('tk-last').value = ''; $('tk-pct').value = '';
  flash(sym + ' added to ' + SECTORS[sector].label + (profile ? ' · live quote ok' : ' · offline seed'));
}

export function initTrackers() {
  $('tk-add').addEventListener('click', addTracker);
  ['tk-sym', 'tk-last', 'tk-pct'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') addTracker();
  }));
  $('tk-list').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (b) removeTracker(b.dataset.rm);
  });
  $('tk-btn').addEventListener('click', e => {
    e.stopPropagation();
    ['cards-pop', 'alert-pop', 'up-pop', 'broker-pop'].forEach(id => { $(id).classList.remove('open'); $(id.replace('tk-pop','tk-btn'))?.setAttribute('aria-expanded','false'); });
    $('tk-pop').classList.toggle('open');
    $('tk-btn').setAttribute('aria-expanded', $('tk-pop').classList.contains('open') ? 'true' : 'false');
  });
  $('tk-reset').addEventListener('click', () => {
    resetTrackers();
    $('tk-pop').classList.remove('open');
    bus.emit('universe:changed');
  });
  ['p-heat', 'p-tick'].forEach(id => {           // ± shortcut buttons
    const tools = document.querySelector('#' + id + ' .ph-tools');
    if (!tools) return;
    tools.insertAdjacentHTML('beforeend', '<button class="tbtn" data-act="tk" title="add / remove trackers">±</button>');
    tools.querySelector('[data-act="tk"]').addEventListener('click', e => {
      e.stopPropagation();
      ['cards-pop', 'alert-pop', 'up-pop', 'broker-pop'].forEach(pid => $(pid).classList.remove('open'));
      $('tk-pop').classList.toggle('open');
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#tk-pop') && !e.target.closest('#tk-btn') && !e.target.closest('.ph-tools')) {
      $('tk-pop').classList.remove('open');
    }
  });
  renderTrackerPop();
}
