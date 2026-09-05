/**
 * metals.js — battery metals monitor (demo desk fixtures + ratio readout).
 */
import { AS_OF_SHORT } from '../services/store.js';
import { $, fnum, fchg, fpct, ARROW, CLS } from '../utils/format.js';
import { rngFor } from '../utils/demo-engine.js';

const METALS = [
  { code: 'LITH', sym: 'LI', name: 'Lithium Carbonate', unit: 'USD/t', last: 12480, chg: 215, pct: 1.75, rng: [11820, 12790] },
  { code: 'COBT', sym: 'CO', name: 'Cobalt (LME)', unit: 'USD/t', last: 24310, chg: -180, pct: -0.74, rng: [23900, 24870] },
  { code: 'NICK', sym: 'NI', name: 'Nickel (LME)', unit: 'USD/t', last: 16540, chg: 210, pct: 1.29, rng: [15980, 16720] },
  { code: 'COPR', sym: 'CU', name: 'Copper (LME)', unit: 'USD/t', last: 10235, chg: 85, pct: 0.84, rng: [10040, 10410] },
];

const state = { selected: 'LITH' };

function metalPath(code) {
  const r = rngFor(code + '|60');
  const out = [];
  let v = 0;
  for (let i = 0; i < 60; i++) { v += (r() - 0.47) * 0.9; out.push(v); }
  return out;
}

const METAL_HISTORY = {};
METALS.forEach(m => { METAL_HISTORY[m.code] = metalPath(m.code); });
METALS.forEach(m => {
  const h = METAL_HISTORY[m.code];
  const base = m.last / (1 + h[59] / 100);
  m.series = h.map(x => base * (1 + x / 100));
  m.rng60 = [Math.min(...m.series), Math.max(...m.series)];
});

export function renderMetals() {
  $('met-grid').innerHTML = METALS.map(m => `<div class="met ${state.selected === m.code ? 'sel' : ''}" data-c="${m.code}">
    <div class="sym">${m.code} <span class="un">· ${m.name} · ${m.unit}</span></div>
    <div class="px">${fnum(m.last, 0)}</div>
    <div class="ch ${CLS(m.pct)}">${ARROW(m.pct)} ${fchg(m.chg, 0)} (${fpct(m.pct)})</div>
    <div class="rng">60D ${fnum(m.rng60[0], 0)}–${fnum(m.rng60[1], 0)}</div></div>`).join('');
  $('met-grid').querySelectorAll('.met').forEach(el => el.addEventListener('click', () => {
    state.selected = el.dataset.c;
    renderMetals();
  }));
  const m = METALS.find(x => x.code === state.selected);
  const ser = m.series;
  const W = 560, H = 120, PT = 8, PB = 12;
  const lo = Math.min(...ser), hi = Math.max(...ser);
  const X = i => i * (W - 8) / 59 + 4;
  const Y = v => PT + (hi - v) / (hi - lo || 1) * (H - PT - PB);
  let s = `<text x="6" y="12" fill="#F28C00" font-size="10" font-family="inherit">${m.code} · 60 sessions · ${AS_OF_SHORT} window · index pts</text>`;
  const pts = ser.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  s += `<polyline points="${pts}" fill="none" stroke="${m.pct >= 0 ? '#00C176' : '#E5484D'}" stroke-width="1.4"/>`;
  $('met-svg').innerHTML = s;
  const [li, co, ni, cu] = METALS;
  $('met-cap').innerHTML = `<b style="color:var(--amber)">${state.selected}</b> selected`;
  $('met-kv').innerHTML = `LI/CO RATIO <b>${fnum(li.last / co.last, 3)}</b> = LITH/COBT (unitless) · LI−NI SPREAD <b class="${(li.last - ni.last) >= 0 ? 'up' : 'down'}">${fchg(li.last - ni.last, 0)}</b> USD/t ·
   LITH 60D <b>${fnum(li.rng60[0], 0)}–${fnum(li.rng60[1], 0)}</b> · COBT 60D <b>${fnum(co.rng60[0], 0)}–${fnum(co.rng60[1], 0)}</b> · NICK 60D <b>${fnum(ni.rng60[0], 0)}–${fnum(ni.rng60[1], 0)}</b> · COPR 60D <b>${fnum(cu.rng60[0], 0)}–${fnum(cu.rng60[1], 0)}</b>`;
}

export function initMetals() {
  renderMetals();
}
