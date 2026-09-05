'use strict';

/** FMP fundamentals wrapper (key-metrics-TTM, profile, income statements). */
const axios = require('axios');
const { FMP_KEY } = require('../config');
const { simDeliveries } = require('./demo-provider');

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

async function fmpFinancials(sym, defaultUniverse) {
  const params = { apikey: FMP_KEY };
  const [metricsRes, profileRes, incomeRes] = await Promise.all([
    axios.get(`${FMP_BASE}/key-metrics-ttm/${encodeURIComponent(sym)}`, { params, timeout: 12000 }),
    axios.get(`${FMP_BASE}/profile/${encodeURIComponent(sym)}`, { params, timeout: 12000 }),
    axios.get(`${FMP_BASE}/income-statement/${encodeURIComponent(sym)}`, { params: { ...params, limit: 4 }, timeout: 12000 }),
  ]);
  const metrics = (metricsRes.data && metricsRes.data[0]) || {};
  const profile = (profileRes.data && profileRes.data[0]) || {};
  const statements = incomeRes.data || [];
  if (!statements.length && !metrics.marketCap) throw new Error('no FMP fundamental data');
  const latest = statements[0] || {};
  const sector = (defaultUniverse.find(u => u.sym === sym) || {}).sector || 'PURE';
  return {
    symbol: sym,
    provider: 'fmp',
    asOf: latest.fillingDate || latest.date || '',
    marketCap: profile.mktCap ?? metrics.marketCapTTM ?? null,
    peTTM: metrics.peRatioTTM ?? profile.pe ?? null,
    evSales: metrics.evSalesTTM ?? null,
    fcfTTM: metrics.freeCashFlowTTM ?? null,
    grossMargin: metrics.grossProfitMarginTTM ?? null,
    netMargin: latest.revenue ? (latest.netIncome || 0) / latest.revenue : null,
    revenueTTM: metrics.revenueTTM ?? latest.revenue ?? null,
    netIncomeTTM: latest.netIncome ?? null,
    rdSpendTTM: latest.researchAndDevelopmentExpenses ?? null,
    cashSTI: latest.cashAndShortTermInvestments ?? null,
    deliveryUnit: sector === 'PURE' ? 'vehicles' : 'GWh',
    deliveriesSim: simDeliveries(sym, sector),
    deliveriesNote: 'deliveries are modeled estimates (not available from FMP)',
    history: statements.map(s => ({
      label: (s.period ? s.period + ' ' : '') + (s.calendarYear || s.date || ''),
      revenue: s.revenue,
      netIncome: s.netIncome,
      rd: s.researchAndDevelopmentExpenses,
    })),
  };
}

module.exports = { fmpFinancials };
