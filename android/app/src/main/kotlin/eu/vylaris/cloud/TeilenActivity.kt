package eu.vylaris.cloud

import android.Manifest
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * Ziel für "Teilen mit ...": durchsichtige Aktivität, die nur prüft (angemeldet? Berechtigung?) und den
 * Upload-Dienst startet. Die Freigabe (Lese-Recht auf die Dateien) wird an den Dienst weitergereicht.
 */
class TeilenActivity : AppCompatActivity() {
    private lateinit var einst: Einstellungen
    private var uris: List<Uri> = emptyList()
    private var text: String? = null

    private val benachrichtigung = registerForActivityResult(ActivityResultContracts.RequestPermission()) { weiter() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        einst = Einstellungen(this)
        if (savedInstanceState != null) {
            // Prozess wurde beendet und neu aufgebaut: die Freigaben sind weg, nichts zu tun
            finish()
            return
        }
        val a = intent
        if (a == null || (a.action != Intent.ACTION_SEND && a.action != Intent.ACTION_SEND_MULTIPLE)) {
            finish()
            return
        }
        uris = freigegebeneUris(a)
        text = a.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() && uris.isEmpty() }?.take(1_000_000)
        if (uris.isEmpty() && text == null) {
            Toast.makeText(this, R.string.teilen_nichts, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        if (einst.server == null || einst.token() == null) {
            AlertDialog.Builder(this)
                .setTitle(R.string.teilen_anmelden_titel)
                .setMessage(R.string.teilen_anmelden_text)
                .setPositiveButton(R.string.app_oeffnen) { _, _ ->
                    startActivity(Intent(this, HauptActivity::class.java))
                    finish()
                }
                .setNegativeButton(android.R.string.cancel) { _, _ -> finish() }
                .setOnCancelListener { finish() }
                .show()
            return
        }
        val p = getSharedPreferences("vylaris", Context.MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !p.getBoolean("benachrichtigung_gefragt", false)
        ) {
            p.edit().putBoolean("benachrichtigung_gefragt", true).apply()
            try {
                benachrichtigung.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            } catch (_: Exception) {
            }
        }
        weiter()
    }

    private fun weiter() {
        if (uris.isEmpty() && text == null) {
            finish()
            return
        }
        val i = Intent(this, UploadDienst::class.java)
        if (uris.isNotEmpty()) {
            val clip = ClipData.newRawUri("dateien", uris.first())
            uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
            i.clipData = clip
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        text?.let { i.putExtra(UploadDienst.EXTRA_TEXT, it) }
        try {
            ContextCompat.startForegroundService(this, i)
            Toast.makeText(this, R.string.teilen_gestartet, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, R.string.teilen_fehler, Toast.LENGTH_LONG).show()
        }
        finish()
    }

    /** Nur content://-Adressen (per Intent freigegeben). file:// wird nie gelesen. */
    private fun freigegebeneUris(a: Intent): List<Uri> {
        val liste = LinkedHashSet<Uri>()
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= 33) {
            a.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)?.let { liste += it }
            a.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)?.let { liste += it }
        } else {
            (a.getParcelableExtra<android.os.Parcelable>(Intent.EXTRA_STREAM) as? Uri)?.let { liste += it }
            a.getParcelableArrayListExtra<android.os.Parcelable>(Intent.EXTRA_STREAM)?.forEach { (it as? Uri)?.let { u -> liste += u } }
        }
        a.clipData?.let { c -> for (n in 0 until c.itemCount) c.getItemAt(n).uri?.let { liste += it } }
        return liste.filter { it.scheme == "content" }.take(100)
    }
}
