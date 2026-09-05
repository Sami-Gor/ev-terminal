/**
 * heatmap.js — squarified treemap of tracked symbols grouped by sector.
 * Tile area encodes |% move|; hover ✕ removes the tracker.
 */
import { SECTORS, universe } from '../services/store.js';
import { bus } from '../services/store.js';
import { removeTracker } from './trackers.js';
import { $, fnum, fpct, ARROW, CLS } from '../utils/format.js';
import { tmLayout } from '../utils/indicators.js';
import { upRgb, downRgb } from '../utils/theme.js';
import { esc } from '../utils/sanitize.js';

const GROUP_HEIGHTS = { PURE: 250, BATT: 190 };

export function renderHeatmap() {
  const boxW = Math.max(($('heat').clientWidth || 900) - 2, 320);
  let h = '';
  for (const key of Object.keys(SECTORS)) {
    const members = universe.filter(t => t.sector === key).map(t => ({ v: Math.max(Math.abs(t.pct), 0.12), t }));
    const sum = members.reduce((s, d) => s + d.v, 0);
    h += `<div class="hm-head"><b style="color:${SECTORS[key].color}">${SECTORS[key].label}</b> · n=${members.length} · Σ|chg%|=${fnum(sum, 1)}</div>`;
    h += `<div class="hm-box" style="height:${GROUP_HEIGHTS[key]}px">`;
    const rects = [];
    tmLayout([...members].sort((a, b) => b.v - a.v), 0, 0, boxW, GROUP_HEIGHTS[key], rects);
    rects.forEach(rc => {
      const p = rc.t.pct;
      const alpha = Math.min(Math.abs(p) / 3, 1) * 0.72 + 0.10;
      const rgb = p > 0 ? upRgb() : p < 0 ? downRgb() : '58,61,66';
      const bg = `rgba(${rgb},${alpha})`;
      const priceText = fnum(rc.t.last);
      let inner = `<span class="s"${rc.h < 24 ? ' style="font-size:9.5px"' : ''}>${esc(rc.t.sym)}</span>`;
      if (rc.h >= 54 && rc.w >= 70) inner += `<span class="pr">${fnum(rc.t.last)}</span><span class="pc ${CLS(p)}">${ARROW(p)} ${fpct(p)}</span>`;
      else if (rc.h >= 34 && rc.w >= 46) inner += `<span class="pc ${CLS(p)}">${ARROW(p)} ${fpct(p)}</span>`;
      inner += `<span class="tx" data-rm="${esc(rc.t.sym)}" title="remove ${esc(rc.t.sym)} from trackers">✕</span>`;
      const pctText = `${ARROW(p)} ${fpct(p)}`;
      h += `<div class="tile" role="button" tabindex="0" data-sym="${esc(rc.t.sym)}" aria-label="${esc(rc.t.sym)} ${pctText}, price ${priceText} — press Enter to open chart" style="left:${rc.x}px;top:${rc.y}px;width:${rc.w}px;height:${rc.h}px;background:${bg}">${inner}</div>`;
    });
    h += '</div>';
  }
  $('heat').innerHTML = h;
  $('heat').querySelectorAll('.tile').forEach(el => {
    el.addEventListener('click', () => bus.emit('focus', el.dataset.sym));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bus.emit('focus', el.dataset.sym); }
    });
    const tx = el.querySelector('.tx');
    if (tx) tx.addEventListener('click', e => { e.stopPropagation(); removeTracker(tx.dataset.rm); });
  });
}

let resizeTimer = null;
export function initHeatmap() {
  renderHeatmap();
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderHeatmap, 150);
  });
}
