package eu.vylaris.cloud

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Gespeicherter Server (nicht geheim) */
data class ServerEintrag(val url: String, val name: String, val farbe: String, val markeIcon: String)

/**
 * Einstellungen der App. Das App-Token liegt nur verschlüsselt auf dem Gerät: AES-256-GCM mit einem Schlüssel
 * im Android Keystore (nicht auslesbar). Bewusst keine EncryptedSharedPreferences: die Bibliothek ist
 * abgekündigt, zieht Tink mit und scheitert auf manchen Geräten nach Wiederherstellung - hier genügt eine kleine,
 * überprüfbare Lösung. Ist der Schlüssel unbrauchbar, gilt das Token als nicht vorhanden (Nutzer meldet sich neu an).
 */
class Einstellungen(context: Context) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences("vylaris", Context.MODE_PRIVATE)

    var server: ServerEintrag?
        get() {
            val url = prefs.getString("server_url", null) ?: return null
            return ServerEintrag(
                url,
                prefs.getString("server_name", null) ?: "VylarisCloud",
                prefs.getString("server_farbe", null) ?: "#1e73be",
                prefs.getString("server_marke_icon", null).orEmpty()
            )
        }
        set(v) {
            val e = prefs.edit()
            if (v == null) {
                e.remove("server_url").remove("server_name").remove("server_farbe").remove("server_marke_icon")
            } else {
                // Anderer Server: altes Token gehört nicht mehr dazu
                if (prefs.getString("server_url", null) != v.url) e.remove("token").remove("nutzer")
                e.putString("server_url", v.url).putString("server_name", v.name)
                    .putString("server_farbe", v.farbe).putString("server_marke_icon", v.markeIcon)
            }
            e.apply()
        }

    var nutzerName: String?
        get() = prefs.getString("nutzer", null)
        set(v) = prefs.edit().putString("nutzer", v).apply()

    /** Zuletzt gemessene Seitenfarbe (für Leisten und Start, bevor die Seite geladen ist) */
    var seitenFarbe: Int
        get() = prefs.getInt("seiten_farbe", 0)
        set(v) = prefs.edit().putInt("seiten_farbe", v).apply()

    /** Ohne Entschlüsselung: gibt es ein gespeichertes Token? (billig, auch für den Hauptthread) */
    fun hatToken(): Boolean = prefs.contains("token")

    fun token(): String? {
        val roh = prefs.getString("token", null) ?: return null
        return try {
            val teile = roh.split(':')
            if (teile.size != 2) return null
            val iv = Base64.decode(teile[0], Base64.NO_WRAP)
            val ct = Base64.decode(teile[1], Base64.NO_WRAP)
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, schluessel(), GCMParameterSpec(128, iv))
            String(c.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            // Schlüssel verloren oder Daten beschädigt: Token verwerfen
            tokenLoeschen()
            null
        }
    }

    // commit() mit Absicht: das Ergebnis entscheidet, ob das Token sicher gespeichert wurde
    @SuppressLint("ApplySharedPref")
    fun tokenSpeichern(token: String): Boolean {
        return try {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.ENCRYPT_MODE, schluessel())
            val ct = c.doFinal(token.toByteArray(Charsets.UTF_8))
            val wert = Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
            prefs.edit().putString("token", wert).commit()
        } catch (e: Exception) {
            tokenLoeschen()
            false
        }
    }

    fun tokenLoeschen() {
        prefs.edit().remove("token").apply()
    }

    fun alleLoeschen() {
        prefs.edit().clear().apply()
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS)
        } catch (_: Exception) {
        }
    }

    private fun schluessel(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return g.generateKey()
    }

    private companion object {
        const val ALIAS = "vylariscloud_token_v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
