/**
 * focus-chart.js — the Focus Chart: single view, multi-timeframe (MTF) view,
 * market-structure overlay, supply/demand zones, risk calculator with
 * draggable Entry/SL/TP lines, and the pinned-bar inspector.
 */
import { chartState, getTracker } from '../services/store.js';
import { bus } from '../services/store.js';
import { API_BASE, fetchJson } from '../services/api.js';
import { DATES } from '../utils/demo-engine.js';
import { atr14, structurePivots, detectZones } from '../utils/indicators.js';
import { $, fnum, fchg, fpct, fvol, fmtBig, ARROW, CLS } from '../utils/format.js';
import { upColor, downColor, upRgb, downRgb } from '../utils/theme.js';

// ---- module state -------------------------------------------------------
let chartMode = 'single';
const mtfCache = {};
const mtfState = { panels: null, lines: null, label: null };
let liveRefs = null;
const risk = {
  bal: 10000, pct: 1, atrMult: 1.5,
  entry: null, sl: null, atr: null, sym: null,
  side: 'long', dist: 0, riskD: 0, shares: 0, value: 0, drag: null, scale: null,
};

// ---- risk calculator ----------------------------------------------------
function riskUpdate(t, H) {
  risk.atr = atr14(H);
  if (risk.sym !== t.sym || risk.entry == null) {          // auto-fill on symbol switch
    risk.sym = t.sym;
    risk.entry = t.last;
    risk.sl = risk.atr ? risk.entry - risk.atrMult * risk.atr : risk.entry * 0.97;
    const entryInput = $('rk-entry');
    if (entryInput) entryInput.value = risk.entry.toFixed(2);
  }
  risk.side = risk.sl != null && risk.sl > risk.entry ? 'short' : 'long';
  risk.dist = Math.abs(risk.entry - (risk.sl != null ? risk.sl : risk.entry));
  risk.riskD = risk.bal * risk.pct / 100;
  risk.shares = risk.dist > 0 ? Math.floor(risk.riskD / risk.dist) : 0;
  risk.value = risk.shares * risk.entry;
}

function riskTargets() {
  const dir = risk.side === 'short' ? -1 : 1;
  return [1, 2, 3].map(k => risk.entry + dir * k * risk.dist);
}

function updateRiskOut() {
  const targets = riskTargets();
  const el = $('rk-out');
  if (!el) return;
  const fmtT = v => (v != null && isFinite(v)) ? fnum(v) : '—';
  el.innerHTML = `RISK <b>${fmtBig(risk.riskD)}</b> · SL <b class="down">${risk.sl != null ? fnum(risk.sl) : '—'}</b>` +
    ` · SIZE <b>${risk.shares.toLocaleString('en-US')} sh</b> <span style="color:var(--dim2)">(${fmtBig(risk.value)})</span>` +
    ` · TP <b>${fmtT(targets[0])}</b> / <b>${fmtT(targets[1])}</b> / <b>${fmtT(targets[2])}</b>`;
}

// ---- MTF (multi-timeframe) ---------------------------------------------
const mtfPending = new Set();

function fetchMTF(sym) {
  ['4h', '15m'].forEach(timeframe => {
    const key = sym + '|' + timeframe;
    if (mtfCache[key] !== undefined) return;
    mtfCache[key] = null;                                  // pending marker
    fetchJson(`${API_BASE}/api/history/${encodeURIComponent(sym)}?timeframe=${timeframe}`)
      .then(data => {
        mtfCache[key] = data.bars || [];
        if (chartMode === 'mtf' && chartState.focus === sym) renderChart();
      })
      .catch(() => {
        mtfCache[key] = [];
        if (chartMode === 'mtf' && chartState.focus === sym) renderChart();
      });
  });
}

