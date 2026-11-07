package eu.vylaris.cloud.protokoll

import java.io.InputStream

/** Auskunft über einen Server (health + theme) */
data class ServerInfo(
    val basis: String,
    val name: String,
    val farbe: String,
    /** Marken-Icon des Inhabers (Eigenmarke), relativer oder absoluter Pfad; leer = keine Eigenmarke */
    val markeIcon: String,
    val markeLogo: String,
    val eingerichtet: Boolean
)

data class AppNutzer(val id: Long, val name: String, val rolle: String)

data class KoppelErgebnis(val token: String, val nutzer: AppNutzer, val serverName: String, val serverFarbe: String)

data class SitzungErgebnis(val nutzer: AppNutzer, val cookies: List<String>)

data class IchErgebnis(val nutzer: AppNutzer, val geraetId: Long, val geraetName: String)

data class UploadErgebnis(
    val name: String,
    val seite: String,
    val direkt: String,
    val download: String,
    val groesse: Long
)

/** Eine Datei, die hochgeladen werden soll. Auf Android hinter einem ContentResolver, in Tests im Speicher. */
interface UploadQuelle {
    val name: String
    val mime: String

    /** Größe in Bytes oder -1, wenn unbekannt */
    val groesse: Long
    fun oeffnen(): InputStream
}

enum class FehlerArt {
    NETZ,
    KEIN_SERVER,
    UMLEITUNG,
    UNGUELTIGER_CODE,
    ZU_VIELE_VERSUCHE,
    NICHT_ANGEMELDET,
    ZU_GROSS,
    ABGEBROCHEN,
    UNZULAESSIG,
    SERVER
}

/**
 * Lesefehler der Upload-Quelle (Datei gelöscht, Freigabe widerrufen, Lesefehler). Wird vom Transport unverändert
 * durchgereicht, damit er nicht als Netzfehler erscheint; der Client wirft daraus wieder die ursprüngliche Ausnahme.
 */
class QuellFehler(val ursache: Exception) : RuntimeException(ursache.message, ursache)

class ProtokollFehler(
    val art: FehlerArt,
    val status: Int = 0,
    meldung: String? = null,
    /** Bei UMLEITUNG: Ursprung des Ziels */
    val ziel: String? = null,
    cause: Throwable? = null
) : Exception(meldung ?: art.name, cause)
