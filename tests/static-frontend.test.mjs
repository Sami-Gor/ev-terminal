import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/* Focused static regression coverage for the CSP/boot-error contract:
 * the boot handler must be an external script (script-src 'self'), and no
 * inline executable script, inline event handler or javascript: URL may
 * reappear in the app shell. Tests read files only — no browser required. */

const ROOT = path.join(import.meta.dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const BOOT_ERROR = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'boot-error.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'backend', 'app.js'), 'utf8');
const FRONTEND_API = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'services', 'api.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'main.js'), 'utf8');

test('index.html loads the boot-error handler externally before main.js', () => {
  const bootIdx = INDEX.indexOf('<script src="/src/frontend/boot-error.js"></script>');
  const mainIdx = INDEX.indexOf('<script type="module" src="/src/frontend/main.js"></script>');
  assert.ok(bootIdx !== -1, 'external boot-error script tag missing');
  assert.ok(mainIdx !== -1, 'main module script missing');
  assert.ok(bootIdx < mainIdx, 'boot-error must load before main.js');
  assert.ok(!INDEX.includes('id="boot-err"'), 'inline boot-error handler still present');
});

test('index.html has no inline executable scripts, handlers or javascript: URLs', () => {
  const tags = [...INDEX.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
  assert.ok(tags.length >= 2);
  for (const tag of tags) assert.ok(/\bsrc=/.test(tag), `inline script tag found: ${tag}`);
  assert.ok(!/\bon[a-z]+\s*=/i.test(INDEX), 'inline event handler found');
  assert.ok(!/javascript:/i.test(INDEX), 'javascript: URL found');
});

test('external boot-error handler preserves the diagnostic behaviour', () => {
  assert.match(BOOT_ERROR, /window\.addEventListener\('error'/);
  assert.match(BOOT_ERROR, /d\.id = 'boot-err'/);
  assert.match(BOOT_ERROR, /e\.message/);
  assert.match(BOOT_ERROR, /e\.filename/);
  assert.match(BOOT_ERROR, /e\.lineno/);
  assert.match(BOOT_ERROR, /document\.body \|\| document\.documentElement/, 'defensive body guard missing');
});

test('CSP keeps script-src self-only (no unsafe-inline/unsafe-eval)', () => {
  assert.match(APP, /'script-src': \["'self'"\]/);
  const scriptSrcLine = APP.split('\n').find(l => l.includes("'script-src'"));
  assert.ok(scriptSrcLine && !/unsafe-inline|unsafe-eval/.test(scriptSrcLine), 'script-src weakened');
});

test('financials tabs expose the six views in order', () => {
  const tabsBlock = INDEX.slice(INDEX.indexOf('id="fin-tabs"'), INDEX.indexOf('id="fin-meta"'));
  const order = ['OVERVIEW', 'INCOME STATEMENT', 'BALANCE SHEET', 'CASH FLOW', 'GROWTH', 'MARGINS &amp; DELIVERIES']
    .map(label => tabsBlock.indexOf(label));
  for (const idx of order) assert.ok(idx !== -1, 'financials tab missing');
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], 'financials tab order wrong');
  assert.match(tabsBlock, /data-tab="bs"/);
  assert.match(tabsBlock, /data-tab="cf"/);
  assert.match(tabsBlock, /data-tab="gr"/);
});

test('financials component renders normalized balance and cash-flow series', () => {
  const FIN = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'financials.js'), 'utf8');
  assert.match(FIN, /balanceHistory/);
  assert.match(FIN, /cashFlowHistory/);
  assert.match(FIN, /activeTab === 'bs'/);
  assert.match(FIN, /activeTab === 'cf'/);
  assert.match(FIN, /'—'/);                       // existing missing-value convention used in the tables
  assert.match(FIN, /Capital Expenditure/);       // sign-preserving cash-flow row
});

test('income statement view supports a quarterly/annual toggle with no extra fetch', () => {
  const FIN = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'financials.js'), 'utf8');
  assert.match(FIN, /data-inc="q"/);
  assert.match(FIN, /data-inc="a"/);
  assert.match(FIN, /incomeView === 'a' \? annualRows : quarterly/);
  assert.match(FIN, /d\.annual/);
  const toggleBlock = FIN.slice(FIN.indexOf("data-inc=\"q\""), FIN.indexOf("if (!rows.length)"));
  assert.ok(!/fetch/.test(toggleBlock), 'toggle must not trigger a fetch');
});

test('growth view is lazy, cached per symbol and renders reported growth', () => {
  const FIN = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'financials.js'), 'utf8');
  assert.match(FIN, /activeTab === 'gr'/);
  assert.match(FIN, /api\/financials\/\$\{encodeURIComponent\(sym\)\}\/growth/);
  assert.match(FIN, /const growthCache = \{\}/);
  assert.match(FIN, /Loading growth data…/);
  assert.match(FIN, /growthMode !== 'real'/);
  assert.match(FIN, /Reported growth as provided by the data provider/);
  assert.match(FIN, /revenueGrowth/);
  assert.match(FIN, /epsGrowth/);
  assert.match(FIN, /fmtGrowth/);
  assert.match(FIN, /v === 0 \? '0\.0%'/, 'zero growth must render neutrally');
  // Growth must only be requested from the Growth branch.
  const calls = [...FIN.matchAll(/fetchGrowth\(d\.symbol\)/g)].length;
  assert.equal(calls, 1, 'fetchGrowth must only be triggered lazily');
  assert.match(FIN, /activeSym === sym && activeTab === 'gr'/);
});

