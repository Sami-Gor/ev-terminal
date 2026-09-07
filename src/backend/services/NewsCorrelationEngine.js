'use strict';

/**
 * NewsCorrelationEngine — rule-based enrichment of raw headlines.
 * Extracts related tickers, sentiment, priority, impact score and a category
 * from headline/summary text via keyword + regex mapping.
 */

const UNIVERSE = [
  { sym: 'TSLA', words: ['tesla', 'model y', 'model 3'] },
  { sym: 'RIVN', words: ['rivian', 'r1t', 'edv'] },
  { sym: 'LCID', words: ['lucid', 'air sedan'] },
  { sym: 'NIO', words: ['nio'] },
  { sym: 'XPEV', words: ['xpeng', 'p7'] },
  { sym: 'LI', words: ['li auto', 'li one'] },
  { sym: 'PSNY', words: ['polestar'] },
  { sym: 'BYDDY', words: ['byd', 'blade'] },
  { sym: '300750.SZ', words: ['catl', 'contemporary amperex', 'lfp', 'cathode', 'cell quotes', 'cell maker'] },
  { sym: '3931.HK', words: ['calb', 'china amperex'] },
  { sym: 'PCRFY', words: ['panasonic', 'separator', 'electrolyte', 'solid-state'] },
  { sym: '373220.KS', words: ['lg energy', 'lg solution'] },
  { sym: 'ALB', words: ['albemarle', 'lithium', 'spodumene', 'carbonate', 'hydroxide'] },
];

const BULLISH = [
  'outperform', 'gain', 'gains', 'firms', 'higher', 'beat', 'beats', 'lifts',
  'climbs', 'strength', 'top consensus', 'revised higher', 'clears', 'improve',
  'improves', 'extends', 'accelerate', 'accelerates', 'lead', 'leads',
];
const BEARISH = [
  'eases', 'falls', 'fall', 'drop', 'drops', 'weak', 'misses', 'miss', 'slips',
  'declines', 'decline', 'cuts', 'cut ', 'denies', 'slides', 'cools',
];
const HIGH_PRIORITY = [
  'closing bell', 'delivery beat', 'delivery-day', 'deliveries', 'recall',
  'guidance', 'earnings', 'outperform', 'production', 'wholesale estimates',
  'top consensus', 'restocking',
];
const LOW_PRIORITY = [
  'rangebound', 'little changed', 'stable', 'flat', 'unchanged', 'calendar',
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'into', 'as',
  'at', 'by', 'with', 'per', 'after', 'over', 'up', 'down', 'ev', 'us', 'eu',
  'tape', 'wire', 'demo', 'desk', 'note', 'review', 'session', 'names',
]);

function hasAny(text, words) {
  return words.some(w => text.includes(w));
}

// Basket keywords map one phrase to a group of symbols.
const BASKETS = [
  { words: ['ev names', 'ev universe', 'ev cohort', 'ev tape', 'pure-play', 'nev', 'adr complex', 'platform cohort', 'platform-economy'], syms: ['TSLA', 'RIVN', 'NIO', 'XPEV', 'LI'] },
  { words: ['battery names', 'cell makers', 'cell quotes', 'battery-grade'], syms: ['300750.SZ', '3931.HK', 'PCRFY'] },
];

function extractTickers(text) {
  const found = new Set();
  for (const entry of UNIVERSE) {
    if (hasAny(text, entry.words)) found.add(entry.sym);
  }
  for (const basket of BASKETS) {
    if (hasAny(text, basket.words)) basket.syms.forEach(s => found.add(s));
  }
  return [...found];
}

function extractCategory(text) {
  const t = text.toLowerCase();
  if (/solid-state|pilot-line|next-gen|chemistry/.test(t)) return 'Cell Tech';
  if (/lithium|cathode|cell |cells|spodumene|carbonate|hydroxide|electrolyte|separator|lfp|restocking/.test(t)) return 'Supply Chain';
  if (/deliver|wholesale|nev|registrations|order books|production|platform/.test(t)) return 'OEM Catalysts';
  if (/closing bell|week in review|midday|cash open| asia |session/.test(t)) return 'Session Wrap';
  if (/pricing|price|quotes|auction|margin/.test(t)) return 'Pricing';
  if (/fed|macro|durable goods|rate futures|policy|calendar/.test(t)) return 'Macro';
  return 'Market Watch';
}

function extractSentiment(text) {
  if (hasAny(text, BULLISH)) return 'Bullish';
  if (hasAny(text, BEARISH)) return 'Bearish';
  return 'Neutral';
}

function extractPriority(text, sentiment) {
  const t = text.toLowerCase();
  if (hasAny(t, HIGH_PRIORITY)) return 'High';
  if (hasAny(t, LOW_PRIORITY)) return 'Low';
  return sentiment === 'Neutral' ? 'Medium' : 'Medium';
}

function extractImpact(text, sentiment, priority) {
  const base = priority === 'High' ? 8 : priority === 'Medium' ? 5 : 3;
  const boost = sentiment === 'Neutral' ? 0 : Math.min(Math.round(Math.random()), 1);
  return Math.max(1, Math.min(10, base + boost));
}

function summaryTag(headline) {
  const words = headline
    .replace(/[—:-]/g, ' ')
    .split(/\s+/)
    .filter(w => /^[A-Za-z]{3,}$/.test(w) && !STOPWORDS.has(w.toLowerCase()));
  return (words.slice(0, 3).join(' ') || 'MARKET WIRE').toUpperCase();
}

/**
 * Enriches a raw headline (+ optional summary) with tickers, sentiment,
 * priority, impact score, category and a 3-word summary tag.
 *
 * @param {{ headline: string, summary?: string }} raw
 * @returns {{ tickers: string[], sentiment: string, priority: string,
 *             impactScore: number, category: string, headlineSummaryTag: string }}
 */
function enrichHeadline(raw) {
  const text = `${raw.headline} ${raw.summary || ''}`.toLowerCase();
  const tickers = extractTickers(text);
  const sentiment = extractSentiment(text);
  const priority = extractPriority(text, sentiment);
  const impactScore = extractImpact(text, sentiment, priority);
  const category = extractCategory(text);
  const headlineSummaryTag = summaryTag(raw.headline);
  return { tickers, sentiment, priority, impactScore, category, headlineSummaryTag };
}

module.exports = { enrichHeadline };
