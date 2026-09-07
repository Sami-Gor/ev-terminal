package com.evterminal.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.evterminal.app.ui.TerminalViewModel
import com.evterminal.app.ui.components.ConnectionBadge
import com.evterminal.app.ui.components.EvNewsWireCard
import com.evterminal.app.ui.components.NewsEngineStatusHeader
import com.evterminal.app.ui.components.SectionHeader
import com.evterminal.app.ui.components.TickerCard
import com.evterminal.app.ui.components.VehicleHudCard
import com.evterminal.app.ui.theme.BgDark
import com.evterminal.app.ui.theme.TextDim
import com.evterminal.app.ui.theme.TextPrimary

/**
 * Primary dashboard: connection header → stock tickers → EV telemetry HUD.
 * Collects the ViewModel StateFlows as lifecycle-aware compose state.
 */
@Composable
fun TerminalScreen(viewModel: TerminalViewModel, modifier: Modifier = Modifier) {
    val connectionState by viewModel.connectionState.collectAsStateWithLifecycle()
    val board by viewModel.board.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicles.collectAsStateWithLifecycle()
    val news by viewModel.news.collectAsStateWithLifecycle()
    val selectedSymbol by viewModel.selectedSymbol.collectAsStateWithLifecycle()

    // Sort once per board change (remembered), not on every recomposition.
    val sortedSymbols = remember(board) { board.keys.sorted() }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgDark)
            .padding(10.dp)
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
        ) {
            Text(
                "EVT://TERMINAL",
                color = TextPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            ConnectionBadge(connectionState)
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            item { SectionHeader("STOCK TICKERS · REAL-TIME") }
            // Stable symbol keys let LazyColumn reuse and skip rows across updates.
            items(sortedSymbols.size, key = { sortedSymbols[it] }) { index ->
                val symbol = sortedSymbols[index]
                board[symbol]?.let { tick -> TickerCard(tick) }
            }
            item { SectionHeader("EV TELEMETRY HUD · FLEET") }
            if (vehicles.isEmpty()) {
                item {
                    Text(
                        "awaiting vehicle telemetry…",
                        color = TextDim,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(vertical = 8.dp)
                    )
                }
            }
            // Stable vehicleId keys keep HUD cards identity-stable across refreshes.
            items(vehicles.size, key = { vehicles[it].vehicleId }) { index ->
                VehicleHudCard(vehicles[index])
            }
            item { NewsEngineStatusHeader() }
            item { SectionHeader("EV NEWS WIRE · CORRELATED") }
            // Timestamp keys: newest-first ordering stays identity-stable.
            items(news.size, key = { news[it].timestamp }) { index ->
                val item = news[index]
                EvNewsWireCard(
                    item = item,
                    selectedSymbol = selectedSymbol,
                    onChipClick = viewModel::onTickerChipClick
                )
            }
            item {
                Text(
                    "simulated/provider feed · not investment advice",
                    color = TextDim,
                    fontSize = 9.sp,
                    modifier = Modifier.padding(top = 10.dp)
                )
            }
        }
    }
}