function mtfCross(ts) {
  if (!mtfState.panels) return;
  mtfState.panels.forEach((p, i) => {
    const line = mtfState.lines && mtfState.lines[i];
    if (!line) return;
    const frac = Math.min(Math.max((ts - p.t0) / ((p.t1 - p.t0) || 1), 0), 1);
    const x = p.px0 + frac * (p.px1 - p.px0);
    line.setAttribute('x1', x.toFixed(1));
    line.setAttribute('x2', x.toFixed(1));
    line.setAttribute('y1', p.y0.toFixed(1));
    line.setAttribute('y2', p.y1.toFixed(1));
    line.setAttribute('opacity', ts >= p.t0 && ts <= p.t1 ? 0.9 : 0.3);
  });
  if (mtfState.label) mtfState.label.textContent = '◈ ' + new Date(ts).toISOString().slice(5, 16).replace('T', ' ');
}

function mtfHideCross() {
  if (mtfState.lines) mtfState.lines.forEach(l => l.setAttribute('opacity', 0));
  if (mtfState.label) mtfState.label.textContent = '';
}

function renderMTF(t) {
  const H = t.hist, n = H.length;
  fetchMTF(t.sym);
  $('ch-title').textContent = t.sym + ' · MTF · D / 4H / 15M';
  const keys = document.querySelector('#chart .ch-keys');
  if (keys) keys.innerHTML = 'hover a panel — the crosshair syncs across D / 4H / 15M';
  const dailyLast = H[n - 1].c, dailyPrev = H[n - 2].c;
  const bars4h = mtfCache[t.sym + '|4h'];
  const bars15m = mtfCache[t.sym + '|15m'];
  $('ch-readout').innerHTML =
    `<span><i>D</i> <b class="${CLS(dailyLast - dailyPrev)}">${fnum(dailyLast)}</b></span>` +
    (bars4h && bars4h.length ? `<span><i>4H</i> <b class="${CLS(bars4h.at(-1).c - bars4h.at(-2).c)}">${fnum(bars4h.at(-1).c)}</b></span>` : '') +
    (bars15m && bars15m.length ? `<span><i>15M</i> <b class="${CLS(bars15m.at(-1).c - bars15m.at(-2).c)}">${fnum(bars15m.at(-1).c)}</b></span>` : '') +
    `<span><i>prev close</i> <b>${fnum(t.prevClose)}</b></span>`;
  $('ch-sumvol').textContent = '';

  const W = 820, PL = 8, PR = 60, plotW = W - PL - PR;
  const specs = [
    { tf: 'D', bars: H.map(b => ({ t: Date.parse(b.dt), c: b.c })), y0: 10, y1: 142, label: 'D · DAILY — macro trend & major levels', swings: false },
    { tf: '4H', bars: bars4h, y0: 152, y1: 238, label: '4H · MARKET STRUCTURE & SWINGS', swings: true },
    { tf: '15M', bars: bars15m, y0: 248, y1: 316, label: '15M · EXECUTION PRICE ACTION', swings: false },
  ];
  let s = '';
  const panels = [];
  for (const sp of specs) {
    s += `<text x="${PL}" y="${sp.y0 + 9}" fill="#F28C00" font-size="9.5" font-family="inherit">${sp.label}</text>`;
    if (!sp.bars || sp.bars.length < 2) {
      const msg = sp.bars === null ? 'loading ' + sp.tf + ' feed …' : 'no intraday data for this symbol';
      s += `<text x="${PL + plotW / 2}" y="${(sp.y0 + sp.y1) / 2}" fill="#6E7681" font-size="11" text-anchor="middle" font-family="inherit">${msg}</text>`;
      continue;
    }
    const times = sp.bars.map(b => b.t != null ? b.t : Date.parse(b.date ?? b.dt));
    const closes = sp.bars.map(b => b.c);
    const m = closes.length;
    const t0 = times[0], t1 = times[m - 1];
    const lo = Math.min(...closes), hi = Math.max(...closes);
    const pad = (hi - lo) * 0.14 || hi * 0.002;
    const lo2 = lo - pad, hi2 = hi + pad;
    const pTop = sp.y0 + 14, pBot = sp.y1 - 4;
    const Y = v => pTop + (hi2 - v) / (hi2 - lo2) * (pBot - pTop);
    const X = tt => PL + (tt - t0) / ((t1 - t0) || 1) * plotW;
    if (t.prevClose != null && t.prevClose > lo2 && t.prevClose < hi2) {
      s += `<line x1="${PL}" x2="${PL + plotW}" y1="${Y(t.prevClose).toFixed(1)}" y2="${Y(t.prevClose).toFixed(1)}" stroke="#8a5a10" stroke-dasharray="4 3"/>`;
      s += `<text x="${W - PR + 6}" y="${(Y(t.prevClose) + 3).toFixed(1)}" fill="#8a5a10" font-size="8.5" font-family="inherit">PC</text>`;
    }
    s += `<line x1="${PL}" x2="${PL + plotW}" y1="${Y(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" stroke="#26282b" stroke-dasharray="2 3"/>`;
    s += `<text x="${W - PR + 6}" y="${(Y(hi) + 3).toFixed(1)}" fill="#3d444d" font-size="8.5" font-family="inherit">HI</text>`;
    s += `<line x1="${PL}" x2="${PL + plotW}" y1="${Y(lo).toFixed(1)}" y2="${Y(lo).toFixed(1)}" stroke="#26282b" stroke-dasharray="2 3"/>`;
    s += `<text x="${W - PR + 6}" y="${(Y(lo) + 3).toFixed(1)}" fill="#3d444d" font-size="8.5" font-family="inherit">LO</text>`;
    const pts = closes.map((c, i) => X(times[i]).toFixed(1) + ',' + Y(c).toFixed(1)).join(' ');
    const up = closes[m - 1] >= closes[0];
    s += `<polyline class="price-line" data-panel="${sp.tf}" points="${pts}" fill="none" stroke="${up ? upColor() : downColor()}" stroke-width="1.2"/>`;
    if (sp.swings) {
      for (let i = 2; i < m - 2; i++) {
        const window = closes.slice(i - 2, i + 3);
        if (closes[i] === Math.max(...window) || closes[i] === Math.min(...window)) {
          s += `<circle cx="${X(times[i]).toFixed(1)}" cy="${Y(closes[i]).toFixed(1)}" r="1.8" fill="${closes[i] === Math.max(...window) ? downColor() : upColor()}" opacity="0.85"/>`;
        }
      }
    }
    const lastY = Y(closes[m - 1]);
    s += `<circle class="live-marker" data-panel="${sp.tf}" cx="${(PL + plotW).toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" fill="#F28C00"/>`;
    s += `<text class="live-tag" data-panel="${sp.tf}" x="${W - PR + 6}" y="${(lastY + 3).toFixed(1)}" fill="#F28C00" font-size="9" font-family="inherit">${fnum(closes[m - 1])}</text>`;
    const fmtT = tt => {
      const d = new Date(tt);
      return sp.tf === 'D' ? d.toISOString().slice(5, 10) : d.toISOString().slice(5, 16).replace('T', ' ');
    };
    s += `<text x="${PL}" y="${sp.y1}" fill="#3d444d" font-size="8.5" font-family="inherit">${fmtT(t0)}</text>`;
    s += `<text x="${PL + plotW}" y="${sp.y1}" fill="#3d444d" font-size="8.5" text-anchor="end" font-family="inherit">${fmtT(t1)}</text>`;
    panels.push({
      y0: pTop, y1: pBot, t0, t1, px0: PL, px1: PL + plotW, tf: sp.tf,
      lo2, hi2, pTop, pBot,
      poly: null, marker: null, tag: null,   // resolved after innerHTML assignment
    });
  }
  for (let i = 0; i < panels.length; i++) {
    s += `<line class="mxl" data-i="${i}" x1="0" x2="0" y1="0" y2="0" stroke="#F28C00" stroke-dasharray="3 3" opacity="0"/>`;
  }
  s += `<text class="mxt" x="${PL}" y="328" fill="#F28C00" font-size="9" font-family="inherit"></text>`;
  $('ch-svg').innerHTML = s;
  mtfState.panels = panels;
  panels.forEach(p => {
    p.poly = $('ch-svg').querySelector(`.price-line[data-panel="${p.tf}"]`);
    p.marker = $('ch-svg').querySelector(`.live-marker[data-panel="${p.tf}"]`);
    p.tag = $('ch-svg').querySelector(`.live-tag[data-panel="${p.tf}"]`);
  });
  mtfState.lines = [...$('ch-svg').querySelectorAll('.mxl')];
  mtfState.label = $('ch-svg').querySelector('.mxt');
}

