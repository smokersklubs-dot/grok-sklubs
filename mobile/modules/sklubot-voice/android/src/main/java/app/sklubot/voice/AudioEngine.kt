package app.sklubot.voice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * The audio side of a call, with the platform APIs only:
 * - capture: AudioRecord, source VOICE_COMMUNICATION (the platform's echo cancellation, tuned for calls), 16 kHz mono
 *   16-bit, 20 ms frames (320 samples) — the format the server expects (server/src/voice/session.ts) and what the
 *   web's AudioWorklet sends. https://developer.android.com/reference/android/media/AudioRecord
 * - playback: AudioTrack in stream mode, usage VOICE_COMMUNICATION, one WAV after another, each acknowledged once heard
 *   (`played`), stoppable at once (barge-in). https://developer.android.com/reference/android/media/AudioTrack
 * - routing: MODE_IN_COMMUNICATION, speaker or earpiece (setCommunicationDevice on Android 12+, speakerphone before).
 *   https://developer.android.com/reference/android/media/AudioManager#setCommunicationDevice(android.media.AudioDeviceInfo)
 * - audio focus: AUDIOFOCUS_GAIN_TRANSIENT for a voice call; a phone call or another app taking it is reported.
 *   https://developer.android.com/media/optimize/audio-focus
 */
class AudioEngine(context: Context, private val events: Events) {
    interface Events {
        fun pcm(bytes: ByteArray, level: Double)
        fun played(id: Int)
        fun focus(state: String)
        fun error(where: String, message: String)
    }

    private val app = context.applicationContext
    private val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val voiceAttrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    // ── Focus and routing ──
    private var focusRequest: AudioFocusRequest? = null
    private var oldMode = AudioManager.MODE_NORMAL
    @Volatile var speaker = true
        private set

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        events.focus(when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> "gain"
            AudioManager.AUDIOFOCUS_LOSS -> "loss"
            else -> "transient"
        })
    }

    fun begin(speakerOn: Boolean) {
        oldMode = am.mode
        if (Build.VERSION.SDK_INT >= 26) {
            val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(voiceAttrs)
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = r
            am.requestAudioFocus(r)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        }
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        setSpeaker(speakerOn)
    }

    fun end() {
        stopCapture()
        stopPlayback()
        playThread?.interrupt()
        playThread = null
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
        else @Suppress("DEPRECATION") { am.isSpeakerphoneOn = false }
        am.mode = oldMode
        if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { am.abandonAudioFocusRequest(it) }
        else @Suppress("DEPRECATION") am.abandonAudioFocus(focusListener)
        focusRequest = null
    }

    /** Speaker, or the earpiece (a wired or Bluetooth headset when one is connected). */
    fun setSpeaker(on: Boolean) {
        speaker = on
        if (Build.VERSION.SDK_INT >= 31) {
            val devices = am.availableCommunicationDevices
            val wanted = if (on) listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
            else listOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
            val device = wanted.firstNotNullOfOrNull { t -> devices.firstOrNull { it.type == t } }
            if (device != null) am.setCommunicationDevice(device) else am.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = on
        }
    }

    // ── Capture ──
    @Volatile private var record: AudioRecord? = null
    private var captureThread: Thread? = null
    private val effects = mutableListOf<android.media.audiofx.AudioEffect>()

    /** Needs RECORD_AUDIO (asked by the app before the call). */
    @SuppressLint("MissingPermission")
    fun startCapture(): Boolean {
        if (record != null) return true
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) { events.error("capture", "no 16 kHz capture on this device"); return false }
        val r = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, FRAME * 2 * 8))
        } catch (e: Exception) { events.error("capture", e.message ?: "AudioRecord"); return false }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); events.error("capture", "microphone unavailable"); return false }
        // The platform's call processing, where the device offers it (VOICE_COMMUNICATION usually applies it already).
        // https://developer.android.com/reference/android/media/audiofx/AcousticEchoCanceler
        try {
            if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(r.audioSessionId)?.let { it.enabled = true; effects.add(it) }
            if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(r.audioSessionId)?.let { it.enabled = true; effects.add(it) }
            if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(r.audioSessionId)?.let { it.enabled = true; effects.add(it) }
        } catch (_: Exception) { }
        record = r
        r.startRecording()
        captureThread = Thread({
            val buf = ShortArray(FRAME)
            while (record === r) {
                var got = 0
                while (got < FRAME && record === r) {
                    val n = r.read(buf, got, FRAME - got)
                    if (n <= 0) { if (n < 0) { events.error("capture", "read $n"); return@Thread } else continue }
                    got += n
                }
                if (record !== r) break
                events.pcm(Wav.bytes(buf, FRAME), Wav.level(buf, FRAME))
            }
        }, "sklubot-voice-capture").apply { priority = Thread.MAX_PRIORITY; start() }
        return true
    }

    fun stopCapture() {
        val r = record ?: return
        record = null
        try { r.stop() } catch (_: Exception) { }
        captureThread?.join(500)
        captureThread = null
        effects.forEach { try { it.release() } catch (_: Exception) { } }
        effects.clear()
        r.release()
    }

    // ── Playback ──
    private class Item(val id: Int, val pcm: Pcm, val gen: Int)
    private val queue = LinkedBlockingQueue<Item>()
    private val generation = AtomicInteger(0)
    private var playThread: Thread? = null
    @Volatile private var track: AudioTrack? = null
    @Volatile private var volume = 1f

    /** Queues one WAV (the server's reply sentence); `played(id)` once it has been heard, or at once if unreadable. */
    fun play(id: Int, wav: ByteArray) {
        val pcm = Wav.parse(wav)
        if (pcm == null) { events.played(id); return }
        ensurePlayer()
        queue.put(Item(id, pcm, generation.get()))
    }

    /** Barge-in or hang-up: what is playing stops now, what is queued is dropped (not acknowledged, as on the web). */
    fun stopPlayback() {
        generation.incrementAndGet()
        queue.clear()
        track?.let { try { it.pause(); it.flush() } catch (_: Exception) { } }
    }

    /** Ducking while the user speaks over the bot (the web lowers its gain to 0.15). */
    fun setVolume(v: Float) {
        volume = v.coerceIn(0f, 1f)
        try { track?.setVolume(volume) } catch (_: Exception) { }
    }

    private fun ensurePlayer() {
        if (playThread != null) return
        playThread = Thread({
            try {
                while (!Thread.currentThread().isInterrupted) {
                    val item = queue.take()
                    if (item.gen != generation.get()) continue
                    playOne(item)
                }
            } catch (_: InterruptedException) { }
            track?.release()
            track = null
        }, "sklubot-voice-play").apply { start() }
    }

    private var trackRate = 0
    private var trackChannels = 0

    private fun playOne(item: Item) {
        val p = item.pcm
        var t = track
        if (t == null || trackRate != p.sampleRate || trackChannels != p.channels) {
            t?.release()
            val mask = if (p.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
            val min = AudioTrack.getMinBufferSize(p.sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
            t = AudioTrack.Builder()
                .setAudioAttributes(voiceAttrs)
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(p.sampleRate).setChannelMask(mask).build())
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(maxOf(min, p.sampleRate / 5 * 2 * p.channels))
                .build()
            track = t
            trackRate = p.sampleRate
            trackChannels = p.channels
        }
        t.setVolume(volume)
        val startHead = t.playbackHeadPosition.toLong() and 0xffffffffL
        t.play()
        var off = 0
        val chunk = p.sampleRate / 10 * p.channels
        while (off < p.samples.size) {
            if (item.gen != generation.get()) return
            val n = t.write(p.samples, off, minOf(chunk, p.samples.size - off))
            if (n < 0) { events.error("playback", "write $n"); break }
            off += n
        }
        // Wait until the last frame was heard (the head position counts frames played since play()).
        val frames = (p.samples.size / p.channels).toLong()
        val deadline = System.currentTimeMillis() + frames * 1000 / p.sampleRate + 1500
        while (item.gen == generation.get() && System.currentTimeMillis() < deadline) {
            val head = (t.playbackHeadPosition.toLong() and 0xffffffffL) - startHead
            if (head >= frames) break
            try { Thread.sleep(20) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); return }
        }
        if (item.gen == generation.get()) events.played(item.id)
    }

    companion object {
        const val RATE = 16000
        const val FRAME = 320
    }
}
