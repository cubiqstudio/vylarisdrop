package eu.vylaris.cloud

import android.app.Activity
import android.os.Build
import android.view.View
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/** Gemeinsame Fensterhilfen für die nativen Seiten (Einrichtung, Einstellungen): Ränder und Leistenfarben. */
object Fenster {
    @Suppress("DEPRECATION")
    fun leisten(a: Activity, wurzel: View) {
        val farbe = ContextCompat.getColor(a, R.color.hintergrund)
        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15: Edge-to-Edge ist Pflicht, also Systemleisten, Aussparung und Tastatur als Rand lassen
            WindowCompat.setDecorFitsSystemWindows(a.window, false)
            ViewCompat.setOnApplyWindowInsetsListener(wurzel) { v, insets ->
                val i = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
                )
                v.setPadding(i.left, i.top, i.right, i.bottom)
                WindowInsetsCompat.CONSUMED
            }
        } else {
            a.window.statusBarColor = farbe
            a.window.navigationBarColor = farbe
        }
        val c = WindowCompat.getInsetsController(a.window, a.window.decorView)
        c.isAppearanceLightStatusBars = Farben.hell(farbe)
        c.isAppearanceLightNavigationBars = Farben.hell(farbe)
    }

    fun geraeteName(): String {
        val hersteller = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        val modell = Build.MODEL.orEmpty()
        return (if (modell.startsWith(hersteller, ignoreCase = true)) modell else "$hersteller $modell").trim().ifBlank { "Android" }.take(80)
    }
}
