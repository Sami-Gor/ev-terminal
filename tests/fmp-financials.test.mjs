import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmpFinancials, num, sumLast4 } from '../src/backend/providers/financials-provider.js';
import * as demo from '../src/backend/providers/demo-provider.js';
import config from '../src/backend/config/index.js';

/* ------------------------------------------------------------------ *
 * Fixtures and injected transport (no live FMP calls in unit tests)   *
 * ------------------------------------------------------------------ */

const PROFILE = { symbol: 'TSLA', marketCap: 1408329609753, companyName: 'Tesla, Inc.', fullTimeEmployees: '134785' };
const RATIOS_TTM = { symbol: 'TSLA', priceToEarningsRatioTTM: 381.12, grossProfitMarginTTM: 0.1803, netProfitMarginTTM: 0.04 };
const METRICS_TTM = { symbol: 'TSLA', marketCap: 1450347000000, evToSalesTTM: 13.53 };
const BALANCE = { date: '2026-06-30', period: 'Q2', fiscalYear: '2026', cashAndShortTermInvestments: 500, cashAndCashEquivalents: 400, shortTermInvestments: 100 };

function q(date, period, year, revenue, netIncome, rd) {
  return { date, period, fiscalYear: year, filingDate: date, revenue, netIncome, researchAndDevelopmentExpenses: rd };
}

const QUARTERS = [
  q('2026-06-30', 'Q2', '2026', 100, 10, 4),
  q('2026-03-31', 'Q1', '2026', 110, 11, 5),
  q('2025-12-31', 'Q4', '2025', 120, 12, 6),
  q('2025-09-30', 'Q3', '2025', 130, 13, 7),
  q('2025-06-30', 'Q2', '2025', 140, 14, 8),
];
const ANNUAL = [
  q('2025-12-31', 'FY', '2025', 400, 40, 20),
  q('2024-12-31', 'FY', '2024', 380, 38, 19),
];
const CASHFLOWS = [
  { date: '2026-06-30', period: 'Q2', fiscalYear: '2026', freeCashFlow: 8 },
  { date: '2026-03-31', period: 'Q1', fiscalYear: '2026', freeCashFlow: 9 },
  { date: '2025-12-31', period: 'Q4', fiscalYear: '2025', freeCashFlow: 10 },
  { date: '2025-09-30', period: 'Q3', fiscalYear: '2025', freeCashFlow: 11 },
  { date: '2025-06-30', period: 'Q2', fiscalYear: '2025', freeCashFlow: 12 },
];

function httpError(status) {
  const e = new Error('http ' + status);
  e.response = { status, data: { message: 'x' } };
  return e;
}

/** Routes (url, params) to canned responses; records every call. */
function makeTransport(overrides = {}) {
  const calls = [];
  const handlers = {
    profile: () => PROFILE,
    incomeQ: () => QUARTERS,
    incomeA: () => ANNUAL,
    balance: () => [BALANCE],
    cashflow: () => CASHFLOWS,
    ratios: () => [RATIOS_TTM],
    metrics: () => [METRICS_TTM],
    ...overrides,
  };
  const httpGet = async (url, opts = {}) => {
    const params = opts.params || {};
    calls.push({ url, params });
    const pick = () => {
      if (url.endsWith('/profile')) return handlers.profile;
      if (url.endsWith('/income-statement')) return params.period === 'quarter' ? handlers.incomeQ : handlers.incomeA;
      if (url.endsWith('/balance-sheet-statement')) return handlers.balance;
      if (url.endsWith('/cash-flow-statement')) return handlers.cashflow;
      if (url.endsWith('/ratios-ttm')) return handlers.ratios;
      if (url.endsWith('/key-metrics-ttm')) return handlers.metrics;
      throw new Error('unexpected endpoint ' + url);
    };
    const result = pick()();
    if (result instanceof Error) throw result;
    return { status: 200, data: result };
  };
  return { httpGet, calls };
}

/* ------------------------------------------------------------------ *
 * Core mapping                                                        *
 * ------------------------------------------------------------------ */

