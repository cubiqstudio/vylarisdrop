package eu.vylaris.cloud.protokoll

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

data class Antwort(val status: Int, val kopf: Map<String, List<String>>, val text: String) {
    fun kopfEintraege(name: String): List<String> =
        kopf.entries.filter { it.key.equals(name, ignoreCase = true) }.flatMap { it.value }

    fun erster(name: String): String? = kopfEintraege(name).firstOrNull()
}

/** Anfrage-Rumpf: feste Länge (-1 = unbekannt, wird in Stücken gesendet) und ein Schreiber. */
class Rumpf(val laenge: Long, val schreiben: (OutputStream) -> Unit)

fun rumpfAusBytes(b: ByteArray) = Rumpf(b.size.toLong()) { it.write(b) }

/**
 * Dünne HTTP-Schicht über HttpURLConnection (blockierend; Aufrufer läuft auf einem Hintergrund-Thread).
 * Verweigert unverschlüsselte Verbindungen zu nicht-lokalen Adressen und folgt keinen Weiterleitungen
 * (damit POST-Aufrufe nicht still umgeleitet werden).
 */
open class HttpTransport(
    private val verbindenMs: Int = 10_000,
    private val lesenMs: Int = 30_000
) {
    open fun senden(
        methode: String,
        url: String,
        kopf: Map<String, String> = emptyMap(),
        rumpf: Rumpf? = null,
        lesenMs: Int = this.lesenMs,
        fortschritt: ((Long) -> Unit)? = null
    ): Antwort {
        if (!ServerAdresse.erlaubt(url))
            throw ProtokollFehler(FehlerArt.UNZULAESSIG, meldung = "Unverschlüsselte Verbindung zu nicht-lokaler Adresse: $url")
        val c = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw ProtokollFehler(FehlerArt.NETZ, meldung = e.message, cause = e)
        }
        try {
            c.requestMethod = methode
            c.instanceFollowRedirects = false
            c.connectTimeout = verbindenMs
            c.readTimeout = lesenMs
            c.useCaches = false
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("Accept-Encoding", "identity")
            for ((k, v) in kopf) c.setRequestProperty(k, v)
            if (rumpf != null) {
                c.doOutput = true
                if (rumpf.laenge >= 0) c.setFixedLengthStreamingMode(rumpf.laenge) else c.setChunkedStreamingMode(64 * 1024)
                val aus = c.outputStream
                val zaehler = if (fortschritt == null) aus else ZaehlendeAusgabe(aus, fortschritt)
                rumpf.schreiben(zaehler)
                zaehler.flush()
            }
            val status = c.responseCode
            val strom: InputStream? = if (status >= 400) c.errorStream else c.inputStream
            val text = strom?.use { lesen(it, 4 * 1024 * 1024) } ?: ""
            val kopfAus = c.headerFields.filterKeys { it != null }.mapKeys { it.key!! }
            return Antwort(status, kopfAus, text)
        } catch (e: ProtokollFehler) {
            throw e
        } catch (e: Exception) {
            throw ProtokollFehler(FehlerArt.NETZ, meldung = e.message ?: e.javaClass.simpleName, cause = e)
        } finally {
            c.disconnect()
        }
    }

    private fun lesen(s: InputStream, max: Int): String {
        val puffer = ByteArrayOutputStream()
        val b = ByteArray(8192)
        while (true) {
            val n = s.read(b)
            if (n < 0) break
            if (puffer.size() + n > max) break
            puffer.write(b, 0, n)
        }
        return puffer.toString(Charsets.UTF_8.name())
    }

    private class ZaehlendeAusgabe(private val ziel: OutputStream, private val melden: (Long) -> Unit) : OutputStream() {
        private var summe = 0L
        override fun write(b: Int) {
            ziel.write(b)
            summe++
            melden(summe)
        }

        override fun write(b: ByteArray, off: Int, len: Int) {
            ziel.write(b, off, len)
            summe += len
            melden(summe)
        }

        override fun flush() = ziel.flush()
        override fun close() = ziel.close()
    }
}
