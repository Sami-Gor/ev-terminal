/**
 * tape.js — scrolling ticker tape (tracked EV universe).
 */
import { universe, BYSYM, getTracker, stateLabel } from '../services/store.js';
import { bus } from '../services/store.js';
import { $, fnumOr, fpctOr, arrowOr, clsOr, ARROW, fpct } from '../utils/format.js';
import { esc } from '../utils/sanitize.js';

export function renderTape() {
  const seq = [...universe];
  const item = x => {
    const p = Number.isFinite(x.pct) ? x.pct : null;
    return `<span class="ti" ${BYSYM[x.sym] ? 'data-sym="' + esc(x.sym) + '"' : ''}><b>${esc(x.sym)}</b>` +
      `<span class="px">${fnumOr(x.last, x.dec ?? 2)}</span>` +
      `<span class="${clsOr(p)}">${arrowOr(p)} ${fpctOr(p)}</span>` +
      `<em>${x.state || stateLabel()}</em></span>`;
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
      if (px) px.textContent = fnumOr(t.last);
      if (pc) { pc.className = clsOr(t.pct); pc.textContent = Number.isFinite(t.pct) ? ARROW(t.pct) + ' ' + fpct(t.pct) : '—'; }
      if (em) em.textContent = stateLabel();
    });
  });
}
