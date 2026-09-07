/**
 * ticker-table.js — global ticker table (tracked EV universe grouped by
 * sector) with row-click focus and inline ✕ removal.
 */
import { universe, SECTORS, getTracker, connection } from '../services/store.js';
import { bus } from '../services/store.js';
import { removeTracker } from './trackers.js';
import { $, fnum, fchg, fpct, ARROW, CLS } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

export function renderTickerTable() {
  const tbody = $('tk-table').querySelector('tbody');
  let h = '';
  for (const key of Object.keys(SECTORS)) {
    h += `<tr class="cat"><td colspan="7">${SECTORS[key].label} · n=${universe.filter(t => t.sector === key).length}</td></tr>`;
    universe.filter(t => t.sector === key).forEach(t => {
      h += `<tr data-sym="${esc(t.sym)}" class="urow" tabindex="0" aria-label="${esc(t.sym)}, ${esc(t.name)}, last ${fnum(t.last)}, ${fpct(t.pct)}. Press Enter to open chart" role="button"><td><b>${esc(t.sym)}</b></td><td>${esc(t.name)}</td><td>${fnum(t.last)}</td>` +
        `<td class="${CLS(t.pct)}">${ARROW(t.pct)} ${fchg(t.chg)}</td><td class="${CLS(t.pct)}">${fpct(t.pct)}</td>` +
        `<td><span class="stateb ${connection.live ? 'open' : ''}">${connection.live ? 'LIVE' : 'CLOSED'}</span></td>` +
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
    removeTracker(td.dataset.rm);
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
      td[2].textContent = fnum(t.last);
      td[3].className = CLS(t.pct);
      td[3].textContent = ARROW(t.pct) + ' ' + fchg(t.chg);
      td[4].className = CLS(t.pct);
      td[4].textContent = fpct(t.pct);
    });
  });
}
