package eu.vylaris.cloud

import android.graphics.Color

object Farben {
    private val RGB = Regex("rgba?\\(\\s*(\\d{1,3})\\s*[, ]\\s*(\\d{1,3})\\s*[, ]\\s*(\\d{1,3})\\s*(?:[,/]\\s*([0-9.]+%?))?\\s*\\)")

    /** "rgb(11, 13, 17)" / "rgba(...)" / "#rrggbb" -> Farbe; null bei Unbekanntem oder durchsichtig */
    fun auslesen(text: String?): Int? {
        val s = text?.trim()?.trim('"') ?: return null
        if (s.startsWith("#") && (s.length == 7)) return try { Color.parseColor(s) } catch (e: IllegalArgumentException) { null }
        val m = RGB.matchEntire(s) ?: return null
        val a = m.groupValues[4]
        if (a.isNotEmpty()) {
            val alpha = if (a.endsWith("%")) a.dropLast(1).toFloatOrNull()?.div(100) else a.toFloatOrNull()
            if (alpha == null || alpha < 0.9f) return null
        }
        val (r, g, b) = m.destructured
        val ri = r.toInt(); val gi = g.toInt(); val bi = b.toInt()
        if (ri > 255 || gi > 255 || bi > 255) return null
        return Color.rgb(ri, gi, bi)
    }

    fun hell(farbe: Int): Boolean {
        val l = (0.299 * Color.red(farbe) + 0.587 * Color.green(farbe) + 0.114 * Color.blue(farbe)) / 255.0
        return l > 0.6
    }
}