test('uses FMP /stable endpoints only (no legacy /api/v3) and no duplicate calls', async () => {
  const { httpGet, calls } = makeTransport();
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(calls.length, 7, 'expected exactly 7 core requests');
  for (const c of calls) {
    assert.ok(c.url.startsWith('https://financialmodelingprep.com/stable/'), c.url);
    assert.ok(!c.url.includes('/api/v3'), 'legacy endpoint used');
  }
  const keys = calls.map(c => c.url + '|' + JSON.stringify(c.params));
  assert.equal(new Set(keys).size, calls.length, 'duplicate requests detected');
  // Balance/Cash series reuse the already-fetched statements: no extra calls.
  assert.equal(calls.filter(c => c.url.endsWith('/balance-sheet-statement')).length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/cash-flow-statement')).length, 1);
  assert.ok(Array.isArray(d.balanceHistory) && d.balanceHistory.length >= 1);
  assert.ok(Array.isArray(d.cashFlowHistory) && d.cashFlowHistory.length >= 1);
});

test('maps TSLA-style responses to the normalized overview schema', async () => {
  const { httpGet } = makeTransport();
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.provider, 'fmp');
  assert.equal(d.financialsMode, 'real');
  assert.equal(d.deliveriesMode, 'modeled');
  assert.equal(d.marketCap, 1408329609753);
  assert.equal(d.peTTM, 381.12);
  assert.equal(d.evSales, 13.53);
  assert.equal(d.grossMargin, 0.1803);
  assert.equal(d.netMargin, 0.04);
  assert.equal(d.cashSTI, 500);
  assert.equal(d.asOf, '2026-06-30');
  assert.equal(d.provider, 'fmp');
});

test('computes TTM sums only from the latest four quarterly rows', async () => {
  const { httpGet } = makeTransport();
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.revenueTTM, 460);        // 100+110+120+130, 5th row ignored
  assert.equal(d.netIncomeTTM, 46);
  assert.equal(d.rdSpendTTM, 22);
  assert.equal(d.fcfTTM, 38);             // 8+9+10+11
});

test('cashSTI uses the combined field and never double counts', async () => {
  const { httpGet } = makeTransport();
  const combined = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(combined.cashSTI, 500);

  const split = makeTransport({ balance: () => [{ date: '2026-06-30', cashAndCashEquivalents: 400, shortTermInvestments: 120 }] });
  const d2 = await fmpFinancials('TSLA', [], { httpGet: split.httpGet });
  assert.equal(d2.cashSTI, 520, 'falls back to cash + STI when combined is absent');

  const cashOnly = makeTransport({ balance: () => [{ date: '2026-06-30', cashAndCashEquivalents: 400 }] });
  const d3 = await fmpFinancials('TSLA', [], { httpGet: cashOnly.httpGet });
  assert.equal(d3.cashSTI, 400);
});

test('maps five quarterly balance rows with combined cash preference and split fallback', async () => {
  const make = (date, period, year, cash, sti, combined, extra = {}) => ({
    date, period, fiscalYear: year,
    cashAndCashEquivalents: cash, shortTermInvestments: sti, cashAndShortTermInvestments: combined,
    inventory: extra.inventory, totalCurrentAssets: extra.currentAssets, totalAssets: extra.totalAssets,
    totalCurrentLiabilities: extra.currentLiabilities, totalLiabilities: extra.totalLiabilities,
    totalStockholdersEquity: extra.equity, totalDebt: extra.debt, netDebt: extra.netDebt,
  });
  const balances = [
    make('2026-06-30', 'Q2', '2026', 600, 100, 700, { inventory: 50, currentAssets: 1200, totalAssets: 5000, currentLiabilities: 400, totalLiabilities: 2000, equity: 3000, debt: 800, netDebt: 100 }),
    make('2026-03-31', 'Q1', '2026', 550, 90, null, { inventory: 0, currentAssets: 1100, totalAssets: 4900, currentLiabilities: 390, totalLiabilities: 1950, equity: 2950, debt: 780, netDebt: 140 }),
    make('2025-12-31', 'Q4', '2025', 500, null, null, { inventory: null }),
    make('2025-09-30', 'Q3', '2025', null, 80, null),
    make('2025-06-30', 'Q2', '2025', 480, 70, 550),
  ];
  const { httpGet } = makeTransport({ balance: () => balances });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  const h = d.balanceHistory;
  assert.equal(h.length, 5);
  assert.deepEqual(h.map(r => r.label), ['Q2 2026', 'Q1 2026', 'Q4 2025', 'Q3 2025', 'Q2 2025']);
  assert.equal(h[0].cashAndShortTermInvestments, 700);   // combined field preferred
  assert.equal(h[1].cashAndShortTermInvestments, 640);   // split cash + STI fallback
  assert.equal(h[2].cashAndShortTermInvestments, 500);   // cash only
  assert.equal(h[3].cashAndShortTermInvestments, 80);    // STI only
  assert.equal(h[0].currentAssets, 1200);
  assert.equal(h[0].totalAssets, 5000);
  assert.equal(h[0].stockholdersEquity, 3000);
  assert.equal(h[0].netDebt, 100);
  assert.equal(h[0].date, '2026-06-30');
  assert.equal(h[0].fiscalYear, '2026');
  assert.equal(h[1].inventory, 0, 'legitimate zero preserved');
  assert.equal(h[2].inventory, null, 'missing value stays null');
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
});

