package eu.vylaris.cloud

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import eu.vylaris.cloud.protokoll.FehlerArt
import eu.vylaris.cloud.protokoll.ProtokollFehler
import eu.vylaris.cloud.protokoll.ServerAdresse
import eu.vylaris.cloud.protokoll.VylarisClient
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Hauptfenster: der VylarisCloud-Server in einer WebView, mit nativer Anbindung (Dateiwahl, Downloads, Anmeldung per Token). */
class HauptActivity : AppCompatActivity() {
    private lateinit var einst: Einstellungen
    private lateinit var server: ServerEintrag
    private lateinit var serverUri: Uri
    private lateinit var wurzel: FrameLayout
    private lateinit var aktualisieren: SwipeRefreshLayout
    private lateinit var web: WebView
    private lateinit var balken: ProgressBar
    private lateinit var fehlerSeite: View
    private lateinit var fehlerText: TextView

    @Volatile private var seiteOben = true
    private var fehlerAktiv = false
    private var fehlerUrl: String? = null
    private var imHintergrundDestroyed = false

    // Token und Sitzung
    private var letzterTokenVersuch = 0L
    private var tokenLaeuft = false
    private var letzteWiederherstellung = 0L
    private var wiederherstellungen = ArrayDeque<Long>()
    private var wiederherstellungLaeuft = false

    // Dateiauswahl
    private var dateiCallback: ValueCallback<Array<Uri>>? = null
    private var kameraZiel: Uri? = null
    private var kameraDatei: File? = null
    private var nachKameraRecht: (() -> Unit)? = null

    // Kamera/Mikrofon für die Web-Aufnahme
    private var webAnfrage: PermissionRequest? = null

