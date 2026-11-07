package eu.vylaris.cloud

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import eu.vylaris.cloud.protokoll.ServerAdresse
import eu.vylaris.cloud.protokoll.VylarisClient
import java.net.HttpURLConnection
import java.net.URL

/** Verknüpfung auf dem Startbildschirm mit dem Marken-Icon des Servers (Eigenmarke), sonst mit dem App-Icon. */
object Verknuepfung {
    enum class Ergebnis { ANGEFRAGT, NICHT_UNTERSTUETZT, FEHLER }

    /** Blockierend (Netzwerk): auf einem Hintergrund-Thread aufrufen; der Aufruf von requestPinShortcut ist thread-sicher. */
    fun hinzufuegen(c: Context, einst: Einstellungen): Ergebnis {
        val server = einst.server ?: return Ergebnis.FEHLER
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(c)) return Ergebnis.NICHT_UNTERSTUETZT
        // Aktuelle Marke vom Server holen (der Inhaber kann sie nach der Einrichtung geändert haben)
        var name = server.name
        var markePfad = server.markeIcon
        try {
            val info = VylarisClient(server.url).verbinden()
            name = info.name
            markePfad = info.markeIcon.ifBlank { info.markeLogo }
            einst.server = ServerEintrag(server.url, info.name, info.farbe, markePfad)
        } catch (e: Exception) {
            // offline: gespeicherte Angaben verwenden
        }
        val bild = if (markePfad.isNotBlank()) markenBild(server.url, markePfad) else null
        val icon = if (bild != null) IconCompat.createWithBitmap(bild) else IconCompat.createWithResource(c, R.mipmap.ic_launcher)
        val start = Intent(c, HauptActivity::class.java).setAction(Intent.ACTION_MAIN)
        val info = ShortcutInfoCompat.Builder(c, "start-" + Integer.toHexString(server.url.hashCode()))
            .setShortLabel(name.take(24).ifBlank { c.getString(R.string.app_name) })
            .setLongLabel(name.take(60).ifBlank { c.getString(R.string.app_name) })
            .setIcon(icon)
            .setIntent(start)
            .build()
        return if (ShortcutManagerCompat.requestPinShortcut(c, info, null)) Ergebnis.ANGEFRAGT else Ergebnis.FEHLER
    }

    /** Lädt das Marken-Bild (PNG/JPEG/WebP); SVG kann Android nicht als Bitmap lesen -> null (Fallback App-Icon). */
    private fun markenBild(basis: String, pfad: String): Bitmap? {
        val url = if (pfad.startsWith("/")) basis + pfad else pfad
        if (!url.startsWith("$basis/") || !ServerAdresse.erlaubt(url)) return null
        return try {
            val k = URL(url).openConnection() as HttpURLConnection
            try {
                k.connectTimeout = 8_000
                k.readTimeout = 10_000
                k.instanceFollowRedirects = false
                if (k.responseCode != 200) return null
                val typ = k.contentType.orEmpty().lowercase()
                if (!typ.startsWith("image/") || typ.contains("svg")) return null
                val bytes = k.inputStream.use { s ->
                    val puffer = java.io.ByteArrayOutputStream()
                    val b = ByteArray(8192)
                    while (true) {
                        val n = s.read(b)
                        if (n < 0) break
                        if (puffer.size() + n > 2_000_000) return null
                        puffer.write(b, 0, n)
                    }
                    puffer.toByteArray()
                }
                val roh = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
                val kante = 192
                if (roh.width > kante || roh.height > kante) {
                    val f = kante.toFloat() / maxOf(roh.width, roh.height)
                    Bitmap.createScaledBitmap(roh, maxOf(1, (roh.width * f).toInt()), maxOf(1, (roh.height * f).toInt()), true)
                } else roh
            } finally {
                k.disconnect()
            }
        } catch (e: Exception) {
            null
        }
    }
}
