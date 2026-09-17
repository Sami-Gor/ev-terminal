/**
 * ticker-table.js — global ticker table (tracked EV universe grouped by
 * sector) with row-click focus and inline ✕ removal.
 */
import { universe, SECTORS, getTracker, connection, stateLabel } from '../services/store.js';
import { bus } from '../services/store.js';
import { $, fnumOr, fchgOr, fpctOr, arrowOr, clsOr } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

export function renderTickerTable() {
  const tbody = $('tk-table').querySelector('tbody');
  let h = '';
  for (const key of Object.keys(SECTORS)) {
    h += `<tr class="cat"><td colspan="7">${SECTORS[key].label} · n=${universe.filter(t => t.sector === key).length}</td></tr>`;
    universe.filter(t => t.sector === key).forEach(t => {
      h += `<tr data-sym="${esc(t.sym)}" class="urow" tabindex="0" aria-label="${esc(t.sym)}, ${esc(t.name)}, last ${fnumOr(t.last)}, ${fpctOr(t.pct)}. Press Enter to open chart" role="button"><td><b>${esc(t.sym)}</b></td><td>${esc(t.name)}</td><td>${fnumOr(t.last)}</td>` +
        `<td class="${clsOr(t.pct)}">${arrowOr(t.pct)} ${fchgOr(t.chg)}</td><td class="${clsOr(t.pct)}">${fpctOr(t.pct)}</td>` +
        `<td><span class="stateb ${connection.live ? 'open' : ''}">${stateLabel()}</span></td>` +
        `<td class="src">${connection.dataSrc}</td>` +
        `<td class="rm" data-rm="${esc(t.sym)}" title="remove ${esc(t.sym)} from trackers">✕</td></tr>`;
    });
  }
  tbody.innerHTML = h;
  tbody.querySelectorAll('tr.urow').forEach(tr => {
    tr.addEventListener('click', () => bus.emit('focus', tr.dataset.sym));
    tr.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bus.emit('focus', tr.dataset.sym); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...tbody.querySelectorAll('tr.urow')];
        const idx = rows.indexOf(tr) + (e.key === 'ArrowDown' ? 1 : -1);
        if (rows[idx]) rows[idx].focus();
      }
    });
  });
  tbody.querySelectorAll('td.rm').forEach(td => td.addEventListener('click', e => {
    e.stopPropagation();
    bus.emit('tracker:remove', td.dataset.rm);
  }));
  $('tk-search').addEventListener('input', e => filterTickerTable(e.target.value));
}

/** Filter rows by free text (symbol or name); called by the search input. */
export function filterTickerTable(query) {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('#tk-table tbody tr').forEach(tr => {
    if (tr.classList.contains('cat')) return;        // section headers always visible
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

export function highlightRow(sym) {
  document.querySelectorAll('#tk-table tr.urow').forEach(tr => tr.classList.toggle('sel', tr.dataset.sym === sym));
}

/** In-place cell refresh for tick flushes. */
export function updateRows(syms) {
  syms.forEach(sym => {
    const t = getTracker(sym);
    if (!t) return;
    document.querySelectorAll(`#tk-table tr.urow[data-sym="${sym}"]`).forEach(tr => {
      const td = tr.children;
      td[2].textContent = fnumOr(t.last);
      td[3].className = clsOr(t.pct);
      td[3].textContent = arrowOr(t.pct) + ' ' + fchgOr(t.chg);
      td[4].className = clsOr(t.pct);
      td[4].textContent = fpctOr(t.pct);
    });
  });
}

/** Rows render once at boot, before the async config fetch resolves — keep the
 *  per-row state/source labels in sync whenever the connection mode changes so
 *  they never contradict the header badge. */
export function refreshStateCells() {
  document.querySelectorAll('#tk-table tbody tr.urow').forEach(tr => {
    const st = tr.querySelector('.stateb');
    if (st) {
      st.textContent = stateLabel();
      st.className = 'stateb' + (connection.live ? ' open' : '');
    }
    const src = tr.querySelector('td.src');
    if (src) src.textContent = connection.dataSrc;
  });
}

bus.on('connection', refreshStateCells);
