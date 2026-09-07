package com.evterminal.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Terminal palette (mirrors the web theme; HC variants handled by the toggle there).
val Amber = Color(0xFFF28C00)
val Green = Color(0xFF00C176)
val Red = Color(0xFFE5484D)
val Cyan = Color(0xFF58A6FF)
val SurfaceDark = Color(0xFF0B0C0D)
val SurfaceDark2 = Color(0xFF0E0F11)
val BgDark = Color(0xFF060607)
val LineDark = Color(0xFF26282B)
val TextPrimary = Color(0xFFC9D1D9)
val TextDim = Color(0xFF8B949E)

private val TerminalColorScheme = darkColorScheme(
    primary = Amber,
    secondary = Cyan,
    background = BgDark,
    surface = SurfaceDark,
    surfaceVariant = SurfaceDark2,
    onPrimary = Color.Black,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    error = Red
)

@Composable
fun EvtTheme(content: @Composable () -> Unit) {
    // The terminal is dark-first; isSystemInDarkTheme kept for light-system parity later.
    MaterialTheme(
        colorScheme = TerminalColorScheme,
        content = content
    )
}
