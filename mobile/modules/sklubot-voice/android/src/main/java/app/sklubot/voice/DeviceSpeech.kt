package app.sklubot.voice

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * The phone's own speech, for servers without voice services (the web uses the browser's Web Speech then):
 * - SpeechRecognizer with partial results (https://developer.android.com/reference/android/speech/SpeechRecognizer —
 *   created and used on the main thread, as documented); one utterance per session, the app starts the next one.
 * - TextToSpeech for the bot's replies (https://developer.android.com/reference/android/speech/tts/TextToSpeech),
 *   with usage VOICE_COMMUNICATION so it follows the speaker/earpiece choice.
 */
class DeviceSpeech(context: Context, private val events: Events) {
    interface Events {
        fun speech(type: String, text: String?, code: Int?)
        fun tts(type: String, id: String)
    }

    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val pending = mutableListOf<Triple<String, String, Pair<String, Float>>>()

    fun recognitionAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(app)

    fun listen(lang: String) = main.post {
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(app).also { recognizer = it; it.setRecognitionListener(listener) }
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, app.packageName)
        if (lang.isNotBlank()) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
        try { r.startListening(i) } catch (e: Exception) { events.speech("error", e.message, -1) }
    }

    fun stopListening() = main.post { try { recognizer?.cancel() } catch (_: Exception) { } }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = events.speech("ready", null, null)
        override fun onBeginningOfSpeech() = events.speech("start", null, null)
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() = events.speech("stop", null, null)
        override fun onError(error: Int) = events.speech("error", null, error)
        override fun onResults(results: Bundle?) = events.speech("final", best(results), null)
        override fun onPartialResults(partialResults: Bundle?) = events.speech("partial", best(partialResults), null)
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun best(b: Bundle?): String = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim() ?: ""

    fun speak(id: String, text: String, lang: String, rate: Float) = main.post {
        val engine = tts
        if (engine == null) {
            pending.add(Triple(id, text, lang to rate))
            tts = TextToSpeech(app) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                if (!ttsReady) { pending.forEach { events.tts("error", it.first) }; pending.clear(); return@TextToSpeech }
                tts?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                tts?.setOnUtteranceProgressListener(progress)
                val waiting = pending.toList()
                pending.clear()
                waiting.forEach { say(it.first, it.second, it.third.first, it.third.second) }
            }
        } else if (!ttsReady) pending.add(Triple(id, text, lang to rate))
        else say(id, text, lang, rate)
    }

    private fun say(id: String, text: String, lang: String, rate: Float) {
        val engine = tts ?: return
        if (lang.isNotBlank()) engine.language = Locale.forLanguageTag(lang)
        engine.setSpeechRate(if (rate > 0f) rate else 1f)
        if (engine.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) events.tts("error", id)
    }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String) = events.tts("start", utteranceId)
        override fun onDone(utteranceId: String) = events.tts("done", utteranceId)
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String) = events.tts("error", utteranceId)
        override fun onStop(utteranceId: String, interrupted: Boolean) = events.tts("done", utteranceId)
    }

    fun stopSpeaking() = main.post { pending.clear(); try { tts?.stop() } catch (_: Exception) { } }

    fun release() = main.post {
        try { recognizer?.destroy() } catch (_: Exception) { }
        recognizer = null
        try { tts?.shutdown() } catch (_: Exception) { }
        tts = null
        ttsReady = false
        pending.clear()
    }
}
