/**
 * layout-manager.js — card ordering, show/hide, drag & drop reordering,
 * popover sync, and the empty-state guard. Persisted to localStorage.
 */
import { $ } from '../utils/format.js';
import { renderHeatmap } from './heatmap.js';

const LAYOUT_KEY = 'evt-layout-v1';

const CARDS = [
  { id: 'p-heat', name: '02 · STOCK TRACKING (HEATMAP)', span: 8 },
  { id: 'p-tick', name: '01 · GLOBAL TICKER', span: 4 },
  { id: 'p-chart', name: '05 · FOCUS CHART', span: 8 },
  { id: 'p-sect', name: '03 · SECTOR INTRADAY', span: 4 },
  { id: 'p-fin', name: '06 · FINANCIALS', span: 12 },
  { id: 'p-jnl', name: '07 · TRADE JOURNAL', span: 12 },
  { id: 'correlation-matrix-card', name: '08 · CORRELATION MATRIX', span: 6 },
   { id: 'p-news', name: '04 · EV NEWS WIRE', span: 12 },
  { id: 'p-clk', name: '10 · SESSION CLOCK', span: 12 },
 ];

let order = [];
let hidden = [];
let dragId = null;

function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order, hidden })); } catch (e) { /* ignore */ }
}

export function applyLayout() {
  const grid = document.querySelector('main.grid');
  order.forEach(id => {
    const el = document.getElementById(id);
    if (el) grid.appendChild(el);
  });
  CARDS.forEach(card => {
    const el = document.getElementById(card.id);
    if (!el) return;
    const show = !hidden.includes(card.id);
    el.style.display = show ? '' : 'none';
    if (show) el.style.gridColumn = 'span ' + card.span;
    const checkbox = document.querySelector('#cards-list input[data-id="' + card.id + '"]');
    if (checkbox) checkbox.checked = show;
  });
  $('grid-empty').style.display = order.every(id => hidden.includes(id)) ? 'block' : 'none';
  renderHeatmap();
}

function initLayoutManager() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch (e) { /* ignore */ }
  const isValid = saved && Array.isArray(saved.order) && saved.order.every(id => CARDS.some(c => c.id === id)) &&
    Array.isArray(saved.hidden) && saved.hidden.every(id => CARDS.some(c => c.id === id));
  order = isValid ? saved.order.slice() : CARDS.map(c => c.id);
  hidden = isValid ? [...new Set(saved.hidden)] : [];

  CARDS.forEach(card => {
    const header = document.getElementById(card.id)?.querySelector('.ph');
    if (!header) return;
    header.draggable = true;
    header.dataset.card = card.id;
    const tools = document.createElement('span');
    tools.className = 'ph-tools';
    tools.innerHTML = '<button class="tbtn" data-act="up" title="move up">▲</button>' +
      '<button class="tbtn" data-act="down" title="move down">▼</button>' +
      '<button class="tbtn" data-act="hide" title="remove card">✕</button>';
    header.insertBefore(tools, header.querySelector('.pmeta'));
    tools.addEventListener('click', e => {
      const b = e.target.closest('.tbtn');
      if (!b) return;
      e.stopPropagation();
      const i = order.indexOf(card.id);
      if (b.dataset.act === 'up' && i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; }
      else if (b.dataset.act === 'down' && i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; }
      else if (b.dataset.act === 'hide' && !hidden.includes(card.id)) { hidden.push(card.id); }
      else return;
      saveLayout();
      applyLayout();
    });
    header.addEventListener('dragstart', e => {
      dragId = card.id;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setDragImage(document.getElementById(card.id), 24, 24); } catch (err) { /* ignore */ }
    });
    header.addEventListener('dragend', () => {
      dragId = null;
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('drop-above', 'drop-below'));
    });
    header.addEventListener('dragover', e => {
      if (!dragId || dragId === card.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = header.getBoundingClientRect();
      const below = (e.clientY - rect.top) > rect.height / 2;
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('drop-above', 'drop-below'));
      document.getElementById(card.id).classList.add(below ? 'drop-below' : 'drop-above');
    });
    header.addEventListener('dragleave', () => document.getElementById(card.id).classList.remove('drop-above', 'drop-below'));
    header.addEventListener('drop', e => {
      e.preventDefault();
      document.getElementById(card.id).classList.remove('drop-above', 'drop-below');
      if (!dragId || dragId === card.id) return;
      const rect = header.getBoundingClientRect();
      const below = (e.clientY - rect.top) > rect.height / 2;
      order = order.filter(x => x !== dragId);
      order.splice(below ? order.indexOf(card.id) + 1 : order.indexOf(card.id), 0, dragId);
      dragId = null;
      saveLayout();
      applyLayout();
    });
  });

  $('cards-list').innerHTML = CARDS.map(c =>
    `<label class="row"><input type="checkbox" data-id="${c.id}" ${hidden.includes(c.id) ? '' : 'checked'}><span>${c.name}</span></label>`).join('');
  $('cards-list').addEventListener('change', e => {
    const cb = e.target.closest('input[data-id]');
    if (!cb) return;
    const id = cb.dataset.id;
    if (cb.checked) hidden = hidden.filter(x => x !== id);
    else if (!hidden.includes(id)) hidden.push(id);
    saveLayout();
    applyLayout();
  });
  $('cards-btn').addEventListener('click', e => {
    e.stopPropagation();
    ['tk-pop', 'alert-pop', 'up-pop'].forEach(id => $(id).classList.remove('open'));
    $('tk-btn')?.setAttribute('aria-expanded', 'false');
    $('alert-btn')?.setAttribute('aria-expanded', 'false');
    $('up-btn')?.setAttribute('aria-expanded', 'false');
        $('cards-pop').classList.toggle('open');
    $('cards-btn').setAttribute('aria-expanded', $('cards-pop').classList.contains('open') ? 'true' : 'false');
  });
  $('cards-reset').addEventListener('click', () => {
    try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* ignore */ }
    order = CARDS.map(c => c.id);
    hidden = [];
    $('cards-pop').classList.remove('open');
    saveLayout();
    applyLayout();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#cards-pop') && !e.target.closest('#cards-btn')) $('cards-pop').classList.remove('open');
  });
  applyLayout();
}

export { initLayoutManager as initLayout };
