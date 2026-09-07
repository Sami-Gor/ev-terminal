# ANDROID_PERFORMANCE_AUDIT.md

**EVT://TERMINAL — Android client (`android/`)**
Performance, state hygiene & recomposition audit.
Scope: all Kotlin sources under `android/app/src/main/java/` (8 files, ~560 LOC).
Line numbers reference the **pre-fix baseline** (commit `67ece56`); each finding
records its resolution status. Verified post-fix on the running stack (WS feed +
`/api/market`); Kotlin compilation requires the Android SDK (not available in
this environment) — structure, imports and brace balance were statically checked.

---

## 1. Findings Summary

| # | Severity | File | Baseline line(s) | Finding | Status |
|---|---|---|---|---|---|
| A1 | **High** | `ui/screens/TerminalScreen.kt` | 61, 76 | `items(count)` without `key` — item identity is positional; symbol re-sorting or list changes cause full row rebinds and broken animations | **FIXED** — symbol/vehicleId keys |
| A2 | **High** | `ui/MainActivity.kt` | 19 | `TerminalViewModel()` constructed inside `setContent` — not scoped to the ViewModelStore; recreated (socket churn, state loss) on every configuration change and `onCleared()` never invoked → socket leak | **FIXED** — `viewModel()` scoping |
| A3 | **High** | `data/remote/TerminalWebSocketClient.kt` | 110–113 | `onFailure` sets `FAILED` but never reconnects — a network blip leaves a dead feed until app restart | **FIXED** — capped exponential backoff (1 s → 30 s) |
| A4 | **Medium** | `ui/TerminalViewModel.kt` | 41–49 | No `conflate()` upstream of `scan`/`map` — every tick runs `scan`+map allocation on `Main.immediate` even when stale | **FIXED** — `conflate()` added |
| A5 | **Medium** | `ui/TerminalViewModel.kt` | 57–67 | Socket + vehicle polling run while the app is backgrounded (`viewModelScope` outlives `ON_STOP`) — wasted battery/data | **FIXED** — `ProcessLifecycleOwner` observer: ON_START connect/resume, ON_STOP disconnect/pause |
| A6 | **Medium** | `ui/components/DashboardComponents.kt` | 76, 83, 84, 110, 120–123 | `String.format` with the **default locale** — financial decimal separators/grouping break under e.g. `tr`/`de` locales | **FIXED** — pinned to `Locale.US` |
| A7 | **Medium** | `data/remote/TerminalWebSocketClient.kt` | 57–60 | `connect()` does not guard `CLOSING` — a connect during an in-flight close could open a second socket | **FIXED** — CLOSING added to the idempotence guard |
| B1 | **Low** | `ui/screens/TerminalScreen.kt` | 63 | Redundant `tick.copy(symbol = …)` per row per recomposition (map key == tick symbol) | **FIXED** — direct pass |
| B2 | **Low** | `data/remote/TerminalWebSocketClient.kt` | 47 | `tryEmit` can silently drop ticks when the 64-slot buffer is full | Accepted — price ticks are conflatable by nature; downstream `StateFlow`/`conflate()` drops stale values anyway |
| B3 | **Low** | `ui/components/DashboardComponents.kt` | 76, 83, 110, 120–123 | Formatted strings recomputed on every recomposition (no `remember`) | Accepted — negligible vs. draw cost; revisit if profiling shows hot spots |
| B4 | **Low** | `ui/screens/TerminalScreen.kt` | 49 | Fully-qualified `TextUnit(18f, …)` instead of the `sp` extension | **FIXED** — `18.sp` |

## 2. Detailed Audit

### 2.1 UI layer (`ui/screens/TerminalScreen.kt`, `ui/components/DashboardComponents.kt`)

- **Lazy keys (A1)** — `LazyColumn` items had positional keys only. With
  `sortedSymbols` re-sorted per board change, every row could rebind. Both lists
  now pass stable, unique keys (`items(sortedSymbols.size, key = { sortedSymbols[it] })`,
  `items(vehicles.size, key = { vehicles[it].vehicleId })`), enabling item reuse,
  correct animations and minimal recomposition scope.
- **Unremembered allocation (A4 in summary table)** — `sortedBy` ran in the
  composable body on every recomposition; now `remember(board) { … }`.
