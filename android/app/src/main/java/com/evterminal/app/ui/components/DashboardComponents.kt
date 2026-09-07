package com.evterminal.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import com.evterminal.app.data.model.TelemetryTick
import com.evterminal.app.data.model.VehicleTelemetry
import com.evterminal.app.data.remote.ConnectionState
import com.evterminal.app.ui.theme.Amber
import com.evterminal.app.ui.theme.Green
import com.evterminal.app.ui.theme.LineDark
import com.evterminal.app.ui.model.NewsItem
import com.evterminal.app.ui.model.NewsPriority
import com.evterminal.app.ui.model.Sentiment
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
                    "$dirGlyph ${sign}${String.format(Locale.US, "%.2f", kotlin.math.abs(tick.percentChange))}%",
                    color = arrowColor,
                    fontSize = 12.sp
                )
            }
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("$" + String.format(Locale.US, "%,.2f", tick.price), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text("vol " + String.format(Locale.US, "%,.0f", tick.volume), color = Color(0xFF8B949E), fontSize = 10.sp)
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

            Text("SoC ${String.format(Locale.US, "%.1f", vehicle.socPct)}%", color = Green, fontSize = 11.sp)
            LinearProgressIndicator(
                progress = { (vehicle.socPct / 100.0).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(6.dp),
                color = Green,
                trackColor = LineDark
            )
            Spacer(Modifier.height(8.dp))

            HudRow("Range", "${vehicle.rangeKm} km")
            HudRow("Battery", "${String.format(Locale.US, "%.1f", vehicle.batteryTempC)} °C")
            HudRow("Motor", "${String.format(Locale.US, "%.1f", vehicle.motorTempC)} °C")
            HudRow("Charging", "${String.format(Locale.US, "%.1f", vehicle.chargingKw)} kW")
            HudRow("Odometer", "${String.format(Locale.US, "%,.0f", vehicle.odometerKm)} km")
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


/* ===== EV news wire (enriched by the topic-correlation engine) ===== */

private val SentimentGreen = Color(0xFF00C176)
private val SentimentRed = Color(0xFFE5484D)
private val SentimentNeutral = Color(0xFF8B949E)

/** System status strip shown above the news wire. */
@Composable
fun NewsEngineStatusHeader(modifier: Modifier = Modifier) {
    Text(
        "System Status: Built-in EV Maker Topic Correlation Engine (Active)",
        color = Green,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier.padding(bottom = 6.dp)
    )
}

/** Pill-style clickable ticker chip — taps focus the symbol across panels. */
@Composable
fun TickerChip(symbol: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val borderColor = if (selected) Amber else LineDark
    val textColor = if (selected) Amber else Color(0xFFC9D1D9)
    Text(
        symbol,
        color = textColor,
        fontSize = 9.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier
            .background(if (selected) Color(0xFF2A1D08) else Color(0xFF14161A))
            .border(1.dp, borderColor, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

/** Horizontal sentiment + impact bar: length = impact (1–10), hue = sentiment. */
@Composable
fun SentimentImpactBar(sentiment: Sentiment, impactScore: Int, modifier: Modifier = Modifier) {
    val barColor = when (sentiment) {
        Sentiment.BULLISH -> SentimentGreen
        Sentiment.BEARISH -> SentimentRed
        Sentiment.NEUTRAL -> SentimentNeutral
    }
    val fraction = impactScore.coerceIn(1, 10) / 10f
    val glyph = when (sentiment) {
        Sentiment.BULLISH -> "▲"
        Sentiment.BEARISH -> "▼"
        Sentiment.NEUTRAL -> "•"
    }
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(glyph, color = barColor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(4.dp))
        Box(
            Modifier
                .width(72.dp)
                .height(4.dp)
                .background(Color(0xFF26282B), RoundedCornerShape(2.dp))
        ) {
            Box(
                Modifier
                    .fillMaxWidth(fraction)
                    .height(4.dp)
                    .background(barColor, RoundedCornerShape(2.dp))
            )
        }
    }
}

/** Priority marker — 🔥 flags high-impact items. */
@Composable
fun PriorityIcon(priority: NewsPriority, modifier: Modifier = Modifier) {
    val (icon, color) = when (priority) {
        NewsPriority.HIGH -> "🔥" to Red
        NewsPriority.MEDIUM -> "▲" to Amber
        NewsPriority.LOW -> "·" to Color(0xFF8B949E)
    }
    Text(icon, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = modifier)
}

/**
 * Dense news micro-card: time · sentiment/impact bar · ticker chips ·
 * category · priority · headline (high-impact cards get a red frame).
 */
@Composable
fun EvNewsWireCard(
    item: NewsItem,
    selectedSymbol: String?,
    onChipClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val sentimentColor = when (item.sentiment) {
        Sentiment.BULLISH -> SentimentGreen
        Sentiment.BEARISH -> SentimentRed
        Sentiment.NEUTRAL -> SentimentNeutral
    }
    val time = remember(item.timestamp) { item.timestamp.drop(11).take(8) }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (item.isHighImpact) Color(0xFF17110A) else Color(0xFF0E0F11)
        ),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (item.isHighImpact) Red.copy(alpha = 0.35f) else LineDark
        )
    ) {
        Column(Modifier.padding(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(time, color = Color(0xFF8B949E), fontSize = 9.sp)
                Spacer(Modifier.width(8.dp))
                SentimentImpactBar(item.sentiment, item.impactScore)
                Spacer(Modifier.width(8.dp))
                PriorityIcon(item.priority)
                Spacer(Modifier.weight(1f))
                Text(
                    item.category.uppercase(),
                    color = Amber,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.height(4.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp, alignment = Alignment.Start)
            ) {
                item.tickers.forEach { symbol ->
                    TickerChip(
                        symbol = symbol,
                        selected = symbol == selectedSymbol,
                        onClick = { onChipClick(symbol) }
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(item.headline, color = Color(0xFFC9D1D9), fontSize = 11.sp)
            Text(item.tag, color = sentimentColor, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }
    }
}
