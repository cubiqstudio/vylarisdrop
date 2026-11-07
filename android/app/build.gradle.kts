plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signierung über Umgebungsvariablen (VD_KEYSTORE, VD_KEYSTORE_PASS, VD_KEY_ALIAS); ohne sie: Debug-Signatur
val ksDatei: String? = System.getenv("VD_KEYSTORE")?.takeIf { it.isNotBlank() && File(it).isFile }
val ksPass: String? = System.getenv("VD_KEYSTORE_PASS")?.takeIf { it.isNotBlank() }
val ksAlias: String = System.getenv("VD_KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "vylariscloud"

android {
    namespace = "eu.vylaris.cloud"
    compileSdk = 35

    defaultConfig {
        applicationId = "eu.vylaris.cloud"
        minSdk = 26
        targetSdk = 35
        versionCode = 11000
        versionName = "1.1.0"
        // Nur diese Sprachen werden ausgeliefert
        resourceConfigurations += listOf("de", "en")
    }

    signingConfigs {
        if (ksDatei != null && ksPass != null) {
            create("release") {
                storeFile = File(ksDatei)
                storePassword = ksPass
                keyAlias = ksAlias
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        release {
            // R8 aus: die App ist klein (WebView-Hülle), es gibt keine Reflection-Bibliotheken außer
            // kotlinx.serialization (nur Json-Baum, ohne Plugin). Das spart Keep-Regel-Risiko; die APK bleibt unter ca. 3 MB.
            isMinifyEnabled = false
            isShrinkResources = false
            isDebuggable = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
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
        buildConfig = true
    }
    lint {
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = true
        // Der Ordner heißt wie üblich mipmap-anydpi-v26 (Vorgabe); bei minSdk 26 wäre mipmap-anydpi gleichwertig
        disable += "ObsoleteSdkInt"
        // Maschinell lesbarer Bericht neben dem HTML-Bericht
        textReport = false
        htmlReport = true
        xmlReport = true
    }
    testOptions {
        unitTests.all {
            it.systemProperty("vd.stub", rootProject.file("test-server/stub.mjs").absolutePath)
            it.environment("VD_TEST_SERVER", System.getenv("VD_TEST_SERVER") ?: "")
            it.environment("VD_TEST_USER", System.getenv("VD_TEST_USER") ?: "")
            it.environment("VD_TEST_PASS", System.getenv("VD_TEST_PASS") ?: "")
            it.environment("VD_TEST_API_TOKEN", System.getenv("VD_TEST_API_TOKEN") ?: "")
            it.environment("VD_TEST_RATELIMIT", System.getenv("VD_TEST_RATELIMIT") ?: "")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation("junit:junit:4.13.2")
}
