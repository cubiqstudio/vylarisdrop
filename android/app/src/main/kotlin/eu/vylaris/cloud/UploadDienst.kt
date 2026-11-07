package eu.vylaris.cloud

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.OpenableColumns
import android.webkit.CookieManager
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.net.toUri
import eu.vylaris.cloud.protokoll.FehlerArt
import eu.vylaris.cloud.protokoll.ProtokollFehler
import eu.vylaris.cloud.protokoll.UploadErgebnis
import eu.vylaris.cloud.protokoll.UploadQuelle
import eu.vylaris.cloud.protokoll.VylarisClient
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Lädt per "Teilen" übergebene Dateien hoch. Läuft als Vordergrunddienst (Typ dataSync), damit der Upload auch bei
 * ausgeschaltetem Bildschirm weiterläuft. Die Freigaben (URI-Lese-Rechte) hängen am Intent und gelten, solange der Dienst läuft.
 */
class UploadDienst : Service() {
    private val ausfuehrer = Executors.newSingleThreadExecutor()
    private val offen = AtomicInteger(0)

    @Volatile private var abbrechen = false

    @Volatile private var letzteStartId = 0

    private lateinit var einst: Einstellungen

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        einst = Einstellungen(this)
        Benachrichtigungen.kanaeleAnlegen(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        letzteStartId = startId
        if (intent?.action == AKTION_ABBRECHEN) {
            abbrechen = true
            if (offen.get() <= 0) stopSelf(startId) // veraltete Benachrichtigung: nichts läuft mehr
            return START_NOT_STICKY
        }
        // Sofort in den Vordergrund (innerhalb weniger Sekunden Pflicht)
        vordergrund(fortschrittsBenachrichtigung(getString(R.string.upload_vorbereiten), 0, true))
        if (intent == null) {
            beenden()
            return START_NOT_STICKY
        }
        val uris = ArrayList<Uri>()
        intent.clipData?.let { c -> for (n in 0 until c.itemCount) c.getItemAt(n).uri?.let { if (it.scheme == "content") uris += it } }
        val text = intent.getCharSequenceExtra(EXTRA_TEXT)?.toString()
        if (uris.isEmpty() && text == null) {
            beenden()
            return START_NOT_STICKY
        }
        abbrechen = false
        offen.incrementAndGet()
        ausfuehrer.execute {
            try {
                arbeiten(uris, text)
            } catch (e: Throwable) {
                fehlerMelden(getString(R.string.upload_fehler_unbekannt))
            } finally {
                if (offen.decrementAndGet() <= 0) beenden()
            }
        }
        return START_NOT_STICKY
    }

    /** Android 15: Zeitlimit des dataSync-Dienstes erreicht -> sauber beenden */
    override fun onTimeout(startId: Int, fgsType: Int) {
        abbrechen = true
        beenden()
    }

    override fun onDestroy() {
        ausfuehrer.shutdownNow()
        super.onDestroy()
    }

    private fun beenden() {
        if (offen.get() > 0 && !abbrechen) return // inzwischen kam neue Arbeit dazu
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf(letzteStartId)
    }

    private fun vordergrund(n: Notification) {
        try {
            val typ = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
            ServiceCompat.startForeground(this, ID_FORTSCHRITT, n, typ)
        } catch (e: Exception) {
            // Start im Hintergrund nicht erlaubt o. ä.: ohne Vordergrund weiterarbeiten
        }
    }

    // ---------------------------------------------------------------- Arbeit

