package com.evterminal.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.evterminal.app.data.model.TelemetryTick
import com.evterminal.app.data.model.VehicleTelemetry
import com.evterminal.app.data.remote.ConnectionState
import com.evterminal.app.ui.theme.Amber
import com.evterminal.app.ui.theme.Green
import com.evterminal.app.ui.theme.LineDark
import com.evterminal.app.ui.theme.Red

/** Connection badge — style switches with the state (green LIVE, amber RECONNECTING…). */
@Composable
fun ConnectionBadge(state: ConnectionState, modifier: Modifier = Modifier) {
    val (color, label) = when (state) {
        ConnectionState.CONNECTED -> Green to "● LIVE"
        ConnectionState.CONNECTING, ConnectionState.CLOSING -> Amber to "● RECONNECTING"
        ConnectionState.FAILED -> Red to "● OFFLINE"
        ConnectionState.DISCONNECTED -> Color(0xFF8B949E) to "● DISCONNECTED"
    }
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
        color = Color(0xFF14120C),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.5f))
    ) {
        Text(
            text = label,
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
        )
    }
}

/** One real-time stock quote row/card. ▲/▼ glyphs carry meaning without color. */
@Composable
fun TickerCard(tick: TelemetryTick, modifier: Modifier = Modifier) {
    val up = tick.percentChange >= 0
    val dirGlyph = if (up) "▲" else "▼"
    val sign = if (up) "+" else "−"
    val arrowColor = if (up) Green else Red

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0E0F11)),
        border = androidx.compose.foundation.BorderStroke(1.dp, LineDark)
    ) {
        Column(Modifier.padding(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(tick.symbol, color = Amber, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(
                    "$dirGlyph ${sign}${"%.2f".format(kotlin.math.abs(tick.percentChange))}%",
                    color = arrowColor,
                    fontSize = 12.sp
                )
            }
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("$" + "%,.2f".format(tick.price), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text("vol " + "%,.0f".format(tick.volume), color = Color(0xFF8B949E), fontSize = 10.sp)
            }
        }
    }
}

/** EV telemetry HUD card: SoC bar + range/temps/charging/odometer readouts. */
@Composable
fun VehicleHudCard(vehicle: VehicleTelemetry, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0E0F11)),
        border = androidx.compose.foundation.BorderStroke(1.dp, LineDark)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(vehicle.model, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text(
                    vehicle.status.uppercase(),
                    color = if (vehicle.status == "charging") Green else Amber,
                    fontSize = 10.sp
                )
            }
            Text(vehicle.vehicleId, color = Color(0xFF8B949E), fontSize = 10.sp)
            Spacer(Modifier.height(8.dp))

            Text("SoC ${"%.1f".format(vehicle.socPct)}%", color = Green, fontSize = 11.sp)
            LinearProgressIndicator(
                progress = { (vehicle.socPct / 100.0).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(6.dp),
                color = Green,
                trackColor = LineDark
            )
            Spacer(Modifier.height(8.dp))

            HudRow("Range", "${vehicle.rangeKm} km")
            HudRow("Battery", "${"%.1f".format(vehicle.batteryTempC)} °C")
            HudRow("Motor", "${"%.1f".format(vehicle.motorTempC)} °C")
            HudRow("Charging", "${"%.1f".format(vehicle.chargingKw)} kW")
            HudRow("Odometer", "${"%,.0f".format(vehicle.odometerKm)} km")
        }
    }
}

@Composable
private fun HudRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Color(0xFF8B949E), fontSize = 11.sp)
        Text(value, color = Color(0xFFC9D1D9), fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

/** Section header used across the dashboard. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    Text(
        title,
        color = Amber,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier.padding(top = 12.dp, bottom = 6.dp)
    )
}
