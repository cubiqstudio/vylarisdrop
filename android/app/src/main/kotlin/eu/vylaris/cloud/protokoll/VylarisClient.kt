package eu.vylaris.cloud.protokoll

import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Protokoll zwischen App und VylarisCloud-Server (Vertrag: Routen unter api/app, api/upload und api/public).
 * Blockierend, ohne Android-Framework: läuft in JVM-Tests gegen einen Stub oder den echten Server.
 */
class VylarisClient(
    val basis: String,
    private val http: HttpTransport = HttpTransport(),
    /** Ab dieser Größe wird in Stücken hochgeladen (Server: 8-MB-Stücke über /api/upload/start) */
    private val grossAb: Long = 50L * 1024 * 1024,
    /**
     * Wird aufgerufen, wenn für einen Stück-Upload eine neue Sitzung geöffnet wurde (Set-Cookie-Zeilen). Der Server
     * beendet dabei die übrigen Sitzungen des App-Geräts, also auch die der WebView: die App übernimmt das neue Cookie.
     */
    private val sitzungsAblage: ((List<String>) -> Unit)? = null
) {
    init {
        require(ServerAdresse.erlaubt(basis)) { "Adresse nicht erlaubt: $basis" }
    }

    private val ursprung = basis.trimEnd('/')

    /** Sitzungs-Cookie für die Stück-Routen; gilt für alle großen Dateien dieses Clients (jede neue Sitzung beendet die vorige) */
    @Volatile private var stueckCookie: String? = null

    // ---------------------------------------------------------------- Server prüfen

    /** Prüft /api/public/health und /api/public/theme. */
    fun verbinden(): ServerInfo {
        pruefeHealth()
        val a = http.senden("GET", "$ursprung/api/public/theme", lesenMs = 15_000)
        val j = jsonOderNull(a)
        if (a.status != 200 || j == null) throw ProtokollFehler(FehlerArt.KEIN_SERVER, a.status)
        val marke = j["marke"] as? JsonObject
        return ServerInfo(
            basis = ursprung,
            name = j.text("name")?.takeIf { it.isNotBlank() }?.take(60) ?: "VylarisCloud",
            farbe = j.text("color")?.takeIf { FARBE.matches(it) } ?: "#1e73be",
            markeIcon = marke?.text("icon").orEmpty(),
            markeLogo = marke?.text("logo").orEmpty(),
            eingerichtet = (j["setup"] as? JsonPrimitive)?.contentOrNull != "false"
        )
    }

    private fun pruefeHealth() {
        var url = "$ursprung/api/public/health"
        for (versuch in 0..1) {
            val a = http.senden("GET", url, lesenMs = 15_000)
            if (a.status in intArrayOf(301, 302, 307, 308)) {
                val ziel = a.erster("Location")?.let { aufloesen(url, it) }
                    ?: throw ProtokollFehler(FehlerArt.KEIN_SERVER, a.status)
                val neuerUrsprung = ursprungVon(ziel)
                if (neuerUrsprung != null && neuerUrsprung != ursprung) {
                    if (!ServerAdresse.erlaubt(neuerUrsprung)) throw ProtokollFehler(FehlerArt.KEIN_SERVER, a.status)
                    throw ProtokollFehler(FehlerArt.UMLEITUNG, a.status, ziel = neuerUrsprung)
                }
                url = ziel
                continue
            }
            val j = jsonOderNull(a)
            if (a.status != 200 || j == null || (j["ok"] as? JsonPrimitive)?.contentOrNull != "true")
                throw ProtokollFehler(FehlerArt.KEIN_SERVER, a.status)
            return
        }
        throw ProtokollFehler(FehlerArt.KEIN_SERVER)
    }

    // ---------------------------------------------------------------- Kopplung, Token, Sitzung

    /** POST /api/app/koppeln: tauscht einen Kopplungscode gegen ein App-Token. */
    fun koppeln(code: String, geraet: String): KoppelErgebnis {
        val c = Kopplung.codeNormalisieren(code) ?: throw ProtokollFehler(FehlerArt.UNGUELTIGER_CODE, 404)
        val a = http.senden("POST", "$ursprung/api/app/koppeln", jsonKopf(), jsonRumpf { put("code", c); put("geraet", geraet.take(80)) })
        return koppelAntwort(a)
    }

    /** POST /api/app/token: neues App-Token mit der Web-Sitzung (Cookie-Zeile aus der WebView). */
    fun tokenHolen(cookies: String, geraet: String): KoppelErgebnis {
        val kopf = jsonKopf() + mapOf("Cookie" to cookies, "Origin" to ursprung)
        val a = http.senden("POST", "$ursprung/api/app/token", kopf, jsonRumpf { put("geraet", geraet.take(80)) })
        return koppelAntwort(a)
    }

    /** POST /api/app/sitzung: Sitzungs-Cookie (Set-Cookie-Zeilen) für die WebView. */
    fun sitzung(token: String): SitzungErgebnis {
        val kopf = mapOf("Authorization" to "Bearer $token", "Origin" to ursprung, "Content-Type" to "application/json")
        val a = http.senden("POST", "$ursprung/api/app/sitzung", kopf, rumpfAusBytes("{}".toByteArray()))
        pruefen(a)
        val j = json(a)
        return SitzungErgebnis(nutzerAus(j["nutzer"] as? JsonObject), a.kopfEintraege("Set-Cookie"))
    }

    /** GET /api/app/ich */
    fun ich(token: String): IchErgebnis {
        val a = http.senden("GET", "$ursprung/api/app/ich", mapOf("Authorization" to "Bearer $token"))
        pruefen(a)
        val j = json(a)
        val g = j["geraet"] as? JsonObject
        return IchErgebnis(nutzerAus(j["nutzer"] as? JsonObject), g?.long("id") ?: 0, g?.text("name").orEmpty())
    }

    /** DELETE /api/app/geraete/<id> (Sitzung): dieses App-Gerät widerrufen, z. B. beim Abmelden. */
    fun geraetWiderrufen(cookies: String, id: Long) {
        val kopf = mapOf("Cookie" to cookies, "Origin" to ursprung)
        pruefen(http.senden("DELETE", "$ursprung/api/app/geraete/$id", kopf))
    }

    private fun koppelAntwort(a: Antwort): KoppelErgebnis {
        if (a.status == 404) throw ProtokollFehler(FehlerArt.UNGUELTIGER_CODE, 404, meldungVon(a))
        pruefen(a)
        val j = json(a)
        val token = j.text("token")
        if (token.isNullOrEmpty() || !Kopplung.tokenGueltig(token)) throw ProtokollFehler(FehlerArt.KEIN_SERVER, a.status, "Kein gültiges Token in der Antwort")
        val server = j["server"] as? JsonObject
        return KoppelErgebnis(token, nutzerAus(j["nutzer"] as? JsonObject), server?.text("name") ?: "VylarisCloud", server?.text("farbe") ?: "#1e73be")
    }

    // ---------------------------------------------------------------- Upload

    /**
     * Lädt eine Datei hoch. Bis `grossAb` als ein multipart-POST /api/upload (Bearer-Token); darüber über das
     * Stück-Verfahren /api/upload/start → PUT /<nr> → /fertig, das den Server-Sitzungs-Cookie braucht
     * (aus /api/app/sitzung).
     */
    fun hochladen(
        token: String,
        quelle: UploadQuelle,
        fortschritt: (gesendet: Long, gesamt: Long) -> Unit = { _, _ -> },
        abbruch: () -> Boolean = { false }
    ): UploadErgebnis {
        return if (quelle.groesse > grossAb) hochladenInStuecken(token, quelle, fortschritt, abbruch)
        else hochladenEinfach(token, quelle, fortschritt, abbruch)
    }

    private fun hochladenEinfach(
        token: String,
        quelle: UploadQuelle,
        fortschritt: (Long, Long) -> Unit,
        abbruch: () -> Boolean
    ): UploadErgebnis {
        val grenze = "----VylarisCloud" + UUID.randomUUID().toString().replace("-", "")
        val dateiname = quelle.name.replace("\"", "%22").replace('\r', ' ').replace('\n', ' ').take(200).ifBlank { "datei" }
        val mime = quelle.mime.takeIf { MIME.matches(it) } ?: "application/octet-stream"
        val kopfTeil = ("--$grenze\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$dateiname\"\r\n" +
            "Content-Type: $mime\r\n\r\n").toByteArray(Charsets.UTF_8)
        val fussTeil = "\r\n--$grenze--\r\n".toByteArray(Charsets.UTF_8)
        val laenge = if (quelle.groesse >= 0) kopfTeil.size + quelle.groesse + fussTeil.size else -1L
        val rumpf = Rumpf(laenge) { aus ->
            aus.write(kopfTeil)
            val eingabe = try {
                quelle.oeffnen()
            } catch (e: Exception) {
                throw QuellFehler(e)
            }
            eingabe.use { kopieren(it, aus, abbruch) }
            aus.write(fussTeil)
        }
        val kopf = mapOf(
            "Authorization" to "Bearer $token",
            "Content-Type" to "multipart/form-data; boundary=$grenze"
        )
        val gesamt = quelle.groesse
        val a = try {
            http.senden("POST", "$ursprung/api/upload", kopf, rumpf, lesenMs = 300_000) { gesendet ->
                fortschritt(minOf(gesendet, if (gesamt >= 0) gesamt else gesendet), gesamt)
            }
        } catch (e: QuellFehler) {
            throw e.ursache
        }
        pruefen(a)
        val j = json(a)
        val dateien = j["files"] as? JsonArray
        val erste = dateien?.firstOrNull() as? JsonObject
        val links = erste?.get("links") as? JsonObject
        val seite = j.text("url") ?: links?.text("seite")
        if (seite.isNullOrEmpty()) throw ProtokollFehler(FehlerArt.SERVER, a.status, "Antwort ohne Link")
        fortschritt(gesamt.coerceAtLeast(0), gesamt)
        return UploadErgebnis(
            name = erste?.text("name") ?: quelle.name,
            seite = seite,
            direkt = j.text("raw") ?: links?.text("direkt") ?: seite,
            download = j.text("download") ?: links?.text("download") ?: seite,
            groesse = erste?.long("size") ?: quelle.groesse
        )
    }

    private fun hochladenInStuecken(
        token: String,
        quelle: UploadQuelle,
        fortschritt: (Long, Long) -> Unit,
        abbruch: () -> Boolean
    ): UploadErgebnis {
        // Die Stück-Routen verlangen eine Sitzung (Cookie): per App-Token eine Sitzung öffnen (und für weitere Dateien behalten)
        val gesamt = quelle.groesse
        fun startAnfrage(cookie: String) = http.senden(
            "POST", "$ursprung/api/upload/start", mapOf("Cookie" to cookie, "Origin" to ursprung) + jsonKopf(),
            jsonRumpf { put("name", quelle.name.take(200)); put("size", gesamt); put("mime", quelle.mime.take(120)); put("optionen", buildJsonObject { }) }
        )
        var cookie = stueckSitzung(token, erneuern = false)
        var start = startAnfrage(cookie)
        if (start.status == 401) {
            // gemerkte Sitzung abgelaufen oder von anderer Stelle beendet: einmal neu öffnen
            cookie = stueckSitzung(token, erneuern = true)
            start = startAnfrage(cookie)
        }
        val basisKopf = mapOf("Cookie" to cookie, "Origin" to ursprung)
        pruefen(start)
        val sj = json(start)
        val id = sj.text("id")
        val teilGroesse = sj.long("teilGroesse") ?: 0
        val teile = sj.long("teile") ?: 0
        if (id.isNullOrEmpty() || !ID.matches(id) || teilGroesse <= 0 || teile <= 0)
            throw ProtokollFehler(FehlerArt.SERVER, start.status, "Ungültige Antwort von /api/upload/start")
        try {
            quelle.oeffnen().use { eingabe ->
                var gesendet = 0L
                for (nr in 0 until teile) {
                    if (abbruch()) throw ProtokollFehler(FehlerArt.ABGEBROCHEN)
                    val soll = minOf(teilGroesse, gesamt - nr * teilGroesse)
                    val puffer = ByteArray(soll.toInt())
                    lesenVoll(eingabe, puffer)
                    var versuch = 0
                    while (true) {
                        versuch++
                        try {
                            val basisGesendet = gesendet
                            val r = http.senden(
                                "PUT", "$ursprung/api/upload/$id/$nr",
                                basisKopf + mapOf("Content-Type" to "application/octet-stream"),
                                rumpfAusBytes(puffer), lesenMs = 120_000
                            ) { n -> fortschritt(basisGesendet + minOf(n, soll), gesamt) }
                            pruefen(r)
                            break
                        } catch (e: ProtokollFehler) {
                            val wiederholbar = e.art == FehlerArt.NETZ || (e.art == FehlerArt.SERVER && e.status >= 500)
                            if (!wiederholbar || versuch >= 3) throw e
                            Thread.sleep(800L * versuch)
                        }
                    }
                    gesendet += soll
                    fortschritt(gesendet, gesamt)
                }
            }
            val fertig = http.senden("POST", "$ursprung/api/upload/$id/fertig", basisKopf + jsonKopf(), jsonRumpf { }, lesenMs = 900_000)
            pruefen(fertig)
            val fj = json(fertig)
            val datei = fj["file"] as? JsonObject
            val links = datei?.get("links") as? JsonObject
            val seite = links?.text("seite")
            if (seite.isNullOrEmpty()) throw ProtokollFehler(FehlerArt.SERVER, fertig.status, "Antwort ohne Link")
            return UploadErgebnis(
                name = datei.text("name") ?: quelle.name,
                seite = seite,
                direkt = links.text("direkt") ?: seite,
                download = links.text("download") ?: seite,
                groesse = datei.long("size") ?: gesamt
            )
        } catch (e: Exception) {
            // angefangenen Upload aufräumen (best effort)
            try {
                http.senden("DELETE", "$ursprung/api/upload/$id", basisKopf, lesenMs = 10_000)
            } catch (_: Exception) {
            }
            throw e
        }
    }

    // ---------------------------------------------------------------- Hilfen

    private fun stueckSitzung(token: String, erneuern: Boolean): String {
        if (!erneuern) stueckCookie?.let { return it }
        val s = sitzung(token)
        val cookie = s.cookies.joinToString("; ") { it.substringBefore(';').trim() }
        if (cookie.isBlank()) throw ProtokollFehler(FehlerArt.NICHT_ANGEMELDET, 401, "Keine Sitzung erhalten")
        stueckCookie = cookie
        sitzungsAblage?.invoke(s.cookies)
        return cookie
    }

    private fun kopieren(ein: InputStream, aus: OutputStream, abbruch: () -> Boolean) {
        val b = ByteArray(64 * 1024)
        while (true) {
            if (abbruch()) throw ProtokollFehler(FehlerArt.ABGEBROCHEN)
            val n = try {
                ein.read(b)
            } catch (e: Exception) {
                throw QuellFehler(e)
            }
            if (n < 0) break
            aus.write(b, 0, n)
        }
    }

    private fun lesenVoll(ein: InputStream, ziel: ByteArray) {
        var pos = 0
        while (pos < ziel.size) {
            val n = ein.read(ziel, pos, ziel.size - pos)
            if (n < 0) throw ProtokollFehler(FehlerArt.NETZ, meldung = "Datei kürzer als gemeldet")
            pos += n
        }
    }

    private fun pruefen(a: Antwort) {
        if (a.status in 200..299) return
        val m = meldungVon(a)
        throw when (a.status) {
            401 -> ProtokollFehler(FehlerArt.NICHT_ANGEMELDET, 401, m)
            404 -> ProtokollFehler(FehlerArt.SERVER, 404, m)
            413 -> ProtokollFehler(FehlerArt.ZU_GROSS, 413, m)
            429 -> ProtokollFehler(FehlerArt.ZU_VIELE_VERSUCHE, 429, m)
            else -> ProtokollFehler(FehlerArt.SERVER, a.status, m)
        }
    }

    private fun meldungVon(a: Antwort): String? =
        jsonOderNull(a)?.let { it.text("message") ?: it.text("statusMessage") }?.take(300)

    private fun nutzerAus(j: JsonObject?) = AppNutzer(j?.long("id") ?: 0, j?.text("name") ?: "", j?.text("rolle") ?: "user")

    private fun json(a: Antwort): JsonObject =
        jsonOderNull(a) ?: throw ProtokollFehler(FehlerArt.KEIN_SERVER, a.status, "Antwort ist kein JSON")

    private fun jsonOderNull(a: Antwort): JsonObject? = try {
        Json.parseToJsonElement(a.text) as? JsonObject
    } catch (e: Exception) {
        null
    }

    private fun jsonKopf() = mapOf("Content-Type" to "application/json")

    private fun jsonRumpf(f: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): Rumpf =
        rumpfAusBytes(buildJsonObject(f).toString().toByteArray(Charsets.UTF_8))

    private fun aufloesen(basisUrl: String, ziel: String): String? = try {
        URI(basisUrl).resolve(ziel).toString()
    } catch (e: Exception) {
        null
    }

    private fun ursprungVon(url: String): String? = try {
        val u = URI(url)
        val standard = (u.scheme == "http" && u.port == 80) || (u.scheme == "https" && u.port == 443)
        if (u.host == null) null
        else u.scheme.lowercase() + "://" + u.host.lowercase() + (if (u.port != -1 && !standard) ":" + u.port else "")
    } catch (e: Exception) {
        null
    }

    private fun JsonObject.text(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.longOrNull

    private companion object {
        val FARBE = Regex("^#[0-9a-fA-F]{6}$")
        val MIME = Regex("^[A-Za-z0-9!#$&^_.+-]{1,60}/[A-Za-z0-9!#$&^_.+-]{1,100}$")
        val ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    }
}

/** Kopplungscode und Token: Formate laut Vertrag. */
object Kopplung {
    private const val ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

    /** "abcd efgh" / "ABCD-EFGH" → "ABCD-EFGH"; null bei ungültiger Form */
    fun codeNormalisieren(roh: String): String? {
        val s = roh.uppercase().filter { it.isLetterOrDigit() }
        if (s.length != 8 || !s.all { it in ALPHABET }) return null
        return s.substring(0, 4) + "-" + s.substring(4)
    }

    fun tokenGueltig(t: String) = Regex("^vd_app_[0-9a-f]{48}$").matches(t)
}
