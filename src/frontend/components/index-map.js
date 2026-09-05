/**
 * index-map.js — global index map grouped by region (no area encoding).
 */
import { MACRO } from '../services/store.js';
import { $, fnum, fpct, ARROW, CLS } from '../utils/format.js';

const REGIONS = ['AMERICAS', 'EUROPE', 'APAC', 'BATT METALS'];

export function renderMap() {
  let h = '';
  for (const region of REGIONS) {
    const rows = MACRO.filter(m => m.reg === region);
    if (!rows.length) continue;
    h += `<div class="map-reg">${region}</div><table class="mini"><tr><th>SYM</th><th>NAME</th><th>LAST</th><th>CHG%</th><th>STATE</th><th>LOCAL</th><th>AS-OF</th></tr>`;
    rows.forEach(m => {
      h += `<tr><td><b>${m.sym}</b></td><td>${m.name} <span style="color:var(--dim2)">· ${m.src}</span></td>` +
        `<td>${fnum(m.last, m.dec ?? 2)}</td><td class="${CLS(m.pct)}">${ARROW(m.pct)} ${fpct(m.pct)}</td>` +
        `<td>${m.state}</td><td data-tz="${m.tz}">--:--</td><td>16:05ET</td></tr>`;
    });
    h += '</table>';
  }
  $('map').innerHTML = h;
}
