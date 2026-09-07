/**
 * upgrade-banner.js — the inert "Upgrade to real prices" hook (v1.0).
 *
 * Visible affordance for the future paid tier. Clicking opens a popover that
 * captures interest (email) via POST /api/upgrade-interest. No delayed-data
 * functionality exists behind it — by design, until a business-tier data
 * agreement is in place.
 */
import { API_BASE } from '../services/api.js';
import { $ } from '../utils/format.js';

let busy = false;

function flash(message, ok) {
  const el = $('up-hint');
  if (!el) return;
  el.textContent = message;
  el.style.color = ok ? 'var(--green)' : 'var(--amber)';
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { if ($('up-hint').textContent === message) el.textContent = ''; }, 4000);
}

async function captureInterest() {
  if (busy) return;
  const email = $('up-email').value.trim();
  if (!email) { flash('enter your email first'); return; }
  busy = true;
  try {
    const res = await fetch(`${API_BASE}/api/upgrade-interest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'request failed');
    $('up-email').value = '';
    flash(`✓ captured — ${body.total} on the waitlist`, true);
  } catch (e) {
    flash(e.message || 'capture failed — try again later');
  } finally {
    busy = false;
  }
}

export function initUpgradeBanner() {
  $('up-btn').addEventListener('click', e => {
    e.stopPropagation();
    ['cards-pop', 'tk-pop', 'alert-pop'].forEach(id => $(id).classList.remove('open'));
    $('up-btn').setAttribute('aria-expanded', $('up-pop').classList.contains('open') ? 'false' : 'true');
    $('up-pop').classList.toggle('open');
  });
  $('up-cta').addEventListener('click', captureInterest);
  $('up-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') captureInterest();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#up-pop') && !e.target.closest('#up-btn')) $('up-pop').classList.remove('open');
  });
}
