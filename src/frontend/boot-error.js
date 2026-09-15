/**
 * boot-error.js — early error listener, loaded before main.js.
 *
 * External (not inline) so it satisfies the app's `script-src 'self'` CSP;
 * inline scripts are intentionally not allowed. Reports a failed boot to the
 * DOM instead of leaving a dead page.
 */
window.addEventListener('error', e => {
  const d = document.createElement('div');
  d.id = 'boot-err';
  d.textContent = 'ERR ' + (e.message || '?') + ' @ ' +
    String(e.filename || '').split('/').pop() + ':' + e.lineno;
  (document.body || document.documentElement).appendChild(d);
});
