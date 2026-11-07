package eu.vylaris.cloud.protokoll

import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.AfterClass
import org.junit.BeforeClass
import org.junit.Test

/** Regressionstests zu den Befunden der Prüfung (Upload-Fehlerursachen, Weiterleitungen, Sitzung beim Stück-Upload). */
class BefundTest {
    companion object {
        @BeforeClass @JvmStatic fun start() = ProtokollTest.start()
        @AfterClass @JvmStatic fun ende() = ProtokollTest.ende()
    }

    private class Quelle(
        override val name: String,
        override val groesse: Long,
        private val offnen: () -> InputStream
    ) : UploadQuelle {
        override val mime = "application/octet-stream"
        override fun oeffnen() = offnen()
    }

    private fun gekoppeltesToken(): String {
        val cookie = ProtokollTest.anmelden()
        val code = ProtokollTest.neuerCode(cookie)
        return VylarisClient(ProtokollTest.basis).koppeln(code, "Befund-Test").token
    }

    @Test fun uploadMeldetFehlendeLeseRechteAlsSolche() {
        val token = "vd_app_" + "3".repeat(48)
        val q = Quelle("x.bin", 10) { throw SecurityException("Freigabe widerrufen") }
        try {
            VylarisClient(ProtokollTest.basis).hochladen(token, q)
            fail("Ausnahme erwartet")
        } catch (e: SecurityException) {
            // richtig: nicht als Netzfehler getarnt
        } catch (e: ProtokollFehler) {
            fail("Lesefehler als ${e.art} gemeldet")
        }
    }

    @Test fun uploadMeldetFehlendeDateiAlsSolche() {
        val q = Quelle("x.bin", 10) { throw FileNotFoundException("weg") }
        try {
            VylarisClient(ProtokollTest.basis).hochladen("vd_app_" + "3".repeat(48), q)
            fail("Ausnahme erwartet")
        } catch (e: FileNotFoundException) {
        } catch (e: ProtokollFehler) {
            fail("Lesefehler als ${e.art} gemeldet")
        }
    }

    @Test fun uploadMeldetLesefehlerMittenImStromAlsIoFehler() {
        val q = Quelle("x.bin", 100_000) {
            object : InputStream() {
                override fun read(): Int = throw IOException("Lesefehler")
                override fun read(b: ByteArray, off: Int, len: Int): Int = throw IOException("Lesefehler")
            }
        }
        try {
            VylarisClient(ProtokollTest.basis).hochladen("vd_app_" + "3".repeat(48), q)
            fail("Ausnahme erwartet")
        } catch (e: IOException) {
        } catch (e: ProtokollFehler) {
            fail("Lesefehler als ${e.art} gemeldet")
        }
    }

    @Test fun netzfehlerBleibtNetzfehler() {
        val q = Quelle("x.bin", 3) { ByteArrayInputStream(byteArrayOf(1, 2, 3)) }
        val e = try {
            VylarisClient("http://127.0.0.1:1").hochladen("vd_app_" + "3".repeat(48), q)
            null
        } catch (e: ProtokollFehler) {
            e
        }
        assertEquals(FehlerArt.NETZ, e?.art)
    }

    @Test fun weiterleitungNurAufGleichenHostUndHttps() {
        assertTrue(ServerAdresse.umleitungErlaubt("http://nas.local:3000", "https://nas.local"))
        assertTrue(ServerAdresse.umleitungErlaubt("http://NAS.local", "https://nas.LOCAL:8443"))
        assertTrue(ServerAdresse.umleitungErlaubt("https://cloud.example.com", "https://cloud.example.com"))
        assertFalse(ServerAdresse.umleitungErlaubt("http://nas.local", "https://angreifer.example"))
        assertFalse(ServerAdresse.umleitungErlaubt("https://cloud.example.com", "https://www.cloud.example.com"))
        assertFalse(ServerAdresse.umleitungErlaubt("https://cloud.example.com", "http://cloud.example.com"))
        assertFalse(ServerAdresse.umleitungErlaubt("http://nas.local", "http://nas.local:81"))
        assertFalse(ServerAdresse.umleitungErlaubt("http://nas.local", "https://nas.local.evil.example"))
        assertFalse(ServerAdresse.umleitungErlaubt("http://nas.local", "not a url"))
    }

    /** Der Stück-Upload braucht eine Sitzung; der Server beendet dafür die übrigen Sitzungen des Geräts (WebView). */
    @Test fun stueckUploadReichtNeueSitzungAnDieWebViewWeiter() {
        assumeTrue("nur gegen den echten Server sinnvoll", ProtokollTest.echt)
        val basis = ProtokollTest.basis
        val roh = ProtokollTest.roh
        val token = gekoppeltesToken()
        val c = VylarisClient(basis)
        // Sitzung der WebView
        val webCookie = c.sitzung(token).cookies.joinToString("; ") { it.substringBefore(';') }
        fun geraeteStatus(cookie: String) = roh.senden("GET", "$basis/api/app/geraete", mapOf("Cookie" to cookie)).status
        assertEquals(200, geraeteStatus(webCookie))
        val weitergereicht = ArrayList<List<String>>()
        val daten = ByteArray(300_000).also { Random(3).nextBytes(it) }
        val q = Quelle("klein-in-stuecken.bin", daten.size.toLong()) { ByteArrayInputStream(daten) }
        VylarisClient(basis, grossAb = 100_000, sitzungsAblage = { weitergereicht += it }).hochladen(token, q)
        // Die alte Sitzung ist weg (Serververhalten) ...
        assertEquals(401, geraeteStatus(webCookie))
        // ... aber die WebView bekommt die neue und bleibt angemeldet
        assertEquals(1, weitergereicht.size)
        val neu = weitergereicht[0].joinToString("; ") { it.substringBefore(';') }
        assertEquals(200, geraeteStatus(neu))
    }

    /** Mehrere große Dateien eines Auftrags teilen sich eine Sitzung (jede neue würde die vorige beenden). */
    @Test fun mehrereStueckUploadsNutzenEineSitzung() {
        assumeTrue("nur gegen den echten Server sinnvoll", ProtokollTest.echt)
        val token = gekoppeltesToken()
        val weitergereicht = ArrayList<List<String>>()
        val client = VylarisClient(ProtokollTest.basis, grossAb = 100_000, sitzungsAblage = { weitergereicht += it })
        repeat(3) { n ->
            val daten = ByteArray(150_000 + n).also { Random(n.toLong()).nextBytes(it) }
            client.hochladen(token, Quelle("mehr$n.bin", daten.size.toLong()) { ByteArrayInputStream(daten) })
        }
        assertEquals(1, weitergereicht.size)
    }
}
