package eu.vylaris.cloud.protokoll

import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Random
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.BeforeClass
import org.junit.Test

/**
 * Protokoll-Tests gegen den Stub (android/test-server/stub.mjs, wird gestartet) oder - mit der
 * Umgebungsvariable VD_TEST_SERVER (z. B. http://127.0.0.1:3201) - gegen den echten Server. Für den echten Server
 * zusätzlich VD_TEST_USER / VD_TEST_PASS (Standard: admin / Cloud-Test-2026!).
 */
class ProtokollTest {
    companion object {
        private var prozess: Process? = null
        lateinit var basis: String
        val echt = !System.getenv("VD_TEST_SERVER").isNullOrBlank()
        private val benutzer = System.getenv("VD_TEST_USER")?.takeIf { it.isNotBlank() } ?: "admin"
        private val passwort = System.getenv("VD_TEST_PASS")?.takeIf { it.isNotBlank() } ?: "Cloud-Test-2026!"
        val roh = HttpTransport()

        @BeforeClass @JvmStatic fun start() {
            if (echt) {
                basis = ServerAdresse.normalisieren(System.getenv("VD_TEST_SERVER")!!).url!!
                return
            }
            val stub = System.getProperty("vd.stub") ?: error("vd.stub fehlt")
            val p = ProcessBuilder("node", stub, "0").redirectErrorStream(true).start()
            prozess = p
            val zeile = p.inputStream.bufferedReader().readLine() ?: error("Stub startet nicht")
            check(zeile.startsWith("LISTENING ")) { "Stub: $zeile" }
            basis = "http://127.0.0.1:" + zeile.removePrefix("LISTENING ").trim()
        }

        @AfterClass @JvmStatic fun ende() {
            prozess?.destroy()
        }

        /** Browser-Anmeldung: Cookie-Zeile "vd_session=…" */
        fun anmelden(): String {
            val a = roh.senden(
                "POST", "$basis/api/auth/login",
                mapOf("Content-Type" to "application/json", "Origin" to basis),
                rumpfAusBytes("""{"username":"$benutzer","password":"$passwort"}""".toByteArray())
            )
            assertEquals("Anmeldung: ${a.text}", 200, a.status)
            return a.kopfEintraege("Set-Cookie").joinToString("; ") { it.substringBefore(';') }.also { assertTrue(it.contains("vd_session=")) }
        }

        fun neuerCode(cookie: String): String {
            val a = roh.senden("POST", "$basis/api/app/koppelcode", mapOf("Content-Type" to "application/json", "Cookie" to cookie, "Origin" to basis), rumpfAusBytes("{}".toByteArray()))
            assertEquals("koppelcode: ${a.text}", 200, a.status)
            val code = Regex("\"code\":\"([A-Z0-9-]+)\"").find(a.text)!!.groupValues[1]
            assertTrue(a.text, a.text.contains("\"ablaufSek\":300"))
            return code
        }

        fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

        fun holen(url: String): ByteArray {
            // Rohdownload mit eigenem Aufruf (Antwort als Bytes, ohne die Text-Hülle des Transports)
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 10_000
            c.readTimeout = 60_000
            return c.inputStream.use { it.readBytes() }
        }
    }

    private fun client(grossAb: Long = 50L * 1024 * 1024) = VylarisClient(basis, grossAb = grossAb)

    private fun gekoppelt(): KoppelErgebnis {
        val cookie = anmelden()
        return client().koppeln(neuerCode(cookie), "JVM-Test")
    }

    private fun fehlerArt(block: () -> Unit): ProtokollFehler {
        try {
            block()
        } catch (e: ProtokollFehler) {
            return e
        }
        fail("ProtokollFehler erwartet")
        throw IllegalStateException()
    }

    private class Speicherquelle(override val name: String, override val mime: String, private val daten: ByteArray) : UploadQuelle {
        override val groesse = daten.size.toLong()
        override fun oeffnen() = ByteArrayInputStream(daten)
    }

    private fun zufall(n: Int, samen: Long = 7): ByteArray = ByteArray(n).also { Random(samen).nextBytes(it) }

    @Test fun serverPruefenLiefertNameUndFarbe() {
        val s = client().verbinden()
        assertEquals(basis, s.basis)
        assertTrue(s.name.isNotBlank())
        assertTrue(Regex("^#[0-9a-fA-F]{6}$").matches(s.farbe))
        assertTrue(s.eingerichtet)
    }

