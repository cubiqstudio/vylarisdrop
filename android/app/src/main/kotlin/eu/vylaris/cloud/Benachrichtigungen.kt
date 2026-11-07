package eu.vylaris.cloud

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

object Benachrichtigungen {
    const val KANAL_FORTSCHRITT = "upload_fortschritt"
    const val KANAL_ERGEBNIS = "upload_ergebnis"

    fun kanaeleAnlegen(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(KANAL_FORTSCHRITT, c.getString(R.string.kanal_fortschritt), NotificationManager.IMPORTANCE_LOW)
                .apply { setShowBadge(false) }
        )
        nm.createNotificationChannel(
            NotificationChannel(KANAL_ERGEBNIS, c.getString(R.string.kanal_ergebnis), NotificationManager.IMPORTANCE_DEFAULT)
        )
    }
}
