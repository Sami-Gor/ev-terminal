package com.evterminal.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.evterminal.app.ui.screens.TerminalScreen
import com.evterminal.app.ui.theme.EvtTheme

/**
 * Hosts the Compose dashboard. The [TerminalViewModel] is scope-bound to this
 * activity; its socket is disconnected in onCleared() when the activity dies.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            EvtTheme {
                TerminalScreen(viewModel = TerminalViewModel())
            }
        }
    }
}
