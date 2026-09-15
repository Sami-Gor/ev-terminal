import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* ---------------------------------------------------------------------------
 * Endpoint configuration (Stage 3)
 *
 * Debug: defaults target the emulator host (10.0.2.2). Override with
 *   EVT_DEBUG_API_BASE_URL / EVT_DEBUG_WS_URL / EVT_DEBUG_API_ORIGIN.
 *
 * Release: EVT_API_BASE_URL (https) and EVT_WS_URL (wss) are REQUIRED and must
 * be supplied through Gradle properties or environment variables, e.g.
 *   ./gradlew :app:assembleRelease \
 *       -PEVT_API_BASE_URL=https://api.example.com \
 *       -PEVT_WS_URL=wss://api.example.com
 * Missing or non-secure values fail the build before compilation. Endpoint
 * values are deployment configuration — do not commit environment-specific
 * values, and never place secrets here.
 * ------------------------------------------------------------------------- */

val debugApiBaseUrl = (
    (project.findProperty("EVT_DEBUG_API_BASE_URL") as String?)
        ?: System.getenv("EVT_DEBUG_API_BASE_URL")
        ?: "http://10.0.2.2:3000"
    ).trim()

val debugWsUrl = (
    (project.findProperty("EVT_DEBUG_WS_URL") as String?)
        ?: System.getenv("EVT_DEBUG_WS_URL")
        ?: "ws://10.0.2.2:3000"
    ).trim()

val debugApiOrigin = (
    (project.findProperty("EVT_DEBUG_API_ORIGIN") as String?)
        ?: System.getenv("EVT_DEBUG_API_ORIGIN")
        ?: "http://localhost:3000"
    ).trim()

val releaseApiBaseUrl = (
    (project.findProperty("EVT_API_BASE_URL") as String?)
        ?: System.getenv("EVT_API_BASE_URL")
        ?: ""
    ).trim()

val releaseWsUrl = (
    (project.findProperty("EVT_WS_URL") as String?)
        ?: System.getenv("EVT_WS_URL")
        ?: ""
    ).trim()

fun deriveOrigin(url: String): String = try {
    val uri = URI(url)
    val port = if (uri.port != -1) ":" + uri.port else ""
    uri.scheme + "://" + uri.host + port
} catch (e: Exception) {
    ""
}

val releaseApiOrigin = (
    (project.findProperty("EVT_API_ORIGIN") as String?)
        ?: System.getenv("EVT_API_ORIGIN")
        ?: ""
    ).trim().ifEmpty { deriveOrigin(releaseApiBaseUrl) }

android {
    namespace = "com.evterminal.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.evterminal.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        debug {
            buildConfigField("String", "WS_BASE_URL", "\"$debugWsUrl\"")
            buildConfigField("String", "REST_BASE_URL", "\"$debugApiBaseUrl\"")
            buildConfigField("String", "API_ORIGIN", "\"$debugApiOrigin\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "WS_BASE_URL", "\"$releaseWsUrl\"")
            buildConfigField("String", "REST_BASE_URL", "\"$releaseApiBaseUrl\"")
            buildConfigField("String", "API_ORIGIN", "\"$releaseApiOrigin\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

/* Release endpoint validation — evaluated once the task graph is known, so
 * debug-only builds never require release configuration, while any release
 * task fails clearly before compilation when HTTPS/WSS endpoints are missing
 * or insecure (no placeholder fallback). */
gradle.taskGraph.whenReady {
    if (!allTasks.any { it.name.contains("Release") }) return@whenReady
    val problems = mutableListOf<String>()
    if (releaseApiBaseUrl.isEmpty()) {
        problems += "EVT_API_BASE_URL is required (https URL) for release builds"
    } else if (!releaseApiBaseUrl.startsWith("https://")) {
        problems += "EVT_API_BASE_URL must use https:// for release builds"
    }
    if (releaseWsUrl.isEmpty()) {
        problems += "EVT_WS_URL is required (wss URL) for release builds"
    } else if (!releaseWsUrl.startsWith("wss://")) {
        problems += "EVT_WS_URL must use wss:// for release builds"
    }
    if (!releaseApiOrigin.startsWith("https://")) {
        problems += "EVT_API_ORIGIN must be an https:// origin for release builds (derived from EVT_API_BASE_URL or set explicitly)"
    }
    if (problems.isNotEmpty()) {
        throw GradleException(
            "Release endpoint configuration invalid:\n  - " + problems.joinToString("\n  - ") +
                "\nSupply values with -PEVT_API_BASE_URL=... -PEVT_WS_URL=... or the matching environment variables."
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.4")
    implementation("androidx.lifecycle:lifecycle-process:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Jetpack Compose
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // WebSocket feed
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
