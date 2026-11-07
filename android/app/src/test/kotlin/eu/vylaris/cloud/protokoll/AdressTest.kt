package eu.vylaris.cloud.protokoll

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AdressTest {
    private fun url(s: String) = ServerAdresse.normalisieren(s).url
    private fun fehler(s: String) = ServerAdresse.normalisieren(s).fehler

    @Test fun httpsBleibtUndWirdBereinigt() {
        assertEquals("https://cloud.example.com", url("https://cloud.example.com/"))
        assertEquals("https://cloud.example.com", url("  HTTPS://Cloud.Example.COM/pfad?x=1#y "))
        assertEquals("https://cloud.example.com:8443", url("https://cloud.example.com:8443/"))
        assertEquals("https://cloud.example.com", url("https://cloud.example.com:443"))
    }

    @Test fun ohneSchemaWirdHttpsAngenommen() {
        val p = ServerAdresse.normalisieren("cloud.example.com")
        assertEquals("https://cloud.example.com", p.url)
        assertEquals(listOf("https://cloud.example.com"), p.kandidaten)
    }

    @Test fun lokaleAdresseOhneSchemaProbiertHttpsUndHttp() {
        val p = ServerAdresse.normalisieren("192.168.1.20:3000")
        assertEquals("https://192.168.1.20:3000", p.url)
        assertEquals(listOf("https://192.168.1.20:3000", "http://192.168.1.20:3000"), p.kandidaten)
    }

    @Test fun httpNurLokal() {
        assertEquals("http://192.168.1.5:3000", url("http://192.168.1.5:3000"))
        assertEquals("http://localhost:3000", url("http://localhost:3000/"))
        assertEquals("http://127.0.0.1:3201", url("http://127.0.0.1:3201"))
        assertEquals("http://nas.local", url("http://nas.local"))
        assertEquals("http://10.0.0.7", url("http://10.0.0.7:80"))
        assertEquals("http://[::1]:3000", url("http://[::1]:3000"))
        assertEquals(AdressFehler.HTTP_NICHT_LOKAL, fehler("http://cloud.example.com"))
        assertEquals(AdressFehler.HTTP_NICHT_LOKAL, fehler("http://8.8.8.8"))
        assertEquals(AdressFehler.HTTP_NICHT_LOKAL, fehler("http://172.32.0.1"))
        assertEquals(AdressFehler.HTTP_NICHT_LOKAL, fehler("http://192.169.0.1"))
        assertNull(url("http://example.com"))
    }

    @Test fun ungueltigeEingaben() {
        assertEquals(AdressFehler.LEER, fehler("   "))
        assertEquals(AdressFehler.SCHEMA, fehler("ftp://example.com"))
        assertEquals(AdressFehler.SCHEMA, fehler("javascript://alert(1)"))
        assertEquals(AdressFehler.ZUGANGSDATEN, fehler("https://user:pw@example.com"))
        assertEquals(AdressFehler.UNGUELTIG, fehler("https://exa mple.com".replace(" ", "<")))
        assertEquals(AdressFehler.UNGUELTIG, fehler("https://example.com:99999"))
        assertEquals(AdressFehler.UNGUELTIG, fehler("https://"))
    }

    @Test fun lokalErkennung() {
        for (h in listOf("localhost", "127.0.0.1", "127.5.5.5", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1",
            "100.64.1.1", "nas", "mein-server.local", "box.lan", "fritz.home.arpa", "::1", "fd12:3456::1", "fe80::1", "[::1]", "::ffff:192.168.1.1")) assertTrue(h, ServerAdresse.istLokal(h))
        for (h in listOf("example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.167.1.1", "100.128.0.1", "2001:db8::1", "999.1.1.1", "cloud.example.local.evil.com", "")) assertFalse(h, ServerAdresse.istLokal(h))
    }

    @Test fun erlaubtPruefung() {
        assertTrue(ServerAdresse.erlaubt("https://irgendwo.example.com"))
        assertTrue(ServerAdresse.erlaubt("http://192.168.1.1:3000"))
        assertFalse(ServerAdresse.erlaubt("http://irgendwo.example.com"))
        assertFalse(ServerAdresse.erlaubt("file:///etc/passwd"))
        assertFalse(ServerAdresse.erlaubt("javascript:alert(1)"))
        assertFalse(ServerAdresse.erlaubt("not a url"))
    }

    @Test fun kopplungscodeFormat() {
        assertEquals("ABCD-EFGH", Kopplung.codeNormalisieren("abcd-efgh"))
        assertEquals("ABCD-EFGH", Kopplung.codeNormalisieren(" abcd efgh "))
        assertEquals("ABCD-EFGH", Kopplung.codeNormalisieren("ABCDEFGH"))
        assertNull(Kopplung.codeNormalisieren("ABCD-EFG"))
        assertNull(Kopplung.codeNormalisieren("ABCD-EFG0")) // 0 nicht im Alphabet
        assertNull(Kopplung.codeNormalisieren("ABCD-EFGI")) // I nicht im Alphabet
        assertTrue(Kopplung.tokenGueltig("vd_app_" + "a".repeat(48)))
        assertFalse(Kopplung.tokenGueltig("vd_" + "a".repeat(48)))
        assertFalse(Kopplung.tokenGueltig("vd_app_" + "g".repeat(48)))
    }
}
