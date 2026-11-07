package eu.vylaris.cloud

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast

/** Aktion "Link kopieren" der Benachrichtigung "Hochgeladen". Nicht exportiert; nur die eigene App löst sie aus. */
class LinkReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AKTION_KOPIEREN) return
        val link = intent.getStringExtra(EXTRA_LINK)?.takeIf { it.isNotBlank() } ?: return
        val cm = context.getSystemService(ClipboardManager::class.java) ?: return
        cm.setPrimaryClip(ClipData.newPlainText(context.getString(R.string.app_name), link))
        Toast.makeText(context, R.string.link_kopiert, Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val AKTION_KOPIEREN = "eu.vylaris.cloud.LINK_KOPIEREN"
        const val EXTRA_LINK = "link"
    }
}
