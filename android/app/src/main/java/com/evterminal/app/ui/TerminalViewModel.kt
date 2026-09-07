package com.evterminal.app.ui

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ProcessLifecycleOwner
import com.evterminal.app.data.model.NewsEvent
import com.evterminal.app.data.model.TelemetryTick
import com.evterminal.app.data.model.VehicleTelemetry
import com.evterminal.app.data.remote.ConnectionState
import com.evterminal.app.data.remote.MarketApi
import com.evterminal.app.data.remote.NewsApi
import com.evterminal.app.data.remote.TerminalWebSocketClient
import com.evterminal.app.ui.model.NewsItem
import com.evterminal.app.ui.model.toNewsItem
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Manages the WebSocket lifecycle and exposes telemetry to the UI as
 * lifecycle-aware state flows (sharing stops 5 s after the last collector).
 *
 * Process-lifecycle aware: the socket connects on app ON_START and
 * disconnects on app ON_STOP; vehicle polling pauses in the background.
 */
class TerminalViewModel(
    private val wsClient: TerminalWebSocketClient = TerminalWebSocketClient(SERVER_URL),
    private val marketApi: MarketApi = MarketApi(SERVER_URL),
    private val newsApi: NewsApi = NewsApi(SERVER_URL)
) : ViewModel(), DefaultLifecycleObserver {

    /** Symbol focused via news-wire ticker chips (drives cross-panel highlighting). */
    private val _selectedSymbol = MutableStateFlow<String?>(null)
    val selectedSymbol: StateFlow<String?> = _selectedSymbol.asStateFlow()

    private val _newsEvents = MutableStateFlow<List<NewsEvent>>(emptyList())

    /** Enriched news wire — conflated so intermediate un-rendered frames are dropped. */
    val news: StateFlow<List<NewsItem>> = _newsEvents
        .conflate()
        .map { events -> events.map { it.toNewsItem() } }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
            initialValue = emptyList()
        )

    /** EV fleet telemetry, refreshed from GET /api/market on a fixed cadence. */
    private val _vehicles = MutableStateFlow<List<VehicleTelemetry>>(emptyList())
    val vehicles: StateFlow<List<VehicleTelemetry>> = _vehicles.asStateFlow()

    private val appResumed = MutableStateFlow(false)

    /** Most recent tick, or null before the first message. */
    val latestTick: StateFlow<TelemetryTick?> = wsClient.ticks
        .conflate()                                    // drop stale ticks if the collector lags
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
            initialValue = null
        )

    /** Latest tick per symbol — the shape a watchlist UI renders. */
    val board: StateFlow<Map<String, TelemetryTick>> = wsClient.ticks
        .conflate()                                    // collapse bursts before scan/map work
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
        // App foreground/background drives the socket + polling (battery-aware).
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        connect()
        // Vehicle telemetry rides the REST cache (the WS feed carries price ticks).
        viewModelScope.launch {
            while (isActive) {
                if (appResumed.value) {
                    marketApi.fetchSnapshot()?.let { snapshot ->
                        _vehicles.value = snapshot.vehicles
                    }
                    newsApi.fetchNews().takeIf { it.isNotEmpty() }?.let { events ->
                        _newsEvents.value = events
                    }
                }
                delay(VEHICLE_REFRESH_MS)
            }
        }
    }

    /** News-wire chip tap: focuses the symbol across terminal panels. */
    fun onTickerChipClick(symbol: String) {
        _selectedSymbol.value = if (_selectedSymbol.value == symbol) null else symbol
    }

    /** App returned to the foreground — reconnect and resume polling. */
    override fun onStart(owner: LifecycleOwner) {
        appResumed.value = true
        connect()
    }

    /** App backgrounded — suspend the socket and telemetry polling. */
    override fun onStop(owner: LifecycleOwner) {
        appResumed.value = false
        disconnect()
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
        ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
        wsClient.disconnect()
        super.onCleared()
    }

    companion object {
        /** Emulator alias for the host dev server; use wss://host in production. */
        const val SERVER_URL = "ws://10.0.2.2:3000"
        const val STOP_TIMEOUT_MS = 5_000L
        const val VEHICLE_REFRESH_MS = 15_000L
    }
}
