package app.sklubot.voice

/**
 * The bot's voice arrives as WAV files (RIFF, PCM 16-bit, server/src/voice/vad.ts `wavOf` and the TTS providers).
 * This reads the "fmt " and "data" chunks (http://soundfile.sapp.org/doc/WaveFormat/) and returns the samples.
 * Pure Kotlin: unit-tested on the JVM.
 */
data class Pcm(val sampleRate: Int, val channels: Int, val samples: ShortArray)

object Wav {
    private fun u16(b: ByteArray, i: Int) = (b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8)
    private fun u32(b: ByteArray, i: Int) = u16(b, i) or (u16(b, i + 2) shl 16)

    /** Null when it is not 16-bit PCM WAV. A "data" size past the end (streamed WAV) is clipped to what is there. */
    fun parse(b: ByteArray): Pcm? {
        if (b.size < 12 || String(b, 0, 4, Charsets.US_ASCII) != "RIFF" || String(b, 8, 4, Charsets.US_ASCII) != "WAVE") return null
        var i = 12
        var rate = 0
        var channels = 0
        var bits = 0
        var format = 0
        while (i + 8 <= b.size) {
            val id = String(b, i, 4, Charsets.US_ASCII)
            val size = u32(b, i + 4)
            val body = i + 8
            if (id == "fmt " && body + 16 <= b.size) {
                format = u16(b, body)
                channels = u16(b, body + 2)
                rate = u32(b, body + 4)
                bits = u16(b, body + 14)
            } else if (id == "data") {
                // 1 = PCM; 0xFFFE = WAVE_FORMAT_EXTENSIBLE (PCM subformat in practice for 16-bit).
                if ((format != 1 && format != 0xFFFE) || bits != 16 || channels < 1 || rate <= 0) return null
                val end = if (size < 0 || body + size > b.size) b.size else body + size
                val n = (end - body) / 2
                val out = ShortArray(n)
                for (k in 0 until n) out[k] = u16(b, body + k * 2).toShort()
                return Pcm(rate, channels, out)
            }
            if (size < 0) return null
            i = body + size + (size and 1)
        }
        return null
    }

    /** Root-mean-square level of 16-bit samples, 0..1 (the web worklet's `level`). */
    fun level(s: ShortArray, n: Int = s.size): Double {
        if (n <= 0) return 0.0
        var e = 0.0
        for (k in 0 until n) { val v = s[k] / 32768.0; e += v * v }
        return Math.sqrt(e / n)
    }

    /** Little-endian bytes of 16-bit samples (what the server reads: Int16 LE). */
    fun bytes(s: ShortArray, n: Int = s.size): ByteArray {
        val out = ByteArray(n * 2)
        for (k in 0 until n) { val v = s[k].toInt(); out[k * 2] = (v and 0xff).toByte(); out[k * 2 + 1] = ((v shr 8) and 0xff).toByte() }
        return out
    }
}