test('maps five quarterly cash-flow rows with signs and OCF fallback preserved', async () => {
  const flows = [
    { date: '2026-06-30', period: 'Q2', fiscalYear: '2026', operatingCashFlow: 120, capitalExpenditure: -60, freeCashFlow: 60, netCashProvidedByInvestingActivities: -70, netCashProvidedByFinancingActivities: 20, netChangeInCash: 70, cashAtEndOfPeriod: 900 },
    { date: '2026-03-31', period: 'Q1', fiscalYear: '2026', operatingCashFlow: null, netCashProvidedByOperatingActivities: 100, capitalExpenditure: -50, freeCashFlow: 50, netCashProvidedByInvestingActivities: -55, netCashProvidedByFinancingActivities: -10, netChangeInCash: 35, cashAtEndOfPeriod: 830 },
    { date: '2025-12-31', period: 'Q4', fiscalYear: '2025', operatingCashFlow: 0, capitalExpenditure: 0, freeCashFlow: 0, netCashProvidedByInvestingActivities: null, netCashProvidedByFinancingActivities: null, netChangeInCash: null, cashAtEndOfPeriod: null },
    { date: '2025-09-30', period: 'Q3', fiscalYear: '2025' },
    { date: '2025-06-30', period: 'Q2', fiscalYear: '2025', operatingCashFlow: 90, capitalExpenditure: -40, freeCashFlow: 50 },
  ];
  const { httpGet } = makeTransport({ cashflow: () => flows });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  const h = d.cashFlowHistory;
  assert.equal(h.length, 5);
  assert.deepEqual(h.map(r => r.label), ['Q2 2026', 'Q1 2026', 'Q4 2025', 'Q3 2025', 'Q2 2025']);
  assert.equal(h[0].operatingCashFlow, 120);
  assert.equal(h[0].capitalExpenditure, -60, 'capex sign preserved');
  assert.equal(h[0].freeCashFlow, 60);
  assert.equal(h[0].investingCashFlow, -70);
  assert.equal(h[0].financingCashFlow, 20);
  assert.equal(h[0].netChangeInCash, 70);
  assert.equal(h[0].cashAtEndOfPeriod, 900);
  assert.equal(h[1].operatingCashFlow, 100, 'fallback field used only when the primary is absent');
  assert.equal(h[2].operatingCashFlow, 0, 'legitimate zero preserved');
  assert.equal(h[2].investingCashFlow, null);
  assert.equal(h[3].operatingCashFlow, null);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
});

test('maps five quarterly income history rows newest-first with provider labels', async () => {
  const { httpGet } = makeTransport();
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.history.length, 5);
  assert.deepEqual(d.history.map(h => h.label), ['Q2 2026', 'Q1 2026', 'Q4 2025', 'Q3 2025', 'Q2 2025']);
  assert.equal(d.history[0].revenue, 100);
  assert.equal(d.history[0].netIncome, 10);
  assert.equal(d.history[0].rd, 4);
  assert.equal(d.annual.length, 2, 'annual series fetched with the core request set');
});