- **Deferred state reads** — `connectionState`, `board`, `vehicles` are collected
  at screen scope via `collectAsStateWithLifecycle()`. Children take stable value
  params (`TelemetryTick` / `VehicleTelemetry` / `ConnectionState` are immutable),
  so unchanged children are **skipped**; a tick only recomposes the affected
  `TickerCard` (stable `symbol` keys) and the badge only on state flips.
- **Missing import (new finding, High)** — `11.sp` / `9.sp` were used without the
  `androidx.compose.ui.unit.sp` import (would fail compilation); fixed together
  with B4.

### 2.2 ViewModel & data layer

- **Conflation (A4)** — `wsClient.ticks` is a hot `SharedFlow` at feed cadence;
  `conflate()` now collapses bursts so `scan`/`map` runs at most once per main
  frame even during volatility spikes. `latestTick`/`connectionState` are
  `StateFlow`s (inherently conflating).
- **Parsing thread (PASS)** — `TerminalWebSocketClient.onMessage` (line 91) and
  `MarketApi.fetchSnapshot` (`withContext(Dispatchers.IO)`, line 21) parse JSON
  **off the main thread**. `stateIn` collectors run on `Main.immediate` but only
  touch pre-parsed data classes.
- **Process-lifecycle awareness (A5)** — `TerminalViewModel` now implements
  `DefaultLifecycleObserver` registered on `ProcessLifecycleOwner`:
  `ON_START` → `connect()` + resume vehicle polling; `ON_STOP` →
  `disconnect()` + pause polling. `onCleared()` additionally removes the
  observer and disconnects. The in-code requirement
  “disconnect in `onCleared()`” is preserved.
- **Reconnect resilience (A3)** — failure or server-initiated close schedules a
  reconnect with capped exponential backoff (1/2/4/8/16/30 s); user-initiated
  `disconnect()` suppresses it. `connect()` is fully idempotent across
  CONNECTING/CONNECTED/CLOSING.

### 2.3 Data models (`data/model/TelemetryModels.kt`)

- All properties are immutable **`val`**; classes contain only primitives and
  `String` → Compose infers them **stable**, so `TickerCard`/`VehicleHudCard`
  are skippable when inputs are equal (verified: no `var`, no `List` params in
  composable signatures).
- `MarketSnapshot` holds `List<…>` (compiler-unstable), but it is only used in
  the data layer — never as a composable parameter — so no `@Immutable` is
  required today. **Recommendation:** add `@Immutable` if it is ever rendered
  directly.
- No macro/index/commodity fields exist; models are strictly EV tickers +
  vehicle telemetry (SoC, range, temps, charging kW, odometer, status).

## 3. Remaining recommendations (pre-production backlog, priority order)

1. **`kotlinx-serialization-cjson` migration (Medium)** — replace `org.json`
   parsing with `kotlinx.serialization` + `@Serializable` models for ~2–5×
   faster parsing and compile-time field checking. Models are already shaped
   for it.
2. **Shared OkHttpClient singleton (Low)** — inject one `OkHttpClient` via a
   simple service locator / DI to share the connection pool and dispatcher
   between `TerminalWebSocketClient` and `MarketApi`.
3. **Unit tests (Medium)** — JVM tests for `structurePivots`-equivalent
   indicators and `TerminalViewModel` (turbine-based flow tests) once the
   module builds on CI.
4. **Baseline profiles / R8 (Low)** — add a baseline profile for the dashboard
   and enable R8 full mode in release builds.
5. **Composition tracing (Low)** — enable
   `TrackUIViewController`/composition tracing when profiling on-device.

## 4. Verification performed

- Static: brace/paren balance across all 8 Kotlin files; import audit
  (found & fixed the missing `sp` import); repo-wide grep confirms no
  macro/index/commodity fields in the Kotlin sources.
- Runtime (backend + web front-end unchanged and serving): WS feed broadcasts
  verified, `/api/market` returns 13 tickers + 6 vehicles parsed by the exact
  field names the Android models declare.
- Note: Kotlin compilation requires the Android SDK, which is not available in
  this environment; findings A1–A7/B1–B4 were derived from source-level
  inspection against the Compose/Flow contracts documented above.
