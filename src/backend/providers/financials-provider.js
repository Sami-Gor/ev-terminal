'use strict';

/**
 * FMP/Massive fundamentals provider using the `/stable` API.
 *
 * Core request set per uncached symbol (7 calls):
 *   profile, quarterly income (limit 5), annual income (limit 5),
 *   quarterly balance sheet (limit 5), quarterly cash flow (limit 5),
 *   ratios-TTM, key-metrics-TTM.
 *
 * Requests run in parallel and are settled independently, so one restricted or
 * failing endpoint never discards the usable data from the others. Missing
 * values are returned as null — never fabricated. Modeled deliveries are the
 * only simulated values and are labelled as such via `deliveriesMode`.
 */
const axios = require('axios');
const { FMP_KEY } = require('../config');
const demoProvider = require('./demo-provider');
const { num } = require('./provider-utils');

const FMP_BASE = 'https://financialmodelingprep.com/stable';

/** Rows from an allSettled result (arrays and single objects both supported). */
function rows(result) {
  if (!result || result.status !== 'fulfilled') return [];
  const data = result.value && result.value.data;
  if (Array.isArray(data)) return data;
  return data && typeof data === 'object' ? [data] : [];
}

function first(result) {
  return rows(result)[0] || null;
}

function statusOf(result) {
  return result && result.status === 'rejected' && result.reason && result.reason.response
    ? result.reason.response.status
    : null;
}

/** Sum of the newest four rows, requiring each of those four to carry a finite
 *  value for `field` — a gapped selection (older quarter substituted for a
 *  missing one) is not a trailing-twelve-month figure, so it returns null.
 *  A legitimate zero is finite and preserved. */
function sumLast4(list, field) {
  const newest = list.slice(0, 4).map(r => num(r[field]));
  if (newest.length < 4 || newest.some(v => v === null)) return null;
  return +newest.reduce((s, v) => s + v, 0).toFixed(2);
}

/** `Q2 2026` from the provider's own period/fiscalYear (never inferred). */
function rowLabel(row) {
  if (!row) return null;
  const year = row.fiscalYear || (row.date ? String(row.date).slice(0, 4) : '');
  if (row.period) return `${row.period} ${year}`.trim();
  return row.date || null;
}

function statementHistory(list, limit = 5) {
  return list.slice(0, limit).map(r => ({
    label: rowLabel(r),
    revenue: num(r.revenue),
    netIncome: num(r.netIncome),
    rd: num(r.researchAndDevelopmentExpenses),
  }));
}

/** Annual income rows (already fetched in the core 7-call set) with the fuller
 *  app-owned field set used by the annual view and validation. */
function annualStatementHistory(list, limit = 5) {
  return list.slice(0, limit).map(r => ({
    label: rowLabel(r),
    date: typeof r.date === 'string' ? r.date : null,
    fiscalYear: r.fiscalYear === undefined ? null : r.fiscalYear,
    period: r.period === undefined ? null : r.period,
    revenue: num(r.revenue),
    grossProfit: num(r.grossProfit),
    operatingIncome: num(r.operatingIncome),
    ebitda: num(r.ebitda),
    netIncome: num(r.netIncome),
    eps: num(r.eps),
    epsDiluted: num(r.epsDiluted),
    rd: num(r.researchAndDevelopmentExpenses),
  }));
}

/** Latest cash + short-term investments without double counting. */
function cashAndSTI(balance) {
  if (!balance) return null;
  const combined = num(balance.cashAndShortTermInvestments);
  if (combined !== null) return combined;
  const cash = num(balance.cashAndCashEquivalents);
  const sti = num(balance.shortTermInvestments);
  if (cash !== null && sti !== null) return cash + sti;
  return cash !== null ? cash : sti;
}

/** Normalized quarterly balance-sheet series (newest first, max 5). */
function balanceHistory(balances, limit = 5) {
  return balances.slice(0, limit).map(b => ({
    label: rowLabel(b),
    date: typeof b.date === 'string' ? b.date : null,
    fiscalYear: b.fiscalYear === undefined ? null : b.fiscalYear,
    period: b.period === undefined ? null : b.period,
    cashAndEquivalents: num(b.cashAndCashEquivalents),
    shortTermInvestments: num(b.shortTermInvestments),
    cashAndShortTermInvestments: cashAndSTI(b),
    inventory: num(b.inventory),
    currentAssets: num(b.totalCurrentAssets),
    totalAssets: num(b.totalAssets),
    currentLiabilities: num(b.totalCurrentLiabilities),
    totalLiabilities: num(b.totalLiabilities),
    stockholdersEquity: num(b.totalStockholdersEquity),
    totalDebt: num(b.totalDebt),
    netDebt: num(b.netDebt),
  }));
}

/** Normalized quarterly cash-flow series (newest first, max 5).
 *  `netCashProvidedByOperatingActivities` is the semantically identical
 *  fallback for `operatingCashFlow`; signs are preserved as reported. */
function cashFlowHistory(cashFlows, limit = 5) {
  return cashFlows.slice(0, limit).map(c => ({
    label: rowLabel(c),
    date: typeof c.date === 'string' ? c.date : null,
    fiscalYear: c.fiscalYear === undefined ? null : c.fiscalYear,
    period: c.period === undefined ? null : c.period,
    operatingCashFlow: num(c.operatingCashFlow) ?? num(c.netCashProvidedByOperatingActivities),
    capitalExpenditure: num(c.capitalExpenditure),
    freeCashFlow: num(c.freeCashFlow),
    investingCashFlow: num(c.netCashProvidedByInvestingActivities),
    financingCashFlow: num(c.netCashProvidedByFinancingActivities),
    netChangeInCash: num(c.netChangeInCash),
    cashAtEndOfPeriod: num(c.cashAtEndOfPeriod),
  }));
}