let lastFullRender = 0;

function throttledFullRender() {
  const now = performance.now();
  if (now - lastFullRender < 250) return false;    // coalesce range escapes to ≤4 renders/s
  lastFullRender = now;
  renderChart();
  return true;
}

/**
 * In-place live-tick patch for the focused chart. When the price leaves the
 * rendered range a full re-render is scheduled (throttled to 4/s).
 */
export function applyLiveTick(syms) {
  const t = getTracker(chartState.focus);
  if (!t || !t.hist || !t.hist.length) return false;
  if (!syms.includes(t.sym)) return true;          // other symbol's tick — nothing to patch
  if (chartMode === 'mtf') {
    const okM = mtfApplyLive(t);
    if (!okM) return throttledFullRender();
    return true;
  }
  const lr = liveRefs;
  if (!lr || lr.sym !== t.sym) return false;
  const price = t.last;
  if (price < lr.lo || price > lr.hi) return throttledFullRender();
  const y = lr.PT + lr.ph - (price - lr.lo) / (lr.hi - lr.lo) * lr.ph;
  const pts = lr.poly.getAttribute('points');
  const cut = pts.lastIndexOf(' ');
  lr.poly.setAttribute('points', pts.slice(0, cut + 1) + lr.xLast.toFixed(1) + ',' + y.toFixed(1));
  const atLastBar = chartState.cross >= lr.n - 1;
  if (atLastBar) {
    lr.marker.setAttribute('cy', y.toFixed(1));
    lr.tag.setAttribute('y', (y + 3).toFixed(1));
    lr.tag.textContent = '◆' + fnum(price);
  }
  const lastBar = t.hist[t.hist.length - 1];
  if (lr.volBar && lastBar.v <= lr.maxVol) {
    const bh = lastBar.v / lr.maxVol * lr.vh;
    lr.volBar.setAttribute('y', (lr.volBase + bh).toFixed(1));
    lr.volBar.setAttribute('height', Math.max(bh, 1).toFixed(1));
  }
  const dp = t.prevClose ? (price - t.prevClose) / t.prevClose * 100 : 0;
  if (lr.readC) {
    lr.readC.textContent = fnum(price);
    lr.readC.className = 'live-c ' + (dp >= 0 ? 'up' : 'down');
  }
  if (lr.readD) {
    lr.readD.textContent = fchg(dp) + '%';
    lr.readD.className = 'live-d ' + (dp >= 0 ? 'up' : 'down');
  }
  return true;
}