    private fun arbeiten(uris: List<Uri>, text: String?) {
        val s = einst.server
        val token = einst.token()
        if (s == null || token == null) {
            nichtAngemeldet()
            return
        }
        val quellen = ArrayList<UploadQuelle>()
        text?.let { quellen += TextQuelle(it) }
        uris.forEach { quellen += UriQuelle(applicationContext, it) }
        val client = VylarisClient(s.url, sitzungsAblage = { cookies -> webSitzungErsetzen(s.url, cookies) })
        val erfolge = ArrayList<UploadErgebnis>()
        var letzterFehler: String? = null
        for ((index, q) in quellen.withIndex()) {
            if (abbrechen) break
            // Name/Größe kommen aus dem ContentResolver (blockierend), daher hier im Hintergrund-Thread
            val dateiName = try {
                q.name
            } catch (e: Exception) {
                letzterFehler = getString(R.string.upload_fehler_lesen, "?")
                continue
            }
            try {
                val titel = if (quellen.size > 1) getString(R.string.upload_titel_n, index + 1, quellen.size) else getString(R.string.upload_titel)
                var zuletzt = 0L
                vordergrund(fortschrittsBenachrichtigung("$titel $dateiName", 0, true))
                val e = client.hochladen(token, q, { gesendet, gesamt ->
                    val jetzt = System.currentTimeMillis()
                    if (jetzt - zuletzt > 500) {
                        zuletzt = jetzt
                        val pct = if (gesamt > 0) ((gesendet * 100) / gesamt).toInt().coerceIn(0, 100) else 0
                        benachrichtigen(ID_FORTSCHRITT, fortschrittsBenachrichtigung("$titel $dateiName", pct, gesamt <= 0))
                    }
                }, { abbrechen })
                erfolge += e
            } catch (e: ProtokollFehler) {
                when (e.art) {
                    FehlerArt.ABGEBROCHEN -> break
                    FehlerArt.NICHT_ANGEMELDET -> {
                        einst.tokenLoeschen()
                        // schon hochgeladene Dateien dieses Auftrags: Links nicht verlieren
                        if (erfolge.isNotEmpty()) ergebnisMelden(erfolge)
                        nichtAngemeldet()
                        return
                    }
                    FehlerArt.NETZ -> letzterFehler = getString(R.string.upload_fehler_netz, dateiName)
                    FehlerArt.ZU_GROSS -> letzterFehler = getString(R.string.upload_fehler_gross, dateiName, e.message.orEmpty())
                    else -> letzterFehler = getString(R.string.upload_fehler_server, dateiName, e.message ?: e.status.toString())
                }
            } catch (e: SecurityException) {
                letzterFehler = getString(R.string.upload_fehler_lesen, dateiName)
            } catch (e: FileNotFoundException) {
                letzterFehler = getString(R.string.upload_fehler_lesen, dateiName)
            } catch (e: java.io.IOException) {
                letzterFehler = getString(R.string.upload_fehler_lesen, dateiName)
            }
        }
        NotificationManagerCompat.from(this).cancel(ID_FORTSCHRITT)
        if (erfolge.isNotEmpty()) ergebnisMelden(erfolge)
        if (letzterFehler != null) fehlerMelden(letzterFehler)
        if (abbrechen && erfolge.isEmpty() && letzterFehler == null) toast(R.string.upload_abgebrochen)
    }

    /**
     * Für große Dateien öffnet der Client eine neue Sitzung; der Server beendet dabei die übrigen Sitzungen dieses Geräts,
     * auch die der WebView. Damit sie nicht auf /login fällt und die Seite neu lädt, bekommt sie das neue Cookie.
     */
    private fun webSitzungErsetzen(basis: String, cookies: List<String>) {
        android.os.Handler(mainLooper).post {
            try {
                val cm = CookieManager.getInstance()
                cookies.forEach { cm.setCookie(basis, it) }
                cm.flush()
            } catch (_: Exception) {
                // WebView nicht verfügbar: sie meldet sich bei Bedarf selbst neu an
            }
        }
    }

    // ---------------------------------------------------------------- Benachrichtigungen