    @Test fun keinServerUnterAdresseGibtNetzfehler() {
        val e = fehlerArt { VylarisClient("http://127.0.0.1:1").verbinden() }
        assertEquals(FehlerArt.NETZ, e.art)
    }

    @Test fun kopplungLiefertToken() {
        val k = gekoppelt()
        assertTrue(k.token, Kopplung.tokenGueltig(k.token))
        assertEquals(benutzer, k.nutzer.name)
        assertTrue(k.nutzer.id > 0)
        assertTrue(k.nutzer.rolle.isNotBlank())
        assertTrue(k.serverName.isNotBlank())
    }

    @Test fun codeIstNurEinmalVerwendbar() {
        val cookie = anmelden()
        val code = neuerCode(cookie)
        client().koppeln(code, "erstes Gerät")
        assertEquals(FehlerArt.UNGUELTIGER_CODE, fehlerArt { client().koppeln(code, "zweites Gerät") }.art)
    }

    @Test fun codeMitKleinbuchstabenUndOhneStrichGeht() {
        val code = neuerCode(anmelden())
        val k = client().koppeln(code.lowercase().replace("-", " "), "Pixel Test")
        assertTrue(Kopplung.tokenGueltig(k.token))
    }

    @Test fun unbekannterCodeGibt404Fehler() {
        // gültige Form, aber nicht vergeben; Alphabet ohne 0/1/I/O/L
        val e = fehlerArt { client().koppeln("ZZZZ-ZZZZ", "x") }
        assertEquals(FehlerArt.UNGUELTIGER_CODE, e.art)
    }

    @Test fun codeMitFalscherFormWirdLokalAbgelehnt() {
        assertEquals(FehlerArt.UNGUELTIGER_CODE, fehlerArt { client().koppeln("kurz", "x") }.art)
        assertEquals(FehlerArt.UNGUELTIGER_CODE, fehlerArt { client().koppeln("0000-1111", "x") }.art)
    }

    @Test fun tokenIchUndSitzung() {
        val k = gekoppelt()
        val ich = client().ich(k.token)
        assertEquals(benutzer, ich.nutzer.name)
        assertTrue(ich.geraetId > 0)
        assertEquals("JVM-Test", ich.geraetName)
        val s = client().sitzung(k.token)
        assertEquals(benutzer, s.nutzer.name)
        assertTrue("Set-Cookie fehlt", s.cookies.any { it.startsWith("vd_session=") })
        // Das erhaltene Cookie ist wirklich eine Sitzung: damit lässt sich ein Code erzeugen
        val cookie = s.cookies.joinToString("; ") { it.substringBefore(';') }
        assertTrue(neuerCode(cookie).length == 9)
    }

