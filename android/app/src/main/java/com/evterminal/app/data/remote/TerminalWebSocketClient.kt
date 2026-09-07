package com.evterminal.app.data.remote

import com.evterminal.app.data.model.TelemetryTick
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

enum class ConnectionState { CONNECTING, CONNECTED, CLOSING, DISCONNECTED, FAILED }

/**
 * OkHttp-backed persistent WebSocket client for the EVT://TERMINAL feed.
 *
 * - Shares the singleton [OkHttpClient] (NetworkModule) — pingInterval keeps
 *   the socket alive and detects dropped frames.
 * - Automatically sends the JSON subscribe payload on open.
 * - Incoming ticks are exposed as a hot [SharedFlow]; parsing runs on the
 *   OkHttp reader thread, never on the main thread.
 * - Automatic reconnection with capped exponential backoff on failure or
 *   server-initiated close (user-initiated closes do not reconnect).
 *
 * Note on the payload: the backend protocol is `{"type":"subscribe","symbols":[…]}`.
 */
class TerminalWebSocketClient(
    /** Emulator default reaches the host dev server; use wss://… in production. */
    private val url: String = DEFAULT_URL,
    /** Symbols subscribed on open; an empty list receives the full board. */
    private val symbols: List<String> = DEFAULT_SYMBOLS,
    /** The backend allowlists upgrade requests by Origin header. */
    private val origin: String = DEFAULT_ORIGIN,
    /** Shared singleton client — do not build a second one. */
    private val client: OkHttpClient = NetworkModule.okHttpClient
) {

    private val reconnectHandler = Handler(Looper.getMainLooper())
    private var webSocket: WebSocket? = null
    private var userClosed = false
    private var reconnectAttempt = 0

    /** Hot stream of incoming telemetry ticks. */
    private val _ticks = MutableSharedFlow<TelemetryTick>(replay = 32, extraBufferCapacity = 64)
    val ticks: SharedFlow<TelemetryTick> = _ticks

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    val isConnected: Boolean
        get() = _connectionState.value == ConnectionState.CONNECTED

    /** Opens the persistent socket; idempotent while connect/close is in flight. */
    fun connect() {
        if (_connectionState.value == ConnectionState.CONNECTING ||
            _connectionState.value == ConnectionState.CONNECTED ||
            _connectionState.value == ConnectionState.CLOSING
        ) return
        userClosed = false
        reconnectAttempt = 0
        _connectionState.value = ConnectionState.CONNECTING
        val request = Request.Builder()
            .url(url)
            .header("Origin", origin)
            .build()
        webSocket = client.newWebSocket(request, listener)
    }

    /** Gracefully closes the socket (code 1000) and suppresses auto-reconnect. */
    fun disconnect() {
        userClosed = true
        reconnectHandler.removeCallbacksAndMessages(null)
        if (_connectionState.value == ConnectionState.CLOSING) return
        _connectionState.value = ConnectionState.CLOSING
        webSocket?.close(NORMAL_CLOSE_CODE, "client shutting down")
        webSocket = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    /** Sends a raw text frame; returns false when the socket is not open. */
    fun send(text: String): Boolean = webSocket?.send(text) ?: false

    private val listener = object : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            reconnectAttempt = 0
            _connectionState.value = ConnectionState.CONNECTED
            // Auto-subscribe as soon as the socket is live.
            val payload = JSONObject()
                .put("type", "subscribe")
                .put("symbols", JSONArray(symbols))
            webSocket.send(payload.toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            // Runs on the OkHttp reader thread — parsing stays off the main thread.
            parseTick(text)?.let { tick ->
                // The connect-time snapshot covers the full board; keep only the
                // symbols this client actually subscribed to.
                if (symbols.isEmpty() || symbols.contains(tick.symbol)) {
                    _ticks.tryEmit(tick)
                }
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(NORMAL_CLOSE_CODE, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            this@TerminalWebSocketClient.webSocket = null
            _connectionState.value = ConnectionState.DISCONNECTED
            if (!userClosed) scheduleReconnect()       // server-initiated close
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            this@TerminalWebSocketClient.webSocket = null
            _connectionState.value = ConnectionState.FAILED
            if (!userClosed) scheduleReconnect()       // drop / timeout / handshake error
        }
    }

    /** Capped exponential backoff: 1 s → 2 s → 4 s → … → 30 s ceiling. */
    private fun scheduleReconnect() {
        reconnectAttempt++
        val delayMs = minOf(1000L shl (reconnectAttempt - 1).coerceAtMost(5), RECONNECT_MAX_MS)
        reconnectHandler.postDelayed({ if (!userClosed) connect() }, delayMs)
    }

    private fun parseTick(text: String): TelemetryTick? = runCatching {
        val obj = JSONObject(text)
        if (obj.optString("type") != "tick") return@runCatching null
        TelemetryTick.fromJson(obj)
    }.getOrNull()

    companion object {
        /** 10.0.2.2 is the Android emulator's alias for the host machine's loopback. */
        const val DEFAULT_URL = "ws://10.0.2.2:3000"
        const val DEFAULT_ORIGIN = "http://localhost:3000"
        val DEFAULT_SYMBOLS = listOf("TSLA", "RIVN")
        const val NORMAL_CLOSE_CODE = 1000
        const val RECONNECT_MAX_MS = 30_000L
    }
}
