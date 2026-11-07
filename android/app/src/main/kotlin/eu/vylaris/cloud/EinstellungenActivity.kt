package eu.vylaris.cloud

import android.content.Intent
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import eu.vylaris.cloud.protokoll.VylarisClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Kleine native Einstellungen: Verknüpfung, Geräte, Server wechseln. */
class EinstellungenActivity : AppCompatActivity() {
    private lateinit var einst: Einstellungen

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_einstellungen)
        Fenster.leisten(this, findViewById(R.id.wurzel))
        einst = Einstellungen(this)
        val server = einst.server
        if (server == null) {
            startActivity(Intent(this, EinrichtungActivity::class.java))
            finish()
            return
        }
        findViewById<TextView>(R.id.serverInfo).text = getString(R.string.einst_server, server.name, server.url)
        val nutzer = einst.nutzerName
        findViewById<TextView>(R.id.anmeldeInfo).text =
            if (einst.token() != null) getString(R.string.einst_gekoppelt, nutzer ?: "?") else getString(R.string.einst_nicht_gekoppelt)
        findViewById<TextView>(R.id.version).text = getString(R.string.einst_version, BuildConfig.VERSION_NAME)

        findViewById<Button>(R.id.verknuepfung).setOnClickListener { verknuepfen() }
        findViewById<Button>(R.id.geraete).setOnClickListener {
            try { startActivity(Intent(Intent.ACTION_VIEW, (server.url + "/geraete").toUri())) } catch (_: Exception) { }
        }
        findViewById<Button>(R.id.serverWechseln).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle(R.string.server_wechseln)
                .setMessage(R.string.server_wechseln_frage)
                .setPositiveButton(R.string.server_wechseln) { _, _ -> wechseln() }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }

    private fun verknuepfen() {
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) {
                try { Verknuepfung.hinzufuegen(applicationContext, einst) } catch (e: Exception) { Verknuepfung.Ergebnis.FEHLER }
            }
            Toast.makeText(
                this@EinstellungenActivity,
                when (r) {
                    Verknuepfung.Ergebnis.ANGEFRAGT -> R.string.verknuepfung_angefragt
                    Verknuepfung.Ergebnis.NICHT_UNTERSTUETZT -> R.string.verknuepfung_nicht_unterstuetzt
                    Verknuepfung.Ergebnis.FEHLER -> R.string.verknuepfung_fehler
                },
                Toast.LENGTH_LONG
            ).show()
        }
    }

    /** Abmelden und Server wechseln: App-Gerät serverseitig widerrufen (soweit erreichbar), alles Lokale löschen. */
    private fun wechseln() {
        val server = einst.server
        val token = einst.token()
        val cookies = server?.let { CookieManager.getInstance().getCookie(it.url) }
        lifecycleScope.launch {
            if (server != null && token != null && !cookies.isNullOrBlank()) {
                withContext(Dispatchers.IO) {
                    try {
                        val c = VylarisClient(server.url)
                        c.geraetWiderrufen(cookies, c.ich(token).geraetId)
                    } catch (_: Exception) {
                        // nicht erreichbar oder Sitzung abgelaufen: unter "Verbundene Geräte" im Panel widerrufbar
                    }
                }
            }
            einst.alleLoeschen()
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
            startActivity(Intent(this@EinstellungenActivity, EinrichtungActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
            finish()
        }
    }
}