/** In-place MTF tick patch: move each panel's last point to the live price. */
function mtfApplyLive(t) {
  let patched = true;
  for (const p of mtfState.panels) {
    if (!p.poly) { patched = false; continue; }
    if (t.last < p.lo2 || t.last > p.hi2) { patched = false; continue; }
    const y = p.pTop + (p.hi2 - t.last) / (p.hi2 - p.lo2) * (p.pBot - p.pTop);
    const pts = p.poly.getAttribute('points');
    const cut = pts.lastIndexOf(' ');
    p.poly.setAttribute('points', pts.slice(0, cut + 1) + p.px1.toFixed(1) + ',' + y.toFixed(1));
    if (p.marker) p.marker.setAttribute('cy', y.toFixed(1));
    if (p.tag) p.tag.setAttribute('y', (y + 3).toFixed(1));
  }
  return patched;
}

// ---- single view --------------------------------------------------------
function renderSingle(t) {
  const H = t.hist, n = H.length;
  const i = Math.min(chartState.cross, n - 1);
  const S = H[i];
  riskUpdate(t, H);
  $('ch-title').textContent = `${t.sym} · ${n} TRADING SESSIONS`;
  const dstr = H[i].dt || DATES[i].toISOString().slice(0, 10);
  const dp = i > 0 ? (S.c / H[i - 1].c - 1) * 100 : (S.c / S.o - 1) * 100;
  $('ch-readout').innerHTML =
    `<span><i>O</i> <b>${fnum(S.o)}</b></span><span><i>H</i> <b>${fnum(S.h)}</b></span><span><i>L</i> <b>${fnum(S.l)}</b></span>` +
    `<span><i>C</i> <b class="live-c ${CLS(dp)}">${fnum(S.c)}</b></span><span><i>Δ</i> <b class="live-d ${CLS(dp)}">${fchg(dp)}%</b></span>` +
    `<span><i>VOL</i> <b>${fvol(S.v)}</b></span><span><i>DATE</i> <b>${dstr}</b></span>`;
  $('ch-range').textContent = (H[0].dt || DATES[0].toISOString().slice(0, 10)) + ' → ' + (H[n - 1].dt || DATES[59].toISOString().slice(0, 10));
  $('ch-52w').textContent = '52W ' + fnum(t.r52[0]) + '–' + fnum(t.r52[1]);
  $('ch-sumvol').textContent = 'Σvol ' + fvol(H.reduce((s, x) => s + x.v, 0));

  const W = 820, HG = 330, PL = 8, PR = 64, PT = 10, PB = 40;
  const ph = HG - PT - PB - 64, vh = 58;
  let lo = Math.min(...H.map(s2 => s2.l)), hi = Math.max(...H.map(s2 => s2.h));
  const targets = riskTargets();
  const riskLevels = [risk.entry, risk.sl, targets[0], targets[1], targets[2]].filter(v => v != null && isFinite(v));
  if (risk.entry != null && riskLevels.length) {
    hi = Math.max(hi, ...riskLevels);
    lo = Math.min(lo, ...riskLevels);
  }
  const y2v = y => PT + ph - (y - lo) / (hi - lo) * ph;
  const X = i2 => PL + i2 * (W - PL - PR) / (n - 1);
  let s = '';
  for (let g = 0; g <= 4; g++) {
    const gv = lo + (hi - lo) * (1 - g / 4);
    s += `<line x1="${PL}" x2="${W - PR}" y1="${y2v(gv)}" y2="${y2v(gv)}" stroke="#1a1c1e"/>`;
    s += `<text x="${W - PR + 6}" y="${y2v(gv) + 3}" fill="#6E7681" font-size="10" font-family="inherit">${fnum(gv, fnum(hi, 0).length > 5 ? 0 : 2)}</text>`;
  }
  const maxVol = Math.max(...H.map(x => x.v));
  H.forEach((x, j) => {
    const bh = x.v / maxVol * vh;
    s += `<rect class="${j === n - 1 ? 'vol-last' : ''}" x="${X(j) - 3.5}" y="${HG - PB - vh + bh}" width="7" height="${Math.max(bh, 1)}" fill="${j === i ? '#F28C00' : '#8a5a1099'}"/>`;
  });
  const structureOn = $('ovl-structure') && $('ovl-structure').checked;
  if (structureOn) {
    for (const z of detectZones(H)) {
      const zx = X(z.i), zTop = y2v(z.hi), zBot = y2v(z.lo);
      const zRgb = z.demand ? upRgb() : downRgb();
      s += `<rect x="${zx.toFixed(1)}" y="${zTop.toFixed(1)}" width="${(W - PR - zx).toFixed(1)}" height="${Math.max(zBot - zTop, 2).toFixed(1)}" fill="rgba(${zRgb},0.13)" stroke="rgba(${zRgb},0.35)" stroke-width="0.6"/>`;
      s += `<text x="${(zx + 4).toFixed(1)}" y="${(zTop + 9).toFixed(1)}" font-size="8" fill="${z.demand ? upColor() : downColor()}" font-family="inherit">${z.demand ? 'DEMAND' : 'SUPPLY'}</text>`;
    }
  }
  const pts = H.map((x, j) => `${X(j).toFixed(1)},${y2v(x.c).toFixed(1)}`).join(' ');
  const up = H[n - 1].c >= H[0].c;
  s += `<polyline class="price-line" points="${pts}" fill="none" stroke="${up ? upColor() : downColor()}" stroke-width="1.6"/>`;
  if (structureOn) {
    const pivots = structurePivots(H);
    if (pivots.length > 1) {
      s += `<polyline points="${pivots.map(p => X(p.i).toFixed(1) + ',' + y2v(p.p).toFixed(1)).join(' ')}" fill="none" stroke="#6E7681" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.7"/>`;
    }
    for (const p of pivots) {
      const isHigh = p.t === 'H';
      const col = (p.tag === 'HH' || p.tag === 'HL') ? 'var(--green)' : ((p.tag === 'LH' || p.tag === 'LL') ? 'var(--red)' : 'var(--dim)');
      s += `<text x="${X(p.i).toFixed(1)}" y="${(y2v(p.p) + (isHigh ? -5 : 11)).toFixed(1)}" font-size="8.5" fill="${col}" text-anchor="middle" font-family="inherit">${p.tag}</text>`;
    }
  }
  // risk overlay: draggable entry / stop / R-multiple target lines
  risk.scale = { lo, hi, PT, ph };
  const riskLines = [
    { id: 'ENTRY', v: risk.entry, c: '#58A6FF', lab: 'ENTRY', o: 0.95 },
    { id: 'SL', v: risk.sl, c: downColor(), lab: 'SL', o: 0.95 },
    { id: 'TP1', v: targets[0], c: upColor(), lab: 'TP 1:1', o: 0.5 },
    { id: 'TP2', v: targets[1], c: upColor(), lab: 'TP 1:2', o: 0.75 },
    { id: 'TP3', v: targets[2], c: upColor(), lab: 'TP 1:3', o: 1 },
  ];
  for (const line of riskLines) {
    if (line.v == null || !isFinite(line.v)) continue;
    const yy = Math.max(PT, Math.min(PT + ph, y2v(line.v)));
    s += `<line class="riskline" data-line="${line.id}" x1="${PL}" x2="${W - PR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${line.c}" stroke-width="1.1" opacity="${line.o}"/>`;
    s += `<line class="riskhit" data-line="${line.id}" x1="${PL}" x2="${W - PR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#000" stroke-opacity="0" stroke-width="10" style="cursor:ns-resize"/>`;
    s += `<text x="${W - PR + 6}" y="${(yy + 3).toFixed(1)}" font-size="8.5" fill="${line.c}" font-family="inherit">${line.lab} ${fnum(line.v)}</text>`;
  }
  updateRiskOut();
  const atrLabel = $('rk-atrv');
  if (atrLabel) atrLabel.textContent = risk.atr ? fnum(risk.atr) : '—';
  for (let j = 0; j < n; j += 12) {
    const dt = (H[j].dt || DATES[j].toISOString().slice(5, 10)).slice(5, 10);
    s += `<text x="${X(j)}" y="${HG - PB + 14}" fill="#6E7681" font-size="9.5" text-anchor="middle" font-family="inherit">${dt}</text>`;
  }
  s += `<text x="${X(n - 1)}" y="${HG - PB + 28}" fill="#3d444d" font-size="9.5" text-anchor="middle" font-family="inherit">now</text>`;
  const cx = X(i);
  s += `<line x1="${cx}" x2="${cx}" y1="${PT}" y2="${HG - PB}" stroke="#F28C00" stroke-dasharray="3 3"/>`;
  s += `<circle class="live-marker" cx="${cx}" cy="${y2v(S.c)}" r="3.2" fill="#F28C00"/>`;
  s += `<text class="live-tag" x="${W - PR + 6}" y="${y2v(S.c) + 3}" fill="#F28C00" font-size="10" font-family="inherit">◆${fnum(S.c)}</text>`;
  $('ch-svg').innerHTML = s;

  // live refs for in-place tick patching (no full re-render per tick)
  liveRefs = {
    sym: t.sym, n, lo, hi, PT, ph, vh, maxVol,
    volBase: HG - PB - vh, prevClose: t.prevClose, xLast: X(n - 1),
    poly: $('ch-svg').querySelector('.price-line'),
    marker: $('ch-svg').querySelector('.live-marker'),
    tag: $('ch-svg').querySelector('.live-tag'),
    volBar: $('ch-svg').querySelector('.vol-last'),
    readC: $('ch-readout').querySelector('.live-c'),
    readD: $('ch-readout').querySelector('.live-d')
  };

  const inspector = $('chart').querySelector('.inspector');
  if (chartState.pinned !== null) {
    const P = H[chartState.pinned];
    const pd = chartState.pinned > 0 ? (P.c / H[chartState.pinned - 1].c - 1) * 100 : (P.c / P.o - 1) * 100;
    const html = `<div class="inspector"><h4>INSPECTOR · PINNED ${t.sym} @ ${H[chartState.pinned].dt || DATES[chartState.pinned].toISOString().slice(0, 10)}</h4>` +
      `<div class="row"><i>OPEN</i><b>${fnum(P.o)}</b></div><div class="row"><i>HIGH</i><b>${fnum(P.h)}</b></div>` +
      `<div class="row"><i>LOW</i><b>${fnum(P.l)}</b></div><div class="row"><i>CLOSE</i><b class="${CLS(pd)}">${fnum(P.c)}</b></div>` +
      `<div class="row"><i>SESSION Δ</i><b class="${CLS(pd)}">${fchg(pd)}%</b></div><div class="row"><i>VOLUME</i><b>${fvol(P.v)}</b></div>` +
      `<div class="row"><i>RANGE</i><b>${fnum(P.l)}–${fnum(P.h)}</b></div>` +
      `<div class="row" style="margin-top:4px"><i></i><span class="ch-keys"><kbd>Esc</kbd> unpin</span></div></div>`;
    if (inspector) inspector.outerHTML = html;
    else $('chart').insertAdjacentHTML('beforeend', html);
  } else if (inspector) inspector.remove();
}

