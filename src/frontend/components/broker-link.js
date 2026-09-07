/**
 * broker-link.js — the compliant broker referral (v1.0).
 *
 * A single outbound link to the referral partner, opened in an external
 * browser tab. No in-app OAuth, no API calls to the broker, no account
 * linking, no order routing. The risk disclosure renders from a clearly
 * marked placeholder ({{TRADE_NATION_RISK_DISCLOSURE}}) served by
 * /api/config so final compliance wording can replace it without a code
 * change.
 */
import { $ } from '../utils/format.js';

export function initBrokerLink() {
  $('broker-btn').addEventListener('click', e => {
    e.stopPropagation();
    ['cards-pop', 'tk-pop', 'alert-pop', 'up-pop'].forEach(id => $(id).classList.remove('open'));
    $('broker-btn').setAttribute('aria-expanded', $('broker-pop').classList.contains('open') ? 'false' : 'true');
    $('broker-pop').classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#broker-pop') && !e.target.closest('#broker-btn')) $('broker-pop').classList.remove('open');
  });
}
