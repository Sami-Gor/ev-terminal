'use strict';

/**
 * News event model — enriched by the topic-correlation engine before it
 * reaches clients. Immutable once constructed; serialized via toJSON().
 */
class NewsEvent {
  /**
   * @param {object} fields
   * @param {string}   fields.id                 stable unique id
   * @param {string}   fields.timestamp          ISO-8601 timestamp
   * @param {string[]} fields.tickers            related EV/battery symbols
   * @param {string}   fields.sentiment          'Bullish' | 'Neutral' | 'Bearish'
   * @param {string}   fields.priority           'High' | 'Medium' | 'Low'
   * @param {number}   fields.impactScore        1–10
   * @param {string}   fields.category           e.g. 'Session Wrap' | 'OEM Catalysts'
   *                                             | 'Supply Chain' | 'Cell Tech' | 'Pricing'
   * @param {string}   fields.headlineSummaryTag 3-word summary tag
   * @param {string}   fields.headline
   * @param {string}   fields.summary
   */
  constructor(fields) {
    this.id = fields.id;
    this.timestamp = fields.timestamp;
    this.tickers = fields.tickers;
    this.sentiment = fields.sentiment;
    this.priority = fields.priority;
    this.impactScore = fields.impactScore;
    this.category = fields.category;
    this.headlineSummaryTag = fields.headlineSummaryTag;
    this.headline = fields.headline;
    this.summary = fields.summary;
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      tickers: this.tickers,
      sentiment: this.sentiment,
      priority: this.priority,
      impactScore: this.impactScore,
      category: this.category,
      headlineSummaryTag: this.headlineSummaryTag,
      headline: this.headline,
      summary: this.summary,
    };
  }
}

module.exports = { NewsEvent };
