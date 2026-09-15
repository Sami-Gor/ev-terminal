package com.evterminal.app.data.remote

import com.evterminal.app.data.model.MarketSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

/** REST access to the backend's in-memory market cache (GET /api/market). */
class MarketApi(
    private val baseUrl: String = NetworkModule.restBaseUrl,
    /** Origin header expected by the backend allowlist — not authentication. */
    private val origin: String = NetworkModule.apiOrigin,
    /** Shared singleton client — same pool/dispatcher as the WebSocket feed. */
    private val client: OkHttpClient = NetworkModule.okHttpClient
) {

    /** Fetches the latest cache snapshot; null on any network/parse failure. */
    suspend fun fetchSnapshot(): MarketSnapshot? = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/api/market")
                .header("Origin", origin)
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@runCatching null
                val body = response.body?.string() ?: return@runCatching null
                MarketSnapshot.fromJson(JSONObject(body))
            }
        }.getOrNull()
    }
}
