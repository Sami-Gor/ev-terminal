/**
 * sanitize.js — XSS prevention helpers. Every user- or storage-derived value
 * passes through esc() before being interpolated into an HTML template.
 */

/** HTML-escape a value for safe interpolation into innerHTML templates. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Normalize a user-typed symbol: uppercase, strip illegal characters, cap at 10. */
export function sanitizeSymbol(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, '').slice(0, 10);
}

/** Validate a symbol against the terminal's symbol rules. */
export function isValidSymbol(sym) {
  return /^[A-Z0-9.\-^]{1,10}$/.test(sym);
}

/** Strip control characters and cap length on free-text names. */
export function sanitizeName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60);
}
