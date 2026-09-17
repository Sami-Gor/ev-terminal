/**
 * heatmap.js — squarified treemap of tracked symbols grouped by sector.
 * Tile area encodes |% move|; hover ✕ removes the tracker.
 */
import { SECTORS, universe } from '../services/store.js';
import { bus } from '../services/store.js';
import { $, fnum, fnumOr, fpct, fpctOr, ARROW, arrowOr, clsOr } from '../utils/format.js';
import { tmLayout } from '../utils/indicators.mjs';
import { upRgb, downRgb } from '../utils/theme.js';
import { esc } from '../utils/sanitize.js';

const GROUP_HEIGHTS = { PURE: 250, BATT: 190 };

export function renderHeatmap() {
  const boxW = Math.max(($('heat').clientWidth || 900) - 2, 320);
  let h = '';
  for (const key of Object.keys(SECTORS)) {
    const members = universe.filter(t => t.sector === key)
      .map(t => ({ v: Math.max(Math.abs(Number.isFinite(t.pct) ? t.pct : 0), 0.12), t }));
    const sum = members.reduce((s, d) => s + d.v, 0);
    h += `<div class="hm-head"><b style="color:${SECTORS[key].color}">${SECTORS[key].label}</b> · n=${members.length} · Σ|chg%|=${fnum(sum, 1)}</div>`;
    h += `<div class="hm-box" style="height:${GROUP_HEIGHTS[key]}px">`;
    const rects = [];
    tmLayout([...members].sort((a, b) => b.v - a.v), 0, 0, boxW, GROUP_HEIGHTS[key], rects);
    rects.forEach(rc => {
      const p = Number.isFinite(rc.t.pct) ? rc.t.pct : null;
      const alpha = p === null ? 0.10 : Math.min(Math.abs(p) / 3, 1) * 0.72 + 0.10;
      const rgb = p > 0 ? upRgb() : p < 0 ? downRgb() : '58,61,66';
      const bg = `rgba(${rgb},${alpha})`;
      const priceText = fnumOr(rc.t.last);
      let inner = `<span class="s"${rc.h < 24 ? ' style="font-size:9.5px"' : ''}>${esc(rc.t.sym)}</span>`;
      if (rc.h >= 54 && rc.w >= 70) inner += `<span class="pr">${fnumOr(rc.t.last)}</span><span class="pc ${clsOr(p)}">${arrowOr(p)} ${fpctOr(p)}</span>`;
      else if (rc.h >= 34 && rc.w >= 46) inner += `<span class="pc ${clsOr(p)}">${arrowOr(p)} ${fpctOr(p)}</span>`;
      inner += `<span class="tx" data-rm="${esc(rc.t.sym)}" title="remove ${esc(rc.t.sym)} from trackers">✕</span>`;
      const pctText = p === null ? 'no data' : `${ARROW(p)} ${fpct(p)}`;
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
    if (tx) tx.addEventListener('click', e => { e.stopPropagation(); bus.emit('tracker:remove', tx.dataset.rm); });
  });
}

let resizeTimer = null;
export function initHeatmap() {
  renderHeatmap();
  bus.on('layout:applied', renderHeatmap);   // card order/visibility changes its container width
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderHeatmap, 150);
  });
}