    private val dateiLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = dateiCallback ?: return@registerForActivityResult
        dateiCallback = null
        var uris: Array<Uri>? = null
        if (res.resultCode == RESULT_OK) {
            uris = WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data)
            val foto = kameraDatei
            if (uris == null && foto != null && foto.length() > 0) kameraZiel?.let { uris = arrayOf(it) }
        }
        cb.onReceiveValue(uris)
        val foto = kameraDatei
        if (foto != null && uris?.any { it == kameraZiel } != true) foto.delete()
        kameraZiel = null
        kameraDatei = null
    }

    private val kameraRecht = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        val weiter = nachKameraRecht
        nachKameraRecht = null
        weiter?.invoke()
    }

    private val webRechte = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { erteilt ->
        val anfrage = webAnfrage ?: return@registerForActivityResult
        webAnfrage = null
        val ok = mutableListOf<String>()
        for (r in anfrage.resources) {
            when (r) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> if (erteilt[Manifest.permission.CAMERA] == true || hat(Manifest.permission.CAMERA)) ok += r
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> if (erteilt[Manifest.permission.RECORD_AUDIO] == true || hat(Manifest.permission.RECORD_AUDIO)) ok += r
            }
        }
        if (ok.isEmpty()) anfrage.deny() else anfrage.grant(ok.toTypedArray())
    }

    private val benachrichtigungsRecht = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        einst = Einstellungen(this)
        val s = einst.server
        if (s == null || !ServerAdresse.erlaubt(s.url)) {
            startActivity(Intent(this, EinrichtungActivity::class.java))
            finish()
            return
        }
        server = s
        serverUri = s.url.toUri()
        setContentView(R.layout.activity_haupt)
        wurzel = findViewById(R.id.wurzel)
        aktualisieren = findViewById(R.id.aktualisieren)
        web = findViewById(R.id.web)
        balken = findViewById(R.id.fortschritt)
        fehlerSeite = findViewById(R.id.fehlerSeite)
        fehlerText = findViewById(R.id.fehlerText)
        findViewById<Button>(R.id.erneut).setOnClickListener { erneutVersuchen() }
        findViewById<Button>(R.id.einstellungen).setOnClickListener { startActivity(Intent(this, EinstellungenActivity::class.java)) }

        leistenEinrichten()
        webEinrichten()
        aktualisieren.setOnRefreshListener {
            if (fehlerAktiv) erneutVersuchen() else web.reload()
        }
        aktualisieren.setOnChildScrollUpCallback { _, _ -> !seiteOben || web.scrollY > 0 }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fehlerAktiv) {
                    moveTaskToBack(true)
                } else if (web.canGoBack()) {
                    web.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            // Verlauf wiederhergestellt
        } else {
            web.loadUrl(server.url + "/")
        }
        benachrichtigungenFragen()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (!::web.isInitialized) return
        // Wurde in den Einstellungen der Server gewechselt, neu starten
        val s = einst.server
        if (s == null || s.url != server.url) {
            startActivity(Intent(this, if (s == null) EinrichtungActivity::class.java else HauptActivity::class.java))
            finish()
            return
        }
        web.onResume()
    }

    override fun onPause() {
        if (::web.isInitialized) {
            web.onPause()
            CookieManager.getInstance().flush()
        }
        super.onPause()
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.stopLoading()
            web.destroy()
        }
        dateiCallback?.onReceiveValue(null)
        dateiCallback = null
        webAnfrage?.deny()
        super.onDestroy()
    }

    private fun hat(recht: String) = ContextCompat.checkSelfPermission(this, recht) == PackageManager.PERMISSION_GRANTED

    // ------------------------------------------------------------------ Leisten, Ränder

    private fun leistenEinrichten() {
        val start = einst.seitenFarbe.takeIf { it != 0 } ?: ContextCompat.getColor(this, R.color.hintergrund)
        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15 zeichnet Edge-to-Edge immer: Systemleisten, Aussparung und Tastatur als Rand lassen,
            // die Fläche dahinter bekommt die Seitenfarbe
            WindowCompat.setDecorFitsSystemWindows(window, false)
            ViewCompat.setOnApplyWindowInsetsListener(wurzel) { v, insets ->
                val i = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
                )
                v.setPadding(i.left, i.top, i.right, i.bottom)
                WindowInsetsCompat.CONSUMED
            }
        }
        leistenfarbe(start)
    }

    @Suppress("DEPRECATION")
    private fun leistenfarbe(farbe: Int) {
        wurzel.setBackgroundColor(farbe)
        if (Build.VERSION.SDK_INT < 35) {
            window.statusBarColor = farbe
            window.navigationBarColor = farbe
        }
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.isAppearanceLightStatusBars = Farben.hell(farbe)
        c.isAppearanceLightNavigationBars = Farben.hell(farbe)
    }

    // ------------------------------------------------------------------ WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun webEinrichten() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.setBackgroundColor(Color.TRANSPARENT)
        val ws = web.settings
        ws.javaScriptEnabled = true
        ws.domStorageEnabled = true
        ws.allowFileAccess = false
        ws.allowContentAccess = false
        ws.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        ws.setSupportMultipleWindows(true)
        ws.displayZoomControls = false
        ws.builtInZoomControls = false
        ws.userAgentString = ws.userAgentString + " VylarisCloudApp/" + BuildConfig.VERSION_NAME
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(web, false)
        web.addJavascriptInterface(Bruecke(), "VdApp")
        web.setDownloadListener { url, ua, cd, mime, _ -> herunterladen(url, ua, cd, mime) }
        web.webViewClient = Klient()
        web.webChromeClient = Chrome()
    }

    private fun istServerHost(u: Uri?): Boolean {
        val h = u?.host ?: return false
        return h.equals(serverUri.host, ignoreCase = true) && u.scheme.equals(serverUri.scheme, ignoreCase = true) && portGleich(u)
    }

    private fun portGleich(u: Uri): Boolean {
        fun port(x: Uri) = if (x.port != -1) x.port else if (x.scheme.equals("https", true)) 443 else 80
        return port(u) == port(serverUri)
    }

    private fun extern(u: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.kein_programm, Toast.LENGTH_SHORT).show()
        }
    }

    /** true = die App behandelt die Adresse selbst (WebView lädt sie nicht) */
    private fun navigation(u: Uri, weiterleitung: Boolean): Boolean {
        val schema = u.scheme?.lowercase()
        when (schema) {
            "http", "https" -> {
                val host = u.host
                if (host.isNullOrEmpty()) return true
                if (schema == "http" && !ServerAdresse.istLokal(host)) {
                    Toast.makeText(this, R.string.http_blockiert, Toast.LENGTH_LONG).show()
                    return true
                }
                if (istServerHost(u)) return false
                // Anmeldedienst (SSO) oder anderer Host nach Weiterleitung: in der WebView bleiben
                val aktuell = web.url?.toUri()
                if (!istServerHost(aktuell)) return false
                if (weiterleitung) return false
                extern(u)
                return true
            }
            "mailto" -> {
                try { startActivity(Intent(Intent.ACTION_SENDTO, u)) } catch (_: ActivityNotFoundException) { }
                return true
            }
            "tel" -> {
                try { startActivity(Intent(Intent.ACTION_DIAL, u)) } catch (_: ActivityNotFoundException) { }
                return true
            }
            "about", "blob", "data" -> return false
            else -> return true // intent:, file:, content:, javascript: und alles andere
        }
    }

    private inner class Klient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.isForMainFrame && navigation(request.url, request.isRedirect)

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val u = request.url
            // Klartext zu nicht-lokalen Hosts nie laden (Systemkonfiguration lässt http zu, die App nicht)
            if (u.scheme.equals("http", true) && !ServerAdresse.istLokal(u.host.orEmpty()))
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())
            // Abmeldung im Web: das App-Gerät vorher serverseitig widerrufen, damit die Sitzung nicht still zurückkehrt
            if (request.method == "POST" && istServerHost(u) && u.path == "/api/auth/logout") abmeldungVorbereiten(request)
            return null
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            balken.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            balken.visibility = View.GONE
            aktualisieren.isRefreshing = false
            CookieManager.getInstance().flush()
            if (fehlerAktiv) return
            if (istServerHost(url?.toUri())) {
                view.evaluateJavascript(SKRIPT, null)
                bewerte(url)
            }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            if (!fehlerAktiv && istServerHost(url?.toUri())) bewerte(url)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            fehlerZeigen(request.url.toString(), getString(R.string.fehler_netz))
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel() // nie "trotzdem fortfahren"
            fehlerZeigen(error.url, getString(R.string.fehler_zertifikat))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Darstellungsprozess abgestürzt oder vom System beendet: Fenster neu aufbauen statt Absturz
            if (!imHintergrundDestroyed) {
                imHintergrundDestroyed = true
                recreate()
            }
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            balken.progress = newProgress
            balken.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
            // Link mit target=_blank / window.open: gleiche Seite hier laden, andere Hosts im Browser
            val temp = WebView(this@HauptActivity)
            temp.webViewClient = object : WebViewClient() {
                private fun behandeln(u: Uri): Boolean {
                    val s = u.scheme?.lowercase()
                    if (s == "about" && u.toString() == "about:blank") return false
                    if (s == "http" || s == "https") {
                        if (istServerHost(u)) web.loadUrl(u.toString()) else navigation(u, false).let { if (!it) extern(u) }
                    } else navigation(u, false)
                    loswerden(temp)
                    return true
                }

                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest) = behandeln(r.url)
                override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    url?.toUri()?.let { behandeln(it) }
                }
            }
            val t = resultMsg.obj as WebView.WebViewTransport
            t.webView = temp
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) {
            // Fenster des Web schließen: im Verlauf zurück
            if (web.canGoBack()) web.goBack()
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (!istServerHost(request.origin)) {
                request.deny()
                return
            }
            val noetig = mutableListOf<String>()
            val webRes = mutableListOf<String>()
            for (r in request.resources) {
                when (r) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> { webRes += r; noetig += Manifest.permission.CAMERA }
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> { webRes += r; noetig += Manifest.permission.RECORD_AUDIO }
                }
            }
            if (webRes.isEmpty()) {
                request.deny()
                return
            }
            val fehlend = noetig.filter { !hat(it) }
            if (fehlend.isEmpty()) {
                request.grant(webRes.toTypedArray())
                return
            }
            webAnfrage?.deny()
            webAnfrage = request
            webRechte.launch(fehlend.toTypedArray())
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (request === webAnfrage) webAnfrage = null
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            dateiCallback?.onReceiveValue(null)
            dateiCallback = callback
            val typen = params.acceptTypes.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
            val ueberKamera = params.isCaptureEnabled && (typen.isEmpty() || typen.any { it.startsWith("image") || it.startsWith("video") })
            if (ueberKamera && !hat(Manifest.permission.CAMERA)) {
                // Kamera-Direktaufnahme: erst fragen, dann (egal wie die Antwort ausfällt) weitermachen
                nachKameraRecht = { dateiWahlStarten(params, typen, ueberKamera) }
                try { kameraRecht.launch(Manifest.permission.CAMERA) } catch (e: Exception) { dateiWahlStarten(params, typen, false) }
            } else {
                dateiWahlStarten(params, typen, ueberKamera)
            }
            return true
        }
    }

    private fun loswerden(v: WebView) {
        v.post {
            v.stopLoading()
            v.destroy()
        }
    }

    // ------------------------------------------------------------------ Dateiauswahl

    private fun dateiWahlStarten(params: WebChromeClient.FileChooserParams, typen: List<String>, direktKamera: Boolean) {
        val kamera = hat(Manifest.permission.CAMERA)
        val bildErlaubt = typen.isEmpty() || typen.any { it.startsWith("image") || it == "*/*" }
        val videoErlaubt = typen.isEmpty() || typen.any { it.startsWith("video") || it == "*/*" }
        val extras = mutableListOf<Intent>()
        if (kamera) {
            if (bildErlaubt) fotoIntent()?.let { extras += it }
            if (videoErlaubt) extras += Intent(MediaStore.ACTION_VIDEO_CAPTURE)
        }
        val absicht: Intent = try {
            if (direktKamera && kamera && extras.isNotEmpty()) {
                (if (typen.any { it.startsWith("video") } && !bildErlaubt) Intent(MediaStore.ACTION_VIDEO_CAPTURE) else extras.first())
            } else {
                val inhalt = params.createIntent()
                Intent(Intent.ACTION_CHOOSER).apply {
                    putExtra(Intent.EXTRA_INTENT, inhalt)
                    putExtra(Intent.EXTRA_TITLE, getString(R.string.datei_waehlen))
                    if (extras.isNotEmpty()) putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toTypedArray())
                }
            }
        } catch (e: Exception) {
            abbrechenDateiwahl()
            return
        }
        try {
            dateiLauncher.launch(absicht)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.kein_programm, Toast.LENGTH_SHORT).show()
            abbrechenDateiwahl()
        } catch (e: SecurityException) {
            abbrechenDateiwahl()
        }
    }

    private fun abbrechenDateiwahl() {
        dateiCallback?.onReceiveValue(null)
        dateiCallback = null
    }

    private fun fotoIntent(): Intent? {
        return try {
            val ordner = File(cacheDir, "kamera").apply { mkdirs() }
            ordner.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
            val datei = File.createTempFile("foto-", ".jpg", ordner)
            val uri = FileProvider.getUriForFile(this, "$packageName.dateien", datei)
            kameraDatei = datei
            kameraZiel = uri
            Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: IOException) {
            null
        }
    }

    // ------------------------------------------------------------------ Downloads

    private fun herunterladen(url: String, ua: String?, disposition: String?, mime: String?) {
        if (url.startsWith("blob:")) {
            blobHolen(url, URLUtil.guessFileName(url, disposition, mime))
            return
        }
        val u = url.toUri()
        val schema = u.scheme?.lowercase()
        if ((schema != "http" && schema != "https") || u.host.isNullOrEmpty()) return
        if (schema == "http" && !ServerAdresse.istLokal(u.host.orEmpty())) {
            Toast.makeText(this, R.string.http_blockiert, Toast.LENGTH_LONG).show()
            return
        }
        val name = URLUtil.guessFileName(url, disposition, mime)
        try {
            val r = DownloadManager.Request(u)
                .setTitle(name)
                .setDescription(server.name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            if (!mime.isNullOrBlank()) r.setMimeType(mime)
            CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() }?.let { r.addRequestHeader("Cookie", it) }
            if (!ua.isNullOrBlank()) r.addRequestHeader("User-Agent", ua)
            if (Build.VERSION.SDK_INT >= 29) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
            getSystemService(DownloadManager::class.java).enqueue(r)
            Toast.makeText(this, getString(R.string.download_gestartet, name), Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, R.string.download_fehler, Toast.LENGTH_LONG).show()
        }
    }

    /** blob:-Adressen kennt der DownloadManager nicht: Inhalt per Skript holen und über die Brücke speichern. */
    private fun blobHolen(url: String, name: String) {
        val js = "(function(u,n){fetch(u).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();" +
            "f.onloadend=function(){VdApp.blobSpeichern(f.result,n)};f.readAsDataURL(b)})})(" +
            org.json.JSONObject.quote(url) + "," + org.json.JSONObject.quote(name) + ")"
        web.evaluateJavascript(js, null)
    }

    private fun blobAblegen(dataUrl: String, name: String) {
        val komma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || komma < 0) return
        val mime = dataUrl.substring(5, komma).substringBefore(';').ifBlank { "application/octet-stream" }
        val bytes = try { Base64.decode(dataUrl.substring(komma + 1), Base64.DEFAULT) } catch (e: IllegalArgumentException) { return }
        val sauber = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").take(120).ifBlank { "datei" }
        lifecycleScope.launch(Dispatchers.IO) {
            val ok = try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, sauber)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                    uri != null && contentResolver.openOutputStream(uri)?.use { it.write(bytes); true } == true
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
                    File(dir, sauber).writeBytes(bytes)
                    true
                }
            } catch (e: Exception) {
                false
            }
            withContext(Dispatchers.Main) {
                Toast.makeText(this@HauptActivity, if (ok) getString(R.string.gespeichert_downloads, sauber) else getString(R.string.download_fehler), Toast.LENGTH_LONG).show()
            }
        }
    }

    // ------------------------------------------------------------------ Fehlerseite

    private fun fehlerZeigen(url: String?, text: String) {
        fehlerAktiv = true
        fehlerUrl = url
        fehlerText.text = text
        fehlerSeite.visibility = View.VISIBLE
        balken.visibility = View.GONE
        aktualisieren.isRefreshing = false
    }

    private fun erneutVersuchen() {
        fehlerAktiv = false
        fehlerSeite.visibility = View.GONE
        aktualisieren.isRefreshing = false
        val ziel = fehlerUrl?.takeIf { it.startsWith(server.url) } ?: (server.url + "/")
        fehlerUrl = null
        web.loadUrl(ziel)
    }

    // ------------------------------------------------------------------ Anmeldung per App-Token

    private fun geraeteName(): String {
        val hersteller = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        val modell = Build.MODEL.orEmpty()
        return (if (modell.startsWith(hersteller, ignoreCase = true)) modell else "$hersteller $modell").trim().ifBlank { "Android" }.take(80)
    }

    private fun client() = VylarisClient(server.url)

    private fun bewerte(url: String?) {
        val u = url?.toUri() ?: return
        val pfad = u.path ?: "/"
        if (pfad == "/login" || pfad.startsWith("/login/")) {
            letzterTokenVersuch = 0 // wer die Anmeldeseite sieht, meldet sich gleich an: dann sofort ein Token holen dürfen
            sitzungWiederherstellen()
            return
        }
        if (pfad.startsWith("/setup") || pfad.startsWith("/app/koppeln")) return
        if (!einst.hatToken()) tokenHolen()
    }

    /** Nach der Web-Anmeldung: mit den WebView-Cookies ein App-Token holen und sicher speichern. */
    private fun tokenHolen() {
        val jetzt = System.currentTimeMillis()
        if (tokenLaeuft || jetzt - letzterTokenVersuch < 10_000) return
        val cookies = CookieManager.getInstance().getCookie(server.url)
        if (cookies.isNullOrBlank()) return
        tokenLaeuft = true
        letzterTokenVersuch = jetzt
        val basis = server.url
        lifecycleScope.launch {
            try {
                val r = withContext(Dispatchers.IO) { VylarisClient(basis).tokenHolen(cookies, geraeteName()) }
                if (basis == einst.server?.url && einst.tokenSpeichern(r.token)) einst.nutzerName = r.nutzer.name
            } catch (e: ProtokollFehler) {
                // 401: noch nicht angemeldet (öffentliche Seite) - später erneut
            } catch (e: Exception) {
                // Netz o. ä.: ignorieren, nächste Seite versucht es wieder
            } finally {
                tokenLaeuft = false
            }
        }
    }

    /** Web-Sitzung abgelaufen (Weiterleitung auf /login), Token vorhanden: Sitzung per Token erneuern. */
    private fun sitzungWiederherstellen() {
        val token = einst.token() ?: return
        val jetzt = System.currentTimeMillis()
        if (wiederherstellungLaeuft || jetzt - letzteWiederherstellung < 10_000) return
        // Schleifenschutz: höchstens 3 Versuche in 2 Minuten
        while (wiederherstellungen.isNotEmpty() && jetzt - wiederherstellungen.first() > 120_000) wiederherstellungen.removeFirst()
        if (wiederherstellungen.size >= 3) return
        wiederherstellungen.addLast(jetzt)
        letzteWiederherstellung = jetzt
        wiederherstellungLaeuft = true
        val basis = server.url
        lifecycleScope.launch {
            try {
                val r = withContext(Dispatchers.IO) { VylarisClient(basis).sitzung(token) }
                if (r.cookies.isNotEmpty()) {
                    val cm = CookieManager.getInstance()
                    r.cookies.forEach { cm.setCookie(basis, it) }
                    cm.flush()
                    web.loadUrl("$basis/")
                }
            } catch (e: ProtokollFehler) {
                if (e.art == FehlerArt.NICHT_ANGEMELDET) einst.tokenLoeschen() // widerrufen: normale Anmeldeseite
            } catch (e: Exception) {
                // offline: Anmeldeseite bleibt
            } finally {
                wiederherstellungLaeuft = false
            }
        }
    }

    /** Läuft auf dem WebView-Netzwerk-Thread, bevor die Abmelde-Anfrage rausgeht. */
    private fun abmeldungVorbereiten(request: WebResourceRequest) {
        val token = einst.token() ?: return
        val basis = server.url
        val cookies = CookieManager.getInstance().getCookie(basis)
        try {
            if (!cookies.isNullOrBlank()) {
                val c = VylarisClient(basis)
                c.geraetWiderrufen(cookies, c.ich(token).geraetId)
            }
        } catch (e: Exception) {
            // nicht erreichbar: lokal trotzdem abmelden; im Panel unter "Verbundene Geräte" lässt sich das Gerät widerrufen
        } finally {
            einst.tokenLoeschen()
        }
    }

    private fun benachrichtigungenFragen() {
        if (Build.VERSION.SDK_INT < 33 || hat(Manifest.permission.POST_NOTIFICATIONS)) return
        val p = getSharedPreferences("vylaris", Context.MODE_PRIVATE)
        if (p.getBoolean("benachrichtigung_gefragt", false)) return
        p.edit().putBoolean("benachrichtigung_gefragt", true).apply()
        try { benachrichtigungsRecht.launch(Manifest.permission.POST_NOTIFICATIONS) } catch (_: Exception) { }
    }

    /** Brücke zum Seiten-Skript (nur für Seiten dieses Servers nützlich; jede Methode prüft ihre Eingaben). */
    private inner class Bruecke {
        @JavascriptInterface
        fun oben(wert: Boolean) {
            seiteOben = wert
        }

        @JavascriptInterface
        fun farbe(css: String?) {
            val f = Farben.auslesen(css?.take(80)) ?: return
            runOnUiThread {
                if (!istServerHost(web.url?.toUri())) return@runOnUiThread
                einst.seitenFarbe = f
                leistenfarbe(f)
            }
        }

        @JavascriptInterface
        fun blobSpeichern(dataUrl: String?, name: String?) {
            if (dataUrl == null || dataUrl.length > 64 * 1024 * 1024) return
            runOnUiThread {
                if (istServerHost(web.url?.toUri())) blobAblegen(dataUrl, name ?: "datei")
            }
        }
    }

    private companion object {
        /** Meldet Scroll-Stand (für Wisch-zum-Aktualisieren) und Seitenfarbe (für Leisten) an die App */
        const val SKRIPT = """
(function(){
 if(window.__vdApp) return; window.__vdApp=true;
 var offen=new Set(), letzt=true;
 function oben(){ offen.forEach(function(e){ if(!e.isConnected||e.scrollTop<=0) offen.delete(e) });
   return offen.size===0 && (window.scrollY||document.documentElement.scrollTop||0)<=0 }
 function melde(){ var o=oben(); if(o!==letzt){ letzt=o; VdApp.oben(o) } }
 document.addEventListener('scroll',function(ev){ var t=ev.target;
   if(t&&t!==document&&t!==document.documentElement&&t!==document.body){ if(t.scrollTop>0) offen.add(t); else offen.delete(t) }
   melde() },true);
 document.addEventListener('touchstart',melde,{capture:true,passive:true});
 function farbe(){ var b=document.body||document.documentElement; var c=getComputedStyle(b).backgroundColor;
   if(!c||c==='transparent'||/,\s*0\)$/.test(c)) c=getComputedStyle(document.documentElement).backgroundColor; VdApp.farbe(c) }
 var z; function spaeter(){ clearTimeout(z); z=setTimeout(farbe,250) }
 new MutationObserver(spaeter).observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});
 if(document.body) new MutationObserver(spaeter).observe(document.body,{attributes:true,attributeFilter:['class','style']});
 try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change',spaeter) }catch(e){}
 farbe(); melde();
})();
"""
    }
}
