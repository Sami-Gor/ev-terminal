'use strict';

/**
 * Mock/simulated EV telemetry generator (offline development + demo mode).
 * Tickers use the demo provider's deterministic prices; vehicle telemetry is
 * intentionally partly randomized per refresh.
 */
const demoProvider = require('../providers/demo-provider');
const { hashSeed, mulberry32 } = require('./seeded-random');

const MOCK_FLEET = [
  { vehicleId: 'EV-001', model: 'Model Y' },
  { vehicleId: 'EV-002', model: 'Ioniq 5' },
  { vehicleId: 'EV-003', model: 'ID.4' },
  { vehicleId: 'EV-004', model: 'Blazer EV' },
  { vehicleId: 'EV-005', model: 'EV6' },
  { vehicleId: 'EV-006', model: 'Mach-E' },
];

/** Simulated EV telemetry + stock tickers for offline development. */
function generateMockTelemetry() {
  const vehicles = MOCK_FLEET.map(({ vehicleId, model }) => {
    const r = mulberry32(hashSeed(vehicleId + '|' + new Date().toDateString()));
    const base = 55 + r() * 40;
    const wobble = (Math.random() - 0.5) * 1.6;
    const socPct = Math.min(100, Math.max(5, +(base + wobble).toFixed(1)));
    return {
      vehicleId,
      model,
      socPct,
      rangeKm: Math.round(socPct * 4.6),
      batteryTempC: +(21 + r() * 9 + wobble).toFixed(1),
      motorTempC: +(28 + r() * 22).toFixed(1),
      chargingKw: +(Math.random() * 150).toFixed(1),
      odometerKm: Math.round(12000 + r() * 58000),
      status: Math.random() > 0.85 ? 'charging' : 'driving',
    };
  });
  const tickers = demoProvider.DEFAULT_UNIVERSE.map(u => {
    const tick = demoProvider.demoTick(u.sym);
    return {
      symbol: u.sym,
      name: u.name,
      price: tick.price,
      change: tick.change,
      percentChange: tick.percentChange,
      volume: tick.volume,
    };
  });
  return { vehicles, tickers };
}

module.exports = { generateMockTelemetry };
