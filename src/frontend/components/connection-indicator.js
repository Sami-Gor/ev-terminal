/**
 * connection-indicator.js — reflects REST/WS connectivity and the effective
 * data mode onto the header badge and the per-panel SIM/EOD/LIVE labels.
 * Subscribes to store bus.
 */
import { connection, stateLabel, bus } from '../services/store.js';
import { $ } from '../utils/format.js';

const PANEL_STATES = new Set(['DEMO', 'SIM', 'EOD', 'LIVE']);

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
    } else if (connection.dataMode === 'eod') {
      // Previous-session data must never read as live market data.
      badge.textContent = '● EOD · PREVIOUS CLOSE';
      badge.className = 'badge';
    } else {
      badge.textContent = '● LIVE · ' + connection.provider.toUpperCase();
      badge.className = 'badge green';
    }
  }
  document.querySelectorAll('.ph .pmeta b').forEach(el => {
    if (!PANEL_STATES.has(el.textContent)) return;
    el.textContent = live ? stateLabel() : 'DEMO';
  });
  // Keep in-place state columns in sync when the mode changes (e.g. realtime → EOD);
  // rows/tape are otherwise only labelled at render time.
  document.querySelectorAll('#tk-table .stateb').forEach(el => { el.textContent = stateLabel(); });
  document.querySelectorAll('#tape em').forEach(el => { el.textContent = stateLabel(); });
  const chartNote = $('ch-note-mode');
  if (chartNote) {
    chartNote.textContent = live
      ? (connection.simulated ? 'simulated feed (not live market data)'
        : connection.dataMode === 'eod' ? 'previous-close data via ' + connection.provider + ' (EOD, not realtime)'
          : 'daily bars via ' + connection.provider)
      : 'DEMO unadjusted fixture';
  }
  const sectorRegion = $('sect-region');
  if (sectorRegion && live) sectorRegion.textContent = 'single-region (US-listed) universe';
}

bus.on('connection', setBadgeState);

export { setBadgeState };