test('maps annual income rows with FY labels and the full annual field set', async () => {
  const annual = [
    { date: '2025-12-31', period: 'FY', fiscalYear: '2025', revenue: 400, grossProfit: 100, operatingIncome: 40, ebitda: 90, netIncome: 40, eps: 1.2, epsDiluted: 1.1, researchAndDevelopmentExpenses: 20 },
    { date: '2024-12-31', period: 'FY', fiscalYear: '2024', revenue: 380, grossProfit: null, netIncome: 0, eps: 0, researchAndDevelopmentExpenses: undefined },
  ];
  const { httpGet } = makeTransport({ incomeA: () => annual });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.annual.length, 2);
  assert.deepEqual(d.annual.map(r => r.label), ['FY 2025', 'FY 2024']);
  const a = d.annual[0];
  assert.equal(a.date, '2025-12-31');
  assert.equal(a.fiscalYear, '2025');
  assert.equal(a.period, 'FY');
  assert.equal(a.revenue, 400);
  assert.equal(a.grossProfit, 100);
  assert.equal(a.operatingIncome, 40);
  assert.equal(a.ebitda, 90);
  assert.equal(a.netIncome, 40);
  assert.equal(a.eps, 1.2);
  assert.equal(a.epsDiluted, 1.1);
  assert.equal(a.rd, 20);
  assert.equal(d.annual[1].grossProfit, null, 'missing field stays null');
  assert.equal(d.annual[1].operatingIncome, null);
  assert.equal(d.annual[1].ebitda, null);
  assert.equal(d.annual[1].rd, null);
  assert.equal(d.annual[1].netIncome, 0, 'legitimate zero preserved');
  assert.equal(d.annual[1].eps, 0);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
});

test('annual series is capped at five rows (provider limit contract)', async () => {
  const six = [1, 2, 3, 4, 5, 6].map(i => ({ date: `20${30 - i}-12-31`, period: 'FY', fiscalYear: String(2030 - i), revenue: i }));
  const { httpGet } = makeTransport({ incomeA: () => six });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.annual.length, 5);
  assert.equal(d.annual[0].fiscalYear, '2029');
});

test('core financial fetch never touches the growth endpoint', async () => {
  const { httpGet, calls } = makeTransport();
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(calls.length, 7);
  assert.ok(!calls.some(c => c.url.includes('growth')), 'growth must stay lazy');
  assert.ok(!('growthHistory' in d), 'growth must not be part of the core payload');
});

/* ------------------------------------------------------------------ *
 * Null safety and edge cases                                          *
 * ------------------------------------------------------------------ */

test('missing numeric fields become null (not 0/NaN) and bad numerics are rejected', async () => {
  const { httpGet } = makeTransport({
    ratios: () => [{ symbol: 'TSLA' }],                      // no margin/PE fields
    metrics: () => [{ symbol: 'TSLA' }],                     // no EV/Sales
    balance: () => [{ date: '2026-06-30' }],                 // no cash data
    cashflow: () => [{ date: '2026-06-30', freeCashFlow: null }],
    incomeQ: () => QUARTERS.map(r => ({ ...r, researchAndDevelopmentExpenses: undefined })),
  });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.peTTM, null);
  assert.equal(d.evSales, null);
  assert.equal(d.grossMargin, null);
  assert.equal(d.netMargin, null);
  assert.equal(d.cashSTI, null);
  assert.equal(d.fcfTTM, null);
  assert.equal(d.rdSpendTTM, null);          // fewer than four valid R&D values
  assert.equal(d.revenueTTM, 460);           // unaffected fields stay real
  const json = JSON.stringify(d);
  assert.ok(!/NaN|Infinity/.test(json), 'NaN/Infinity leaked into payload');
});

test('legitimate zero values remain 0 (no truthiness bugs)', async () => {
  const { httpGet } = makeTransport({
    incomeQ: () => QUARTERS.map(r => ({ ...r, netIncome: 0 })),
    ratios: () => [{ grossProfitMarginTTM: 0, netProfitMarginTTM: 0, priceToEarningsRatioTTM: 0 }],
    cashflow: () => CASHFLOWS.map(r => ({ ...r, freeCashFlow: 0 })),
  });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.netIncomeTTM, 0);
  assert.equal(d.fcfTTM, 0);
  assert.equal(d.grossMargin, 0);
  assert.equal(d.netMargin, 0);
  assert.equal(d.peTTM, 0);
});

