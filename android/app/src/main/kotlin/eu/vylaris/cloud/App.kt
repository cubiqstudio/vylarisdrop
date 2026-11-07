package eu.vylaris.cloud

import android.app.Application
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Benachrichtigungen.kanaeleAnlegen(this)
        try {
            // Langer Druck auf das App-Symbol: Einstellungen
            val absicht = Intent(this, EinstellungenActivity::class.java).setAction(Intent.ACTION_VIEW)
            val k = ShortcutInfoCompat.Builder(this, "einstellungen")
                .setShortLabel(getString(R.string.kurzbefehl_einstellungen))
                .setIcon(IconCompat.createWithResource(this, R.drawable.ic_stat_cloud))
                .setIntent(absicht)
                .build()
            ShortcutManagerCompat.setDynamicShortcuts(this, listOf(k))
        } catch (_: Exception) {
            // Kurzbefehle sind nur eine Bequemlichkeit
        }
    }
}