    @Test fun ungueltigesTokenGibt401() {
        val falsch = "vd_app_" + "0".repeat(48)
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().ich(falsch) }.art)
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().sitzung(falsch) }.art)
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().sitzung("quatsch") }.art)
    }

    @Test fun tokenAusWebSitzung() {
        val cookie = anmelden()
        val k = client().tokenHolen(cookie, "WebView-Test")
        assertTrue(Kopplung.tokenGueltig(k.token))
        assertEquals("WebView-Test", client().ich(k.token).geraetName)
        // ohne Anmeldung: 401
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().tokenHolen("vd_session=" + "0".repeat(64), "x") }.art)
    }

    @Test fun widerrufMachtTokenUngueltig() {
        val cookie = anmelden()
        val k = client().tokenHolen(cookie, "Widerruf-Test")
        val id = client().ich(k.token).geraetId
        client().geraetWiderrufen(cookie, id)
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().ich(k.token) }.art)
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().sitzung(k.token) }.art)
        assertEquals(FehlerArt.NICHT_ANGEMELDET, fehlerArt { client().hochladen(k.token, Speicherquelle("a.txt", "text/plain", "x".toByteArray())) }.art)
    }

    @Test fun kleinerUploadKommtUnverfaelschtAn() {
        val k = gekoppelt()
        val daten = zufall(300_000, 11)
        val fortschritt = mutableListOf<Long>()
        val r = client().hochladen(k.token, Speicherquelle("Bär & Löwe \"1\".bin", "application/octet-stream", daten), { g, ges ->
            assertEquals(daten.size.toLong(), ges)
            fortschritt += g
        })
        assertTrue(r.seite, r.seite.startsWith(basis))
        assertTrue(r.direkt.startsWith(basis))
        assertTrue(r.name.isNotBlank())
        assertEquals(daten.size.toLong(), r.groesse)
        assertEquals(daten.size.toLong(), fortschritt.last())
        assertEquals(fortschritt, fortschritt.sorted())
        assertEquals(sha(daten), sha(holen(r.direkt)))
    }

    @Test fun grosserUploadInStueckenKommtUnverfaelschtAn() {
        val k = gekoppelt()
        // Schwelle künstlich niedrig, damit das Stück-Verfahren läuft; 9 MB + Rest = mehrere Stücke auch beim echten Server (8 MB)
        val daten = zufall(9 * 1024 * 1024 + 12_345, 3)
        val fortschritt = mutableListOf<Long>()
        val r = client(grossAb = 100_000).hochladen(k.token, Speicherquelle("gross.bin", "application/octet-stream", daten), { g, _ -> fortschritt += g })
        assertEquals(daten.size.toLong(), r.groesse)
        assertEquals(daten.size.toLong(), fortschritt.last())
        assertEquals(sha(daten), sha(holen(r.direkt)))
    }

    @Test fun uploadMitUngueltigemTokenGibt401() {
        val falsch = "vd_app_" + "1".repeat(48)
        val e = fehlerArt { client().hochladen(falsch, Speicherquelle("a.txt", "text/plain", "hallo".toByteArray())) }
        assertEquals(FehlerArt.NICHT_ANGEMELDET, e.art)
        val e2 = fehlerArt { client(grossAb = 1).hochladen(falsch, Speicherquelle("a.txt", "text/plain", "hallo".toByteArray())) }
        assertEquals(FehlerArt.NICHT_ANGEMELDET, e2.art)
    }

    @Test fun uploadLaesstSichAbbrechen() {
        val k = gekoppelt()
        val e = fehlerArt { client().hochladen(k.token, Speicherquelle("a.bin", "application/octet-stream", zufall(500_000)), abbruch = { true }) }
        assertEquals(FehlerArt.ABGEBROCHEN, e.art)
    }

    @Test fun zuVieleFalscheCodesGeben429() {
        assumeTrue("Rate-Limit nur gegen den Stub prüfen (sperrt sonst die IP des echten Servers)", !echt || System.getenv("VD_TEST_RATELIMIT") == "1")
        var gesperrt = false
        for (i in 0 until 30) {
            try {
                client().koppeln("XXXX-XXXX", "Rate-Test")
            } catch (e: ProtokollFehler) {
                if (e.art == FehlerArt.ZU_VIELE_VERSUCHE) {
                    assertEquals(429, e.status)
                    gesperrt = true
                    break
                }
                assertEquals(FehlerArt.UNGUELTIGER_CODE, e.art)
            }
        }
        assertTrue("429 wurde nicht erreicht", gesperrt)
    }

    @Test fun klartextZuFremdemHostWirdVerweigert() {
        try {
            VylarisClient("http://example.com")
            fail("IllegalArgumentException erwartet")
        } catch (_: IllegalArgumentException) {
        }
        assertEquals(FehlerArt.UNZULAESSIG, fehlerArt { roh.senden("GET", "http://example.com/") }.art)
    }

    @Test fun weiterleitungAufAndereAdresseWirdGemeldet() {
        val falsch = object : HttpTransport() {
            override fun senden(methode: String, url: String, kopf: Map<String, String>, rumpf: Rumpf?, lesenMs: Int, fortschritt: ((Long) -> Unit)?) =
                Antwort(301, mapOf("Location" to listOf("https://cloud.example.com/api/public/health")), "")
        }
        val e = fehlerArt { VylarisClient("http://192.168.1.10:3000", falsch).verbinden() }
        assertEquals(FehlerArt.UMLEITUNG, e.art)
        assertEquals("https://cloud.example.com", e.ziel)
    }

    @Test fun keinJsonIstKeinServer() {
        val html = object : HttpTransport() {
            override fun senden(methode: String, url: String, kopf: Map<String, String>, rumpf: Rumpf?, lesenMs: Int, fortschritt: ((Long) -> Unit)?) =
                Antwort(200, emptyMap(), "<html>Router-Login</html>")
        }
        assertEquals(FehlerArt.KEIN_SERVER, fehlerArt { VylarisClient("http://192.168.1.1", html).verbinden() }.art)
    }

    @Test fun hashUnterscheidetDateien() {
        assertNotEquals(sha(zufall(10, 1)), sha(zufall(10, 2)))
    }
}
