/**
 * connection-indicator.js — reflects REST/WS connectivity onto the header
 * badge and the per-panel DEMO/LIVE labels. Subscribes to store bus.
 */
import { connection, bus } from '../services/store.js';
import { $ } from '../utils/format.js';

function setBadgeState() {
  const live = connection.live;
  const badge = $('conn-badge');
  if (badge) {
    badge.textContent = live
      ? (connection.provider === 'demo' ? '● LIVE · SERVER SIM' : '● LIVE · ' + connection.provider.toUpperCase())
      : '● OFFLINE · DETERMINISTIC DEMO';
    badge.className = 'badge' + (live ? ' green' : '');
  }
  document.querySelectorAll('.ph .pmeta b').forEach(el => {
    if (el.textContent === 'DEMO' && live) el.textContent = 'LIVE';
  });
  const chartNote = $('ch-note-mode');
  if (chartNote) {
    chartNote.textContent = live
      ? 'daily bars via ' + (connection.provider === 'demo' ? 'server sim feed' : connection.provider)
      : 'DEMO unadjusted fixture';
  }
  const sectorRegion = $('sect-region');
  if (sectorRegion && live) sectorRegion.textContent = 'single-region (US-listed) universe';
}

bus.on('connection', setBadgeState);

export { setBadgeState };