    private fun fortschrittsBenachrichtigung(text: String, prozent: Int, unbestimmt: Boolean): Notification {
        val abbruch = PendingIntent.getService(
            this, 1, Intent(this, UploadDienst::class.java).setAction(AKTION_ABBRECHEN),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, Benachrichtigungen.KANAL_FORTSCHRITT)
            .setSmallIcon(R.drawable.ic_stat_cloud)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setProgress(100, prozent, unbestimmt)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, getString(R.string.upload_abbrechen), abbruch)
            .build()
    }

    @SuppressLint("MissingPermission")
    private fun benachrichtigen(id: Int, n: Notification) {
        try {
            NotificationManagerCompat.from(this).notify(id, n)
        } catch (_: SecurityException) {
        }
    }

    private fun ergebnisMelden(erfolge: List<UploadErgebnis>) {
        val erste = erfolge.first()
        val links = erfolge.joinToString("\n") { it.seite }
        val titel = if (erfolge.size == 1) getString(R.string.hochgeladen) else resources.getQuantityString(R.plurals.hochgeladen_n, erfolge.size, erfolge.size)
        val text = if (erfolge.size == 1) erste.name else resources.getQuantityString(R.plurals.hochgeladen_n_text, erfolge.size - 1, erste.name, erfolge.size - 1)
        val code = (System.currentTimeMillis() and 0x7fffffff).toInt()
        val oeffnen = PendingIntent.getActivity(
            this, code, Intent(Intent.ACTION_VIEW, erste.seite.toUri()).addCategory(Intent.CATEGORY_BROWSABLE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val kopieren = PendingIntent.getBroadcast(
            this, code + 1,
            Intent(LinkReceiver.AKTION_KOPIEREN).setComponent(ComponentName(this, LinkReceiver::class.java)).putExtra(LinkReceiver.EXTRA_LINK, links),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(this, Benachrichtigungen.KANAL_ERGEBNIS)
            .setSmallIcon(R.drawable.ic_stat_cloud)
            .setContentTitle(titel)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text + "\n" + erste.seite))
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .addAction(0, getString(R.string.link_kopieren), kopieren)
            .addAction(0, getString(R.string.oeffnen), oeffnen)
            .build()
        benachrichtigen(code, n)
        // Ohne Benachrichtigungs-Recht wenigstens ein Hinweis auf dem Bildschirm
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) toast(R.string.hochgeladen)
    }

    private fun fehlerMelden(text: String) {
        val n = NotificationCompat.Builder(this, Benachrichtigungen.KANAL_ERGEBNIS)
            .setSmallIcon(R.drawable.ic_stat_cloud)
            .setContentTitle(getString(R.string.upload_fehlgeschlagen))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .build()
        benachrichtigen((System.currentTimeMillis() and 0x7fffffff).toInt(), n)
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) toastText(text)
    }

    private fun nichtAngemeldet() {
        val oeffnen = PendingIntent.getActivity(
            this, 2, Intent(this, HauptActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(this, Benachrichtigungen.KANAL_ERGEBNIS)
            .setSmallIcon(R.drawable.ic_stat_cloud)
            .setContentTitle(getString(R.string.upload_fehlgeschlagen))
            .setContentText(getString(R.string.teilen_anmelden_text))
            .setStyle(NotificationCompat.BigTextStyle().bigText(getString(R.string.teilen_anmelden_text)))
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(this).cancel(ID_FORTSCHRITT)
        benachrichtigen(ID_ANMELDEN, n)
    }

    private fun toast(res: Int) = toastText(getString(res))

    private fun toastText(t: String) {
        android.os.Handler(mainLooper).post { Toast.makeText(applicationContext, t, Toast.LENGTH_LONG).show() }
    }

    // ---------------------------------------------------------------- Quellen

    private class TextQuelle(private val text: String) : UploadQuelle {
        private val bytes = text.toByteArray(Charsets.UTF_8)
        override val name: String = "Text-" + SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date()) + ".txt"
        override val mime = "text/plain"
        override val groesse = bytes.size.toLong()
        override fun oeffnen(): InputStream = ByteArrayInputStream(bytes)
    }

    private class UriQuelle(private val c: Context, private val uri: Uri) : UploadQuelle {
        private var _name: String? = null
        private var _groesse: Long = -2

        private fun abfragen() {
            if (_name != null) return
            var n: String? = null
            var g = -1L
            try {
                c.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { k ->
                    if (k.moveToFirst()) {
                        val ni = k.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val si = k.getColumnIndex(OpenableColumns.SIZE)
                        if (ni >= 0 && !k.isNull(ni)) n = k.getString(ni)
                        if (si >= 0 && !k.isNull(si)) g = k.getLong(si)
                    }
                }
            } catch (e: SecurityException) {
                throw e
            } catch (e: Exception) {
                // unbekannte Spalten o. ä.: Vorgaben nutzen
            }
            _name = (n ?: uri.lastPathSegment ?: "datei").substringAfterLast('/').ifBlank { "datei" }
            _groesse = g
        }

        override val name: String get() { abfragen(); return _name!! }
        override val mime: String get() = c.contentResolver.getType(uri) ?: "application/octet-stream"
        override val groesse: Long get() { abfragen(); return _groesse }
        override fun oeffnen(): InputStream = c.contentResolver.openInputStream(uri) ?: throw FileNotFoundException(uri.toString())
    }

    companion object {
        const val EXTRA_TEXT = "text"
        const val AKTION_ABBRECHEN = "eu.vylaris.cloud.UPLOAD_ABBRECHEN"
        private const val ID_FORTSCHRITT = 4001
        private const val ID_ANMELDEN = 4002
    }
}
