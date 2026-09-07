package com.evterminal.app.data.remote

import com.evterminal.app.data.model.NewsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

/** REST access to the enriched news wire (GET /api/news). */
class NewsApi(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val origin: String = DEFAULT_ORIGIN,
    /** Shared singleton client — same pool/dispatcher as the WebSocket feed. */
    private val client: OkHttpClient = NetworkModule.okHttpClient
) {

    /** Fetches the enriched news list; null on any network/parse failure. */
    suspend fun fetchNews(): List<NewsEvent> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/api/news")
                .header("Origin", origin)
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@runCatching emptyList()
                val body = response.body?.string() ?: return@runCatching emptyList()
                val root = JSONObject(body)
                NewsEvent.fromArray(root.optJSONArray("news") ?: return@runCatching emptyList())
            }
        }.getOrDefault(emptyList())
    }

    companion object {
        const val DEFAULT_BASE_URL = "http://10.0.2.2:3000"
        const val DEFAULT_ORIGIN = "http://localhost:3000"
    }
}
