package app.sklubot.voice

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

class WavTest {
    private fun le16(o: ByteArrayOutputStream, v: Int) { o.write(v and 0xff); o.write((v shr 8) and 0xff) }
    private fun le32(o: ByteArrayOutputStream, v: Int) { le16(o, v and 0xffff); le16(o, (v ushr 16) and 0xffff) }

    private fun wav(samples: ShortArray, rate: Int = 22050, channels: Int = 1, bits: Int = 16, extra: Boolean = false, dataSize: Int? = null): ByteArray {
        val o = ByteArrayOutputStream()
        o.write("RIFF".toByteArray()); le32(o, 0); o.write("WAVE".toByteArray())
        o.write("fmt ".toByteArray()); le32(o, 16); le16(o, 1); le16(o, channels); le32(o, rate); le32(o, rate * channels * bits / 8); le16(o, channels * bits / 8); le16(o, bits)
        if (extra) { o.write("LIST".toByteArray()); le32(o, 3); o.write(byteArrayOf(1, 2, 3, 0)) }
        o.write("data".toByteArray()); le32(o, dataSize ?: samples.size * 2)
        for (s in samples) le16(o, s.toInt())
        return o.toByteArray()
    }

    @Test fun readsPcm16() {
        val s = shortArrayOf(0, 1000, -1000, 32767, -32768)
        val p = Wav.parse(wav(s))!!
        assertEquals(22050, p.sampleRate)
        assertEquals(1, p.channels)
        assertArrayEquals(s, p.samples)
    }

    @Test fun skipsOtherChunksIncludingOddSizes() {
        val s = shortArrayOf(5, 6, 7)
        assertArrayEquals(s, Wav.parse(wav(s, extra = true))!!.samples)
    }

    @Test fun clipsAStreamedDataSize() {
        val s = shortArrayOf(1, 2, 3, 4)
        assertArrayEquals(s, Wav.parse(wav(s, dataSize = -1))!!.samples)
        assertArrayEquals(s, Wav.parse(wav(s, dataSize = 1_000_000))!!.samples)
    }

    @Test fun refusesWhatIsNotPcm16() {
        assertNull(Wav.parse(ByteArray(10)))
        assertNull(Wav.parse("RIFF0000WAVE".toByteArray()))
        assertNull(Wav.parse(wav(shortArrayOf(1), bits = 8)))
    }

    @Test fun levelAndBytes() {
        assertEquals(0.0, Wav.level(ShortArray(4)), 1e-9)
        assertEquals(0.5, Wav.level(shortArrayOf(16384, -16384)), 1e-9)
        assertArrayEquals(byteArrayOf(0x34, 0x12, 0xff.toByte(), 0xff.toByte()), Wav.bytes(shortArrayOf(0x1234, -1)))
    }
}