// ---- public entry -------------------------------------------------------
export function renderChart() {
  const t = getTracker(chartState.focus);
  if (!t || !t.hist || !t.hist.length) {          // self-healing loading state
    $('ch-title').textContent = (t ? t.sym : '') + ' · LOADING HISTORY…';
    $('ch-readout').innerHTML = '';
    $('ch-sumvol').textContent = '';
    $('ch-svg').innerHTML = `<text x="410" y="165" fill="#6E7681" font-size="13" text-anchor="middle" font-family="inherit">awaiting /api/history/${t ? t.sym : ''} …</text>`;
    return;
  }
  if (chartMode === 'mtf') { renderMTF(t); return; }
  renderSingle(t);
}

/** Current risk snapshot (used by the journal's LOG TRADE button). */
export function getRiskSnapshot() {
  return {
    sym: risk.sym, type: risk.side === 'short' ? 'SHORT' : 'LONG',
    entry: risk.entry, sl: risk.sl,
    tp: riskTargets()[1],
    riskDist: risk.dist, riskD: risk.riskD,
  };
}

// ---- controls & listeners -----------------------------------------------
export function initChartControls() {
  $('tf-toggle').addEventListener('click', () => {
    chartMode = chartMode === 'single' ? 'mtf' : 'single';
    const b = $('tf-toggle');
    b.textContent = chartMode === 'mtf' ? 'VIEW: MTF (D·4H·15M)' : 'VIEW: SINGLE';
    b.classList.toggle('on', chartMode === 'mtf');
    const keys = document.querySelector('#chart .ch-keys');
    if (keys) keys.innerHTML = chartMode === 'mtf'
      ? 'hover a panel — the crosshair syncs across D / 4H / 15M'
      : '<kbd>←</kbd><kbd>→</kbd> move crosshair · <kbd>Enter</kbd> pins Inspector · <kbd>Esc</kbd> unpin';
    mtfHideCross();
    renderChart();
  });
  $('ovl-structure').addEventListener('change', () => {
    if (chartMode !== 'mtf') renderChart();
  });

  // keyboard crosshair (single view)
  document.addEventListener('keydown', e => {
    if (chartMode === 'mtf') return;
    const focused = getTracker(chartState.focus);
    const lastIdx = focused && focused.hist && focused.hist.length ? focused.hist.length - 1 : 59;
    if (e.key === 'ArrowLeft') { chartState.cross = Math.max(0, chartState.cross - 1); renderChart(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { chartState.cross = Math.min(lastIdx, chartState.cross + 1); renderChart(); e.preventDefault(); }
    else if (e.key === 'Enter') { chartState.pinned = Math.min(chartState.cross, lastIdx); renderChart(); e.preventDefault(); }
    else if (e.key === 'Escape') { chartState.pinned = null; renderChart(); }
  });

  // MTF synchronized crosshair (hover)
  const svgEl = $('ch-svg');
  svgEl.addEventListener('mousemove', e => {
    if (chartMode !== 'mtf' || !mtfState.panels || !mtfState.panels.length) return;
    const rect = svgEl.getBoundingClientRect();
    const vx = (e.clientX - rect.left) / rect.width * 820;
    const vy = (e.clientY - rect.top) / rect.height * 330;
    const p = mtfState.panels.find(q => vy >= q.y0 && vy <= q.y1);
    if (!p) { mtfHideCross(); return; }
    const frac = Math.min(Math.max((vx - p.px0) / (p.px1 - p.px0), 0), 1);
    mtfCross(p.t0 + frac * (p.t1 - p.t0));
  });
  svgEl.addEventListener('mouseleave', mtfHideCross);

  // risk line dragging
  svgEl.addEventListener('mousedown', e => {
    const hit = e.target.closest('.riskhit');
    if (!hit) return;
    risk.drag = hit.dataset.line;
    e.preventDefault();
  });
  svgEl.addEventListener('mousemove', e => {
    if (!risk.drag || chartMode === 'mtf') return;
    const sc = risk.scale;
    if (!sc) return;
    const rect = svgEl.getBoundingClientRect();
    const vy = (e.clientY - rect.top) / rect.height * 330;
    let v = sc.lo + (sc.PT + sc.ph - vy) / sc.ph * (sc.hi - sc.lo);
    v = Math.max(sc.lo, Math.min(sc.hi, v));
    if (risk.drag === 'ENTRY') risk.entry = v;
    else if (risk.drag === 'SL') risk.sl = v;
    else {
      const k = risk.drag === 'TP1' ? 1 : risk.drag === 'TP2' ? 2 : 3;
      risk.sl = risk.entry + (risk.side === 'short' ? 1 : -1) * Math.abs(v - risk.entry) / k;
    }
    renderChart();
  });
  window.addEventListener('mouseup', () => { risk.drag = null; });

  // risk toolbar inputs
  $('rk-bal').addEventListener('input', () => {
    risk.bal = parseFloat($('rk-bal').value) || risk.bal;
    if (chartMode !== 'mtf') renderChart();
  });
  $('rk-pct').addEventListener('input', () => {
    risk.pct = Math.max(0.05, parseFloat($('rk-pct').value) || risk.pct);
    if (chartMode !== 'mtf') renderChart();
  });
  $('rk-entry').addEventListener('input', () => {
    const v = parseFloat($('rk-entry').value);
    if (isFinite(v) && v > 0) {
      risk.entry = v;
      if (chartMode !== 'mtf') renderChart();
    }
  });
  $('rk-atr').addEventListener('input', () => {
    risk.atrMult = Math.max(0.1, parseFloat($('rk-atr').value) || risk.atrMult);
    if (risk.atr && risk.entry != null) {
      risk.sl = risk.entry + (risk.side === 'short' ? 1 : -1) * risk.atrMult * risk.atr;
    }
    if (chartMode !== 'mtf') renderChart();
  });
  $('rk-reset').addEventListener('click', () => {
    risk.sym = '__reset';                     // force re-anchor to current price
    if (chartMode !== 'mtf') renderChart();
  });
}
