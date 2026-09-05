/**
 * sector.js — normalized intraday lines per sector (modeled path between
 * open and the live Δ% endpoint).
 */
import { SECTORS, universe } from '../services/store.js';
import { $, fnum, fchg, fpct, ARROW, CLS } from '../utils/format.js';
import { intradayPath } from '../utils/indicators.js';
import { rngFor } from '../utils/demo-engine.js';
import { upColor } from '../utils/theme.js';

export function renderSector() {
  const W = 420, H = 170, PL = 30, PR = 8, PT = 8, PB = 18;
  const series = {};
  for (const key of Object.keys(SECTORS)) {
    const members = universe.filter(t => t.sector === key);
    const avg = new Array(24).fill(0);
    members.forEach(t => {
      intradayPath(t.pct, t.sym + '|i', rngFor).forEach((v, j) => { avg[j] += v / members.length; });
    });
    series[key] = avg;
  }
  const all = Object.keys(SECTORS).flatMap(k => series[k]);
  const lo = Math.min(...all, 0), hi = Math.max(...all, 0);
  const Y = v => PT + (hi - v) / (hi - lo || 1) * (H - PT - PB);
  const X = j => PL + j * (W - PL - PR) / 23;
  let s = `<line x1="${PL}" x2="${W - PR}" y1="${Y(0)}" y2="${Y(0)}" stroke="#3d444d" stroke-dasharray="2 3"/>`;
  s += `<text x="2" y="${Y(hi) + 8}" fill="#6E7681" font-size="9" font-family="inherit">+${fnum(hi, 1)}%</text>`;
  s += `<text x="2" y="${Y(lo) - 2}" fill="#6E7681" font-size="9" font-family="inherit">${fchg(lo, 1)}%</text>`;
  for (const key of Object.keys(SECTORS)) {
    const pts = series[key].map((v, j) => `${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const stroke = key === 'PURE' ? upColor() : SECTORS[key].color;
    s += `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.4"/>`;
  }
  s += `<text x="${X(0)}" y="${H - 4}" fill="#6E7681" font-size="9" font-family="inherit">open</text>`;
  s += `<text x="${X(23)}" y="${H - 4}" fill="#6E7681" font-size="9" text-anchor="end" font-family="inherit">close</text>`;
  $('sect-svg').innerHTML = s;
  $('sect-legend').innerHTML = Object.keys(SECTORS).map(key =>
    `<span><span class="sw" style="background:${key === 'PURE' ? upColor() : SECTORS[key].color}"></span>${SECTORS[key].label} <b class="${CLS(series[key][23])}">${fpct(series[key][23])}</b></span>`).join('');
  $('sect-table').innerHTML = '<tr><th>SECTOR</th><th>AVG CHG</th><th>n</th><th>WEIGHTING</th><th>AS-OF</th></tr>' +
    Object.keys(SECTORS).map(key =>
      `<tr><td style="color:${key === 'PURE' ? upColor() : SECTORS[key].color}">${SECTORS[key].label}</td><td class="${CLS(series[key][23])}">${ARROW(series[key][23])} ${fpct(series[key][23])}</td><td>${universe.filter(t => t.sector === key).length}</td><td>equal-weight</td><td>16:05 ET</td></tr>`).join('');
}