test('fewer than four quarters yields null TTM values (never annualized)', async () => {
  const { httpGet } = makeTransport({
    incomeQ: () => QUARTERS.slice(0, 3),
    cashflow: () => CASHFLOWS.slice(0, 2),
  });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.revenueTTM, null);
  assert.equal(d.netIncomeTTM, null);
  assert.equal(d.rdSpendTTM, null);
  assert.equal(d.fcfTTM, null);
  assert.equal(d.history.length, 3);
});

test('a gap in the newest four quarters yields null TTM (never a gapped sum)', async () => {
  // Newest quarter lacks net income, so the newest four reported values would
  // otherwise span five quarters and be presented as TTM.
  const gapped = QUARTERS.map((r, i) => (i === 2 ? { ...r, netIncome: null } : r));
  const { httpGet } = makeTransport({ incomeQ: () => gapped });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.netIncomeTTM, null, 'gapped TTM must not be fabricated from an older quarter');
  assert.equal(d.revenueTTM, 460, 'unaffected fields stay real (newest four all present)');
  assert.equal(d.rdSpendTTM, 22);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
});

test('exposes normalized data only — no raw provider payload or key', async () => {
  const { httpGet } = makeTransport();
  const d = await fmpFinancials('TSLA', [], { httpGet });
  const json = JSON.stringify(d);
  assert.ok(!json.includes('apikey'), 'request internals leaked');
  assert.ok(!json.includes('https://financialmodelingprep.com'), 'provider URL leaked');
  assert.ok(!('weightedAverageShsOut' in d), 'raw provider field leaked');
  if (config.FMP_KEY) assert.ok(!json.includes(config.FMP_KEY), 'API key leaked into payload');
});

/* ------------------------------------------------------------------ *
 * Restricted symbols and partial failure                              *
 * ------------------------------------------------------------------ */

test('402 subscription restriction falls back to clearly-labelled modeled data', async () => {
  const { httpGet } = makeTransport({
    incomeQ: () => httpError(402),
    incomeA: () => httpError(402),
    balance: () => httpError(402),
    cashflow: () => httpError(402),
    ratios: () => httpError(402),
    metrics: () => httpError(402),
  });
  const d = await fmpFinancials('LI', [], { httpGet });
  assert.equal(d.provider, 'demo');
  assert.equal(d.financialsMode, 'modeled');
  assert.equal(d.deliveriesMode, 'modeled');
  assert.match(d.note, /subscription/i);
  assert.ok(!JSON.stringify(d).includes('"provider":"fmp"'));
});

test('partial endpoint failure keeps usable real fields and nulls the rest', async () => {
  const { httpGet } = makeTransport({ cashflow: () => httpError(500) });
  const d = await fmpFinancials('TSLA', [], { httpGet });
  assert.equal(d.provider, 'fmp');
  assert.equal(d.financialsMode, 'real');
  assert.equal(d.fcfTTM, null, 'failed cash-flow endpoint must not fabricate FCF');
  assert.equal(d.revenueTTM, 460, 'income data retained');
  assert.equal(d.grossMargin, 0.1803, 'ratios retained');
  assert.equal(d.cashFlowHistory.length, 0, 'failed cash-flow endpoint must not be replaced with modeled rows');
  assert.equal(d.note, undefined, 'real payload must not carry a modeled note');

  const noBalance = makeTransport({ balance: () => httpError(500) });
  const d2 = await fmpFinancials('TSLA', [], { httpGet: noBalance.httpGet });
  assert.equal(d2.provider, 'fmp');
  assert.equal(d2.balanceHistory.length, 0, 'failed balance endpoint must not be replaced with modeled rows');
  assert.equal(d2.cashSTI, null, 'missing real cash value stays null');
});

test('demo mode carries explicit modeled provenance without an FMP key', () => {
  const d = demo.demoFinancials('TSLA');
  assert.equal(d.provider, 'demo');
  assert.equal(d.financialsMode, 'modeled');
  assert.equal(d.deliveriesMode, 'modeled');
  assert.ok(Number.isFinite(d.marketCap));
  assert.ok(d.deliveriesSim);
});

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

test('num/sumLast4 guards handle strings, nulls and short series', () => {
  assert.equal(num('42.5'), 42.5);
  assert.equal(num(0), 0);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(sumLast4([{ v: 1 }, { v: 2 }, { v: 3 }], 'v'), null);
  assert.equal(sumLast4([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 99 }], 'v'), 10);
});
