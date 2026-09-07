package com.evterminal.app.data.remote

import com.evterminal.app.data.model.MarketSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** REST access to the backend's in-memory market cache (GET /api/market). */
class MarketApi(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val origin: String = DEFAULT_ORIGIN,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(10, TimeUnit.SECONDS)
        .build()
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

    companion object {
        const val DEFAULT_BASE_URL = "http://10.0.2.2:3000"
        const val DEFAULT_ORIGIN = "http://localhost:3000"
    }
}
