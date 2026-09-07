package com.evterminal.app.data.model

import org.json.JSONObject

/** A single stock price tick broadcast over the WebSocket feed. */
data class TelemetryTick(
    val symbol: String,
    val price: Double,
    val change: Double,
    val percentChange: Double,
    val volume: Double
) {
    companion object {
        fun fromJson(obj: JSONObject): TelemetryTick = TelemetryTick(
            symbol = obj.getString("symbol"),
            price = obj.getDouble("price"),
            change = obj.getDouble("change"),
            percentChange = obj.getDouble("percentChange"),
            volume = obj.getDouble("volume")
        )
    }
}

/** EV vehicle telemetry from the market cache (SoC, range, temps, charging, odometer). */
data class VehicleTelemetry(
    val vehicleId: String,
    val model: String,
    val socPct: Double,
    val rangeKm: Int,
    val batteryTempC: Double,
    val motorTempC: Double,
    val chargingKw: Double,
    val odometerKm: Int,
    val status: String
) {
    companion object {
        fun fromJson(obj: JSONObject): VehicleTelemetry = VehicleTelemetry(
            vehicleId = obj.getString("vehicleId"),
            model = obj.optString("model", "—"),
            socPct = obj.optDouble("socPct", 0.0),
            rangeKm = obj.optInt("rangeKm", 0),
            batteryTempC = obj.optDouble("batteryTempC", 0.0),
            motorTempC = obj.optDouble("motorTempC", 0.0),
            chargingKw = obj.optDouble("chargingKw", 0.0),
            odometerKm = obj.optInt("odometerKm", 0),
            status = obj.optString("status", "idle")
        )
    }
}

/** Full in-memory cache snapshot served by GET /api/market. */
data class MarketSnapshot(
    val updatedAt: String,
    val tickers: List<TelemetryTick>,
    val vehicles: List<VehicleTelemetry>
) {
    companion object {
        fun fromJson(obj: JSONObject): MarketSnapshot {
            val tickers = obj.optJSONArray("tickers")?.let { arr ->
                (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let { TelemetryTick.fromJson(it) }
                }
            } ?: emptyList()
            val vehicles = obj.optJSONArray("vehicles")?.let { arr ->
                (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let { VehicleTelemetry.fromJson(it) }
                }
            } ?: emptyList()
            return MarketSnapshot(
                updatedAt = obj.optString("updatedAt", ""),
                tickers = tickers,
                vehicles = vehicles
            )
        }
    }
}
