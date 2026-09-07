package com.evterminal.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.evterminal.app.ui.TerminalViewModel
import com.evterminal.app.ui.components.ConnectionBadge
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
                fontSize = androidx.compose.ui.unit.TextUnit(18f, androidx.compose.ui.unit.TextUnitType.Sp),
                fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
            )
            ConnectionBadge(connectionState)
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            item { SectionHeader("STOCK TICKERS · REAL-TIME") }
            val sorted = board.entries.sortedBy { it.key }
            items(sorted.size) { index ->
                val (symbol, tick) = sorted[index]
                TickerCard(tick.copy(symbol = symbol))
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
            items(vehicles.size) { index -> VehicleHudCard(vehicles[index]) }
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
