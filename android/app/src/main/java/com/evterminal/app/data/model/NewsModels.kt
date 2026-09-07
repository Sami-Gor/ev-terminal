package com.evterminal.app.data.model

import org.json.JSONArray
import org.json.JSONObject

/** Backend news event enriched by the topic-correlation engine. */
data class NewsEvent(
    val id: String,
    val timestamp: String,
    val tickers: List<String>,
    val sentiment: String,          // Bullish | Neutral | Bearish
    val priority: String,           // High | Medium | Low
    val impactScore: Int,           // 1–10
    val category: String,           // Session Wrap | OEM Catalysts | Supply Chain | Cell Tech | Pricing…
    val headlineSummaryTag: String, // 3-word summary tag
    val headline: String,
    val summary: String
) {
    companion object {
        fun fromJson(obj: JSONObject): NewsEvent = NewsEvent(
            id = obj.optString("id", ""),
            timestamp = obj.optString("timestamp", ""),
            tickers = obj.optJSONArray("tickers")?.let { arr ->
                (0 until arr.length()).mapNotNull { i -> arr.optString(i).takeIf { s -> s.isNotEmpty() } }
            } ?: emptyList(),
            sentiment = obj.optString("sentiment", "Neutral"),
            priority = obj.optString("priority", "Medium"),
            impactScore = obj.optInt("impactScore", 0),
            category = obj.optString("category", "Market Watch"),
            headlineSummaryTag = obj.optString("headlineSummaryTag", ""),
            headline = obj.optString("headline", ""),
            summary = obj.optString("summary", "")
        )

        fun fromArray(json: JSONArray): List<NewsEvent> =
            (0 until json.length()).mapNotNull { i -> json.optJSONObject(i)?.let { fromJson(it) } }
    }
}
