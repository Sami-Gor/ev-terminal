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
    if (!live) {
      badge.textContent = '● OFFLINE · DETERMINISTIC DEMO';
      badge.className = 'badge';
    } else if (connection.simulated) {
      // Simulated engine is the shipped product — amber, never green "LIVE".
      badge.textContent = '● SIMULATED ENGINE';
      badge.className = 'badge';
    } else {
      badge.textContent = '● LIVE · ' + connection.provider.toUpperCase();
      badge.className = 'badge green';
    }
  }
  document.querySelectorAll('.ph .pmeta b').forEach(el => {
    if (el.textContent !== 'DEMO') return;
    if (!live) return;
    el.textContent = connection.simulated ? 'SIM' : 'LIVE';
  });
  const chartNote = $('ch-note-mode');
  if (chartNote) {
    chartNote.textContent = live
      ? (connection.simulated ? 'simulated feed (not live market data)'
                              : 'daily bars via ' + connection.provider)
      : 'DEMO unadjusted fixture';
  }
  const sectorRegion = $('sect-region');
  if (sectorRegion && live) sectorRegion.textContent = 'single-region (US-listed) universe';
}

bus.on('connection', setBadgeState);

export { setBadgeState };
