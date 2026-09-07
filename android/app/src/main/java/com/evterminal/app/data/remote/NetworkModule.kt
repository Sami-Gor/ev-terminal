package com.evterminal.app.data.remote

import com.evterminal.app.BuildConfig
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Central network provider — a single process-wide [OkHttpClient].
 *
 * A shared instance means all consumers (WebSocket feed, market REST, news
 * REST) share the same connection pool and dispatcher threads.
 *
 * - pingInterval keeps WebSocket streams alive and fails dead connections
 *   (15 s of silence is treated as a dropped frame).
 * - connect/read timeouts bound REST calls; they do not kill the WebSocket,
 *   whose liveness is governed by the ping interval.
 */
object NetworkModule {

    /** WebSocket endpoint — debug: ws://10.0.2.2:3000, release: wss://your-domain.com. */
    val wsBaseUrl: String = BuildConfig.WS_BASE_URL

    /** REST endpoint — debug: http://10.0.2.2:3000, release: https://your-domain.com. */
    val restBaseUrl: String = BuildConfig.REST_BASE_URL

    /** Thread-safe lazy singleton (SYNCHRONIZED by default). */
    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .pingInterval(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
