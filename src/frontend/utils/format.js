/**
 * format.js — display formatting helpers shared by every panel.
 */

export const $ = id => document.getElementById(id);

export const ARROW = p => (p > 0 ? '▲' : p < 0 ? '▼' : '•');
export const CLS = p => (p > 0 ? 'up' : p < 0 ? 'down' : 'flat');
export const fnum = (n, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fchg = (n, d = 2) => (n >= 0 ? '+' : '−') + fnum(Math.abs(n), d);
export const fpct = p => (p >= 0 ? '+' : '−') + fnum(Math.abs(p), 2) + '%';
export const fvol = v => (v >= 1000 ? fnum(v / 1000, 2) + 'B' : fnum(v, 1) + 'M');

export function fmtBig(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
  return s + '$' + a.toFixed(0);
}

export function fmtPctV(v) {
  return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';
}

export function fmtDeliveries(v, unit) {
  if (v == null || !isFinite(v)) return '—';
  if (unit === 'GWh') return fnum(v, 1) + ' GWh';
  return v >= 1e6 ? fnum(v / 1e6, 2) + 'M' : Math.round(v).toLocaleString('en-US');
}
