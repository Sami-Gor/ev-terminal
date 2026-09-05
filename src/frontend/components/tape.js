/**
 * tape.js — scrolling ticker tape (macro refs + tracked universe).
 */
import { MACRO, universe, BYSYM, getTracker, connection } from '../services/store.js';
import { bus } from '../services/store.js';
import { $, fnum, fpct, ARROW, CLS } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

export function renderTape() {
  const seq = [...MACRO, ...universe];
  const item = x => {
    const p = x.pct;
    const ch = x.chg !== undefined ? x.chg : x.last * p / (100 + p);
    return `<span class="ti" ${BYSYM[x.sym] ? 'data-sym="' + esc(x.sym) + '"' : ''}><b>${esc(x.sym)}</b>` +
      `<span class="px">${fnum(x.last, x.dec ?? 2)}</span>` +
      `<span class="${CLS(p)}">${ARROW(p)} ${fpct(p)}</span>` +
      `<em>${x.state || (connection.live ? 'LIVE' : 'CLOSED')}</em></span>`;
  };
  const one = seq.map(item).join('');
  $('tape').innerHTML = one + one;
  const tapeItems = $('tape').children;               // hide marquee duplicate from AT
  for (let i = tapeItems.length / 2; i < tapeItems.length; i++) tapeItems[i].setAttribute('aria-hidden', 'true');
  $('tape').querySelectorAll('[data-sym]').forEach(el => {
    el.addEventListener('click', () => bus.emit('focus', el.dataset.sym));
  });
}

/** In-place tape refresh for tick flushes (keeps the CSS animation running). */
export function updateSymbols(syms) {
  syms.forEach(sym => {
    const t = getTracker(sym);
    if (!t) return;
    document.querySelectorAll(`#tape .ti[data-sym="${sym}"]`).forEach(el => {
      const px = el.querySelector('.px');
      const pc = el.querySelector('span.up,span.down,span.flat');
      const em = el.querySelector('em');
      if (px) px.textContent = fnum(t.last);
      if (pc) { pc.className = CLS(t.pct); pc.textContent = ARROW(t.pct) + ' ' + fpct(t.pct); }
      if (em) em.textContent = connection.live ? 'LIVE' : 'CLOSED';
    });
  });
}
