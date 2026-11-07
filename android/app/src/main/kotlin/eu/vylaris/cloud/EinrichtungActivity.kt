package eu.vylaris.cloud

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import eu.vylaris.cloud.protokoll.AdressFehler
import eu.vylaris.cloud.protokoll.FehlerArt
import eu.vylaris.cloud.protokoll.Kopplung
import eu.vylaris.cloud.protokoll.ProtokollFehler
import eu.vylaris.cloud.protokoll.ServerAdresse
import eu.vylaris.cloud.protokoll.ServerInfo
import eu.vylaris.cloud.protokoll.VylarisClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Einrichtung: Server-Adresse (und optional Kopplungscode) eingeben, Server prüfen, speichern. */
class EinrichtungActivity : AppCompatActivity() {
    private lateinit var einst: Einstellungen
    private lateinit var adresse: EditText
    private lateinit var code: EditText
    private lateinit var meldung: TextView
    private lateinit var verbinden: Button
    private lateinit var dreht: ProgressBar
    private var laeuft = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_einrichtung)
        Fenster.leisten(this, findViewById(R.id.wurzel))
        einst = Einstellungen(this)
        adresse = findViewById(R.id.adresse)
        code = findViewById(R.id.code)
        meldung = findViewById(R.id.meldung)
        verbinden = findViewById(R.id.verbinden)
        dreht = findViewById(R.id.dreht)
        if (savedInstanceState == null) einst.server?.let { adresse.setText(it.url) }
        verbinden.setOnClickListener { start() }
        code.setOnEditorActionListener { _, aktion, _ ->
            if (aktion == EditorInfo.IME_ACTION_DONE) { start(); true } else false
        }
        if (savedInstanceState == null) tiefenLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tiefenLink(intent)
    }

    /**
     * vylariscloud://koppeln?s=<Server-URL, kodiert>&c=<Code>: Felder füllen und nach ausdrücklicher Bestätigung
     * koppeln. Den Link kann jede Webseite öffnen: ohne Rückfrage (mit Adresse) würde die App sich mit einem fremden
     * Server oder dem Konto eines Fremden koppeln.
     */
    private fun tiefenLink(i: Intent?) {
        val d: Uri = i?.data ?: return
        if (d.scheme != "vylariscloud" || d.host != "koppeln") return
        val s = d.getQueryParameter("s").orEmpty()
        val c = d.getQueryParameter("c").orEmpty()
        if (laeuft) return
        if (s.isBlank()) {
            // ohne Server-Angabe nur den Code übernehmen, nie von selbst koppeln
            if (c.isNotBlank()) code.setText(c)
            return
        }
        val bisher = adresse.text.toString()
        adresse.setText(s)
        if (c.isNotBlank()) code.setText(c)
        val ziel = ServerAdresse.normalisieren(s).url
        if (ziel == null) {
            start() // zeigt den Adressfehler
            return
        }
        val vorhanden = einst.server
        val verwerfen = {
            code.setText("")
            adresse.setText(bisher)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.deeplink_titel)
            .setMessage(
                if (vorhanden != null && vorhanden.url != ziel) getString(R.string.deeplink_wechseln, vorhanden.url, ziel)
                else getString(R.string.deeplink_koppeln, ziel)
            )
            .setPositiveButton(R.string.verbinden) { _, _ -> start() }
            .setNegativeButton(android.R.string.cancel) { _, _ -> verwerfen() }
            .setOnCancelListener { verwerfen() }
            .show()
    }

    private fun fehler(text: String) {
        meldung.text = text
        meldung.isVisible = true
    }

    private fun beschaeftigt(an: Boolean) {
        laeuft = an
        verbinden.isEnabled = !an
        adresse.isEnabled = !an
        code.isEnabled = !an
        dreht.visibility = if (an) View.VISIBLE else View.GONE
    }

    private fun start() {
        if (laeuft) return
        meldung.isVisible = false
        val p = ServerAdresse.normalisieren(adresse.text.toString())
        if (p.url == null) {
            fehler(
                getString(
                    when (p.fehler) {
                        AdressFehler.LEER -> R.string.adresse_leer
                        AdressFehler.SCHEMA -> R.string.adresse_schema
                        AdressFehler.ZUGANGSDATEN -> R.string.adresse_zugangsdaten
                        AdressFehler.HTTP_NICHT_LOKAL -> R.string.adresse_http_warnung
                        else -> R.string.adresse_ungueltig
                    }
                )
            )
            if (p.fehler == AdressFehler.HTTP_NICHT_LOKAL) adresse.setText(adresse.text.toString().trim().replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "https://"))
            return
        }
        val codeText = code.text.toString().trim()
        if (codeText.isNotEmpty() && Kopplung.codeNormalisieren(codeText) == null) {
            fehler(getString(R.string.code_ungueltig))
            return
        }
        beschaeftigt(true)
        val kandidaten = p.kandidaten
        lifecycleScope.launch {
            try {
                val info = withContext(Dispatchers.IO) { erreichen(kandidaten) }
                val eintrag = ServerEintrag(info.basis, info.name, info.farbe, info.markeIcon.ifBlank { info.markeLogo })
                if (codeText.isNotEmpty()) {
                    // Der Code ist nach dem Einlösen verbraucht: Token und Server müssen dann gespeichert werden, auch wenn
                    // das Fenster inzwischen geschlossen wurde (sonst bliebe nur ein verwaistes Gerät auf dem Server)
                    val gespeichert = withContext(Dispatchers.IO + NonCancellable) {
                        val k = VylarisClient(info.basis).koppeln(codeText, Fenster.geraeteName())
                        einst.server = eintrag
                        val ok = einst.tokenSpeichern(k.token)
                        if (ok) einst.nutzerName = k.nutzer.name
                        ok
                    }
                    // Server ist gespeichert: ohne Token geht es mit der Web-Anmeldung weiter, der Hinweis bleibt als Toast stehen
                    if (!gespeichert) Toast.makeText(applicationContext, R.string.token_speichern_fehler, Toast.LENGTH_LONG).show()
                } else {
                    einst.server = eintrag
                }
                startActivity(Intent(this@EinrichtungActivity, HauptActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                finish()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ProtokollFehler) {
                beschaeftigt(false)
                fehler(text(e))
            } catch (e: Exception) {
                beschaeftigt(false)
                fehler(getString(R.string.fehler_netz_detail, e.message ?: ""))
            }
        }
    }

    /**
     * Probiert die Adressen nacheinander; folgt einer Weiterleitung nur auf denselben Host per https (http -> https).
     * Eine Weiterleitung auf einen anderen Host wird nie verfolgt: dorthin gingen sonst Kopplungscode und Token.
     */
    private fun erreichen(kandidaten: List<String>): ServerInfo {
        var letzter: ProtokollFehler? = null
        val offen = ArrayDeque(kandidaten)
        val versucht = HashSet<String>()
        while (offen.isNotEmpty()) {
            val url = offen.removeFirst()
            if (!versucht.add(url)) continue
            try {
                return VylarisClient(url).verbinden()
            } catch (e: ProtokollFehler) {
                letzter = e
                if (e.art == FehlerArt.UMLEITUNG && e.ziel != null && ServerAdresse.umleitungErlaubt(url, e.ziel)) offen.addFirst(e.ziel)
            }
        }
        throw letzter ?: ProtokollFehler(FehlerArt.NETZ)
    }

    private fun text(e: ProtokollFehler): String = when (e.art) {
        FehlerArt.NETZ -> getString(R.string.fehler_netz_detail, e.message.orEmpty())
        FehlerArt.UMLEITUNG -> getString(R.string.fehler_umleitung, e.ziel.orEmpty())
        FehlerArt.KEIN_SERVER -> getString(R.string.fehler_kein_server)
        FehlerArt.UNGUELTIGER_CODE -> getString(R.string.fehler_code)
        FehlerArt.ZU_VIELE_VERSUCHE -> getString(R.string.fehler_zu_viele)
        FehlerArt.UNZULAESSIG -> getString(R.string.adresse_http_warnung)
        else -> getString(R.string.fehler_server, e.message ?: e.status.toString())
    }
}
