/**
 * theme.js — high-contrast / colorblind-safe palette state (WCAG 1.4.1).
 * JS-drawn colors (SVG strokes, rgba blends) read the CSS custom properties
 * so the palette switch applies everywhere from one toggle.
 */
import { $ } from './format.js';

const HC_KEY = 'evt-hc-v1';
let highContrast = false;

export function applyTheme() {
  try { highContrast = localStorage.getItem(HC_KEY) === '1'; } catch (e) { highContrast = false; }
  applyHC();
}

export function isHighContrast() {
  return highContrast;
}

export function toggleHighContrast() {
  highContrast = !highContrast;
  try { localStorage.setItem(HC_KEY, highContrast ? '1' : '0'); } catch (e) { /* ignore */ }
  applyHC();
  return highContrast;
}

function applyHC() {
  document.body.classList.toggle('hc', highContrast);
  const btn = $('hc-toggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(highContrast));
    btn.textContent = highContrast ? '◐ CONTRAST: ON' : '◐ CONTRAST';
  }
}

function rgbTriplet(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/** "r,g,b" triplets for rgba() blends (heatmap tiles, correlation cells, zones). */
export function upRgb() { return rgbTriplet('--up-rgb'); }
export function downRgb() { return rgbTriplet('--down-rgb'); }
/** Stroke colors for SVG lines/markers. */
export function upColor() { return `rgb(${upRgb()})`; }
export function downColor() { return `rgb(${downRgb()})`; }