async function fmpFinancials(sym, defaultUniverse = [], { httpGet = (url, opts) => axios.get(url, opts) } = {}) {
  const get = (path, params = {}) =>
    httpGet(`${FMP_BASE}${path}`, { params: { ...params, apikey: FMP_KEY }, timeout: 15000 });

  const settled = await Promise.allSettled([
    get('/profile', { symbol: sym }),
    get('/income-statement', { symbol: sym, period: 'quarter', limit: 5 }),
    get('/income-statement', { symbol: sym, limit: 5 }),
    get('/balance-sheet-statement', { symbol: sym, period: 'quarter', limit: 5 }),
    get('/cash-flow-statement', { symbol: sym, period: 'quarter', limit: 5 }),
    get('/ratios-ttm', { symbol: sym }),
    get('/key-metrics-ttm', { symbol: sym }),
  ]);

  const profile = first(settled[0]);
  const quarters = rows(settled[1]);
  const annual = rows(settled[2]);
  const balances = rows(settled[3]);
  const cashFlows = rows(settled[4]);
  const ratiosTTM = first(settled[5]) || {};
  const metricsTTM = first(settled[6]) || {};

  const hasFundamentals = quarters.length > 0
    || Object.keys(ratiosTTM).length > 0
    || Object.keys(metricsTTM).length > 0;
  const sector = (defaultUniverse.find(u => u.sym === sym) || {}).sector || 'PURE';

  if (!hasFundamentals) {
    // No usable FMP fundamentals: return clearly-labelled modeled data (never
    // marked as FMP), with a note distinguishing plan restrictions.
    const statuses = settled.map(statusOf).filter(s => s !== null);
    const restricted = statuses.length > 0 && statuses.every(s => s === 402);
    const fallback = demoProvider.demoFinancials(sym);
    fallback.note = restricted
      ? `Financial statements unavailable for ${sym} under the current FMP subscription — showing modeled fundamentals.`
      : 'FMP fundamentals unavailable — showing modeled fundamentals.';
    return fallback;
  }

  const latestQuarter = quarters[0] || {};
  const asOf = latestQuarter.filingDate || latestQuarter.date
    || (annual[0] && (annual[0].filingDate || annual[0].date)) || '';

  return {
    symbol: sym,
    provider: 'fmp',
    financialsMode: 'real',
    deliveriesMode: 'modeled',
    asOf,
    marketCap: num(profile && profile.marketCap) ?? num(metricsTTM.marketCap),
    peTTM: num(ratiosTTM.priceToEarningsRatioTTM),
    evSales: num(metricsTTM.evToSalesTTM),
    fcfTTM: sumLast4(cashFlows, 'freeCashFlow'),
    grossMargin: num(ratiosTTM.grossProfitMarginTTM),
    netMargin: num(ratiosTTM.netProfitMarginTTM),
    revenueTTM: sumLast4(quarters, 'revenue'),
    netIncomeTTM: sumLast4(quarters, 'netIncome'),
    rdSpendTTM: sumLast4(quarters, 'researchAndDevelopmentExpenses'),
    cashSTI: cashAndSTI(balances[0] || null),
    deliveryUnit: sector === 'PURE' ? 'vehicles' : 'GWh',
    deliveriesSim: demoProvider.simDeliveries(sym, sector),
    deliveriesNote: 'Deliveries are modeled estimates (FMP does not provide a deliveries dataset); financial margins are real FMP fundamentals.',
    history: statementHistory(quarters, 5),
    balanceHistory: balanceHistory(balances),
    cashFlowHistory: cashFlowHistory(cashFlows),
    // Annual income rows come from the same approved request set (no extra call).
    annual: annualStatementHistory(annual, 5),
  };
}

/**
 * Lazy growth series (single optional endpoint, quarterly, limit 5).
 * Not part of the core financial fetch — callers fetch it only on demand.
 * An empty dataset returns a normalized `unavailable` payload; provider
 * errors (including 402 restrictions) propagate so the caller can serve stale
 * data or an explicit unavailable message.
 */
async function fmpGrowth(sym, { httpGet = (url, opts) => axios.get(url, opts) } = {}) {
  const { data } = await httpGet(
    `${FMP_BASE}/income-statement-growth`,
    { params: { symbol: sym, period: 'quarter', limit: 5, apikey: FMP_KEY }, timeout: 15000 },
  );
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return { symbol: sym, provider: 'fmp', growthMode: 'unavailable', growthHistory: [], note: 'Growth data unavailable for this symbol.' };
  }
  const growthHistory = rows.slice(0, 5).map(g => ({
    label: rowLabel(g),
    date: typeof g.date === 'string' ? g.date : null,
    fiscalYear: g.fiscalYear === undefined ? null : g.fiscalYear,
    period: g.period === undefined ? null : g.period,
    revenueGrowth: num(g.growthRevenue),
    grossProfitGrowth: num(g.growthGrossProfit),
    operatingIncomeGrowth: num(g.growthOperatingIncome),
    netIncomeGrowth: num(g.growthNetIncome),
    epsGrowth: num(g.growthEPS),
  }));
  return {
    symbol: sym,
    provider: 'fmp',
    growthMode: 'real',
    asOf: typeof rows[0].date === 'string' ? rows[0].date : null,
    growthHistory,
  };
}

module.exports = { fmpFinancials, fmpGrowth, balanceHistory, cashFlowHistory, num, sumLast4 };