test('boot history is lazy: only the focused symbol, background prefetch yields', () => {
  // No eager all-universe history (or quote) prefetch at boot or on universe change.
  assert.ok(!/universe\.forEach\([^)]*ensureHistory/.test(FRONTEND_API), 'eager boot history prefetch still present');
  assert.ok(!/universe\.forEach\([^)]*ensureHistory/.test(MAIN), 'eager rerender history prefetch still present');
  assert.ok(!/universe\.forEach\([^)]*ensureQuote/.test(FRONTEND_API), 'eager boot quote prefetch still present');
  assert.match(FRONTEND_API, /const focused = getTracker\(chartState\.focus\);\s*\n\s*if \(focused\) ensureHistory\(focused\);/);
  assert.match(FRONTEND_API, /priority === 'low' \? '\?priority=low' : ''/);
  assert.match(FRONTEND_API, /t\.quoteLoading/, 'on-demand quote requests must be deduplicated per tracker');
  // Selecting a ticker loads its history on demand.
  assert.match(MAIN, /ensureHistory\(getTracker\(sym\)\)/);
});

test('correlation prefetch is background priority and serialized', () => {
  const CORR = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'correlation.js'), 'utf8');
  assert.match(CORR, /api\/history\/\$\{encodeURIComponent\(sym\)\}\?priority=low/);
  assert.match(CORR, /fetchInFlight/, 'correlation prefetch must not park parallel browser connections');
  assert.ok(!/forEach\(sym => \{\s*\n\s*fetchJson/.test(CORR), 'no parallel correlation prefetch loop');
});

test('tracker prices start unavailable — no seeded constants rendered as market data', () => {
  const STORE = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'services', 'store.js'), 'utf8');
  const start = STORE.indexOf('DEFAULT_UNIVERSE = [');
  const universeBlock = STORE.slice(start, STORE.indexOf('];', start));
  assert.ok(!/last:\s*-?\d/.test(universeBlock), 'seeded numeric price in DEFAULT_UNIVERSE');
  assert.ok(!/pct:\s*-?\d/.test(universeBlock), 'seeded numeric pct in DEFAULT_UNIVERSE');
  assert.ok(!/vol:\s*-?\d/.test(universeBlock), 'seeded numeric vol in DEFAULT_UNIVERSE');
  assert.match(universeBlock, /last: null/, 'prices must start null');
  assert.match(STORE, /if \(!priced\) t\.last = null/, 'initTracker must clear non-provider prices');
  assert.ok(!/t\.vol = t\.vol !== undefined \? t\.vol : 5\.0/.test(STORE), 'seeded volume default still present');

  const FORMAT = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'utils', 'format.js'), 'utf8');
  assert.match(FORMAT, /export const fnumOr/);

  const TABLE = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'ticker-table.js'), 'utf8');
  assert.match(TABLE, /fnumOr\(t\.last\)/, 'ticker rows must render the null-safe formatter');
  assert.ok(!/fnum\(t\.last\)/.test(TABLE), 'unguarded price formatter still used');

  const HEAT = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'heatmap.js'), 'utf8');
  assert.match(HEAT, /fnumOr\(rc\.t\.last\)/);
  const TAPE = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'tape.js'), 'utf8');
  assert.match(TAPE, /fnumOr\(t\.last\)/);

  const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'utils', 'demo-engine.js'), 'utf8');
  assert.match(ENGINE, /Number\.isFinite\(t\.last\) && t\.last > 0 \? t\.last : 100/, 'offline fallback needs a neutral base');

  const POLLER = fs.readFileSync(path.join(ROOT, 'src', 'backend', 'services', 'market-poller.js'), 'utf8');
  assert.match(POLLER, /applyQuoteBatch/, 'paced board population must publish partial batches');
  const CACHE = fs.readFileSync(path.join(ROOT, 'src', 'backend', 'services', 'market-cache.js'), 'utf8');
  assert.match(CACHE, /function applyQuoteBatch/);
});

test('render loop survives a failing panel without log storms', () => {
  const SCHED = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'services', 'render-scheduler.js'), 'utf8');
  assert.match(SCHED, /try \{/, 'handlers must be guarded');
  assert.match(SCHED, /finally \{\s*\n\s*requestAnimationFrame\(frame\)/, 'the loop must reschedule even after a handler error');
  assert.match(SCHED, /lastErrorLog/, 'error logging must be coalesced');
  assert.match(SCHED, /now - lastErrorLog\.at > 5000/, 'repeated identical errors must not log every frame');
  const HEATMAP = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'heatmap.js'), 'utf8');
  assert.match(HEATMAP, /import \{[^}]*\bARROW\b[^}]*\} from '\.\.\/utils\/format\.js'/, 'ARROW import must be present');
});

test('ticker-table state/source cells track connection changes', () => {
  const TABLE = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'components', 'ticker-table.js'), 'utf8');
  assert.match(TABLE, /bus\.on\('connection', refreshStateCells\)/, 'rows must refresh when the provider/mode resolves');
  assert.match(TABLE, /refreshStateCells/);
  assert.match(TABLE, /querySelectorAll\('#tk-table tbody tr\.urow'\)/);
  assert.match(TABLE, /td\.src/, 'source cells must be updated too');
  // The refresh must patch cells only — never rebuild rows or touch price cells.
  const fn = TABLE.slice(TABLE.indexOf('export function refreshStateCells'), TABLE.indexOf("bus.on('connection'"));
  assert.ok(!/innerHTML/.test(fn), 'refresh must not recreate rows');
  assert.ok(!/fnum|textContent = fnum/.test(fn), 'refresh must not overwrite price cells');
  const subs = [...TABLE.matchAll(/bus\.on\('connection'/g)].length;
  assert.equal(subs, 1, 'exactly one connection subscription');
});
