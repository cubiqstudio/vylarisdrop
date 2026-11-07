package eu.vylaris.cloud.protokoll

import java.net.URI

/** Ergebnis der Adress-Prüfung: genau eines von `url` und `fehler` ist gesetzt. */
data class AdressPruefung(
    val url: String?,
    val fehler: AdressFehler?,
    /** Eingabe ohne Schema: weitere Adressen, die nacheinander versucht werden sollen (erst https, dann ggf. http) */
    val kandidaten: List<String> = emptyList()
)

enum class AdressFehler { LEER, UNGUELTIG, SCHEMA, ZUGANGSDATEN, HTTP_NICHT_LOKAL }

/**
 * Server-Adresse: nur Ursprung (Schema, Host, Port). "http://" ist nur für lokale Adressen erlaubt
 * (Heimnetz, localhost, IPs aus privaten Bereichen, *.local); alles andere muss https sein.
 * Reine Logik, ohne Android-Framework.
 */
object ServerAdresse {
    fun normalisieren(eingabe: String): AdressPruefung {
        var s = eingabe.trim().replace(Regex("\\s+"), "")
        if (s.isEmpty()) return AdressPruefung(null, AdressFehler.LEER)
        val hatSchema = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(s)
        if (hatSchema) {
            val schema = s.substringBefore("://").lowercase()
            if (schema != "http" && schema != "https") return AdressPruefung(null, AdressFehler.SCHEMA)
            return pruefenMitSchema(s)
        }
        // Eingabe ohne Schema: https zuerst; lokale Adressen zusätzlich mit http
        s = s.trimStart('/')
        val https = pruefenMitSchema("https://$s")
        if (https.url == null) return https
        val host = hostVon(https.url) ?: return https
        val kandidaten = if (istLokal(host)) listOf(https.url, "http://" + https.url.removePrefix("https://")) else listOf(https.url)
        return https.copy(kandidaten = kandidaten)
    }

    private fun pruefenMitSchema(s: String): AdressPruefung {
        val uri = try {
            URI(s)
        } catch (e: Exception) {
            return AdressPruefung(null, AdressFehler.UNGUELTIG)
        }
        val schema = uri.scheme?.lowercase() ?: return AdressPruefung(null, AdressFehler.UNGUELTIG)
        if (schema != "http" && schema != "https") return AdressPruefung(null, AdressFehler.SCHEMA)
        if (uri.rawUserInfo != null) return AdressPruefung(null, AdressFehler.ZUGANGSDATEN)
        val host = uri.host?.lowercase()
        if (host.isNullOrEmpty() || !hostFormGueltig(host)) return AdressPruefung(null, AdressFehler.UNGUELTIG)
        val port = uri.port
        if (port != -1 && port !in 1..65535) return AdressPruefung(null, AdressFehler.UNGUELTIG)
        if (schema == "http" && !istLokal(host)) return AdressPruefung(null, AdressFehler.HTTP_NICHT_LOKAL)
        val standard = (schema == "http" && port == 80) || (schema == "https" && port == 443)
        val hostText = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        val url = buildString {
            append(schema).append("://").append(hostText)
            if (port != -1 && !standard) append(':').append(port)
        }
        return AdressPruefung(url, null, listOf(url))
    }

    private fun hostFormGueltig(host: String): Boolean {
        if (host.startsWith("[")) return host.length > 3 && host.endsWith("]")
        if (host.length > 253) return false
        return Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$").matches(host) ||
            Regex("^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$").matches(host)
    }

    fun hostVon(url: String): String? = try {
        URI(url).host?.lowercase()
    } catch (e: Exception) {
        null
    }

    fun istHttps(url: String) = url.startsWith("https://", ignoreCase = true)

    /** Darf diese Adresse (Schema + Host) angesprochen werden? https immer, http nur lokal. */
    fun erlaubt(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (e: Exception) {
            return false
        }
        val host = uri.host?.lowercase() ?: return false
        return when (uri.scheme?.lowercase()) {
            "https" -> true
            "http" -> istLokal(host)
            else -> false
        }
    }

    /**
     * Darf der Server-Eintrag von `von` auf `nach` umgeleitet werden? Nur auf denselben Host und nur auf https
     * (typisch: http -> https). Jede Weiterleitung auf einen anderen Host könnte Kopplungscode und Token an Dritte
     * schicken und gilt als nicht erlaubt; der Nutzer gibt die neue Adresse dann selbst ein.
     */
    fun umleitungErlaubt(von: String, nach: String): Boolean {
        if (!erlaubt(nach)) return false
        return try {
            val a = URI(von)
            val b = URI(nach)
            val hostA = a.host?.lowercase() ?: return false
            val hostB = b.host?.lowercase() ?: return false
            hostA == hostB && b.scheme?.lowercase() == "https"
        } catch (e: Exception) {
            false
        }
    }

    /** Lokale Adresse: localhost, Loopback, private/Link-Local-IPs, Namen auf .local, .lan, .home.arpa, .internal, Namen ohne Punkt. */
    fun istLokal(hostRoh: String): Boolean {
        val host = hostRoh.lowercase().trim('[', ']').trimEnd('.')
        if (host.isEmpty()) return false
        if (host == "localhost" || host.endsWith(".localhost")) return true
        if (host.contains(':')) return ipv6Lokal(host)
        val v4 = ipv4(host)
        if (v4 != null) {
            val (a, b) = v4[0] to v4[1]
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) ||
                (a == 169 && b == 254) || (a == 100 && b in 64..127) // 100.64/10: CGNAT, z. B. Tailscale
        }
        if (Regex("^[0-9.]+$").matches(host)) return false // zahlenähnlich, aber keine gültige IPv4
        if (!host.contains('.')) return true // einfacher Name im Heimnetz ("nas")
        return host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") ||
            host.endsWith(".internal") || host.endsWith(".intranet")
    }

    private fun ipv4(host: String): IntArray? {
        val teile = host.split('.')
        if (teile.size != 4) return null
        val z = IntArray(4)
        for ((i, t) in teile.withIndex()) {
            if (t.isEmpty() || t.length > 3 || !t.all { it in '0'..'9' }) return null
            z[i] = t.toInt()
            if (z[i] > 255) return null
        }
        return z
    }

    private fun ipv6Lokal(host: String): Boolean {
        val h = host.substringBefore('%')
        if (h == "::1" || h == "0:0:0:0:0:0:0:1") return true
        val mapped = Regex("^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$").find(h)
        if (mapped != null) return istLokal(mapped.groupValues[1])
        val erste = h.substringBefore(':')
        if (erste.isEmpty()) return false
        val wert = erste.toIntOrNull(16) ?: return false
        // fc00::/7 (privat) und fe80::/10 (Link-Local)
        return (wert and 0xfe00) == 0xfc00 || (wert and 0xffc0) == 0xfe80
    }
}
