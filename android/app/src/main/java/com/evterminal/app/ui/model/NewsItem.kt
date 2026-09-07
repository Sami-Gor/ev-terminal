package com.evterminal.app.ui.model

import androidx.compose.runtime.Immutable
import com.evterminal.app.data.model.NewsEvent

enum class Sentiment { BULLISH, NEUTRAL, BEARISH }

enum class NewsPriority { HIGH, MEDIUM, LOW }

/** UI-facing news wire entry (immutable, Compose-stable). */
@Immutable
data class NewsItem(
    val id: String,
    val timestamp: String,
    val tickers: List<String>,
    val sentiment: Sentiment,
    val priority: NewsPriority,
    val impactScore: Int,
    val category: String,
    val tag: String,
    val headline: String
) {
    val isHighImpact: Boolean get() = priority == NewsPriority.HIGH
}

fun NewsEvent.toNewsItem(): NewsItem = NewsItem(
    id = id,
    timestamp = timestamp,
    tickers = tickers,
    sentiment = when (sentiment) {
        "Bullish" -> Sentiment.BULLISH
        "Bearish" -> Sentiment.BEARISH
        else -> Sentiment.NEUTRAL
    },
    priority = when (priority) {
        "High" -> NewsPriority.HIGH
        "Low" -> NewsPriority.LOW
        else -> NewsPriority.MEDIUM
    },
    impactScore = impactScore,
    category = category,
    tag = headlineSummaryTag,
    headline = headline
)
