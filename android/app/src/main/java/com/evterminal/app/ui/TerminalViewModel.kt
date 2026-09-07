package com.evterminal.app.ui

import androidx.lifecycle.ViewModel
import com.evterminal.app.data.remote.ConnectionState
import com.evterminal.app.data.remote.TerminalWebSocketClient
import com.evterminal.app.data.remote.TelemetryTick
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn

/**
 * Manages the WebSocket lifecycle and exposes telemetry to the UI as
 * lifecycle-aware state flows (sharing stops 5 s after the last collector).
 */
class TerminalViewModel(
    private val wsClient: TerminalWebSocketClient = TerminalWebSocketClient(SERVER_URL)
) : ViewModel() {

    /** Most recent tick, or null before the first message. */
    val latestTick: StateFlow<TelemetryTick?> = wsClient.ticks.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
        initialValue = null
    )

    /** Latest tick per symbol — the shape a watchlist UI renders. */
    val board: StateFlow<Map<String, TelemetryTick>> = wsClient.ticks
        .scan(emptyMap<String, TelemetryTick>()) { acc, tick ->
            acc + (tick.symbol to tick)
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
            initialValue = emptyMap()
        )

    val connectionState: StateFlow<ConnectionState> = wsClient.connectionState.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
        initialValue = ConnectionState.DISCONNECTED
    )

    init {
        connect()
    }

    /** Opens the persistent socket (idempotent). */
    fun connect() {
        wsClient.connect()
    }

    /** Gracefully closes the socket ahead of teardown. */
    fun disconnect() {
        wsClient.disconnect()
    }

    override fun onCleared() {
        // Clean socket teardown — no leaked callbacks after the VM dies.
        wsClient.disconnect()
        super.onCleared()
    }

    companion object {
        /** Emulator alias for the host dev server; use wss://host in production. */
        const val SERVER_URL = "ws://10.0.2.2:3000"
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
