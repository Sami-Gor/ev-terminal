package com.evterminal.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel
import com.evterminal.app.ui.screens.TerminalScreen
import com.evterminal.app.ui.theme.EvtTheme

/**
 * Hosts the Compose dashboard. The [TerminalViewModel] is scoped to the
 * activity's ViewModelStore via viewModel() — it survives configuration
 * changes (no socket churn on rotation) and onCleared() runs on finish.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            EvtTheme {
                val viewModel: TerminalViewModel = viewModel()
                TerminalScreen(viewModel = viewModel)
            }
        }
    }
}
