package app.sklubot.voice

import android.content.Context
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The bridge for voice calls. The protocol with the server (WebSocket /api/voice/:botId), the captions and the
 * device-speech conversation live in the app's TypeScript (src/voice/); this module only does what needs the platform:
 * capture, playback, routing, focus, the phone's speech services and the foreground service.
 * Expo Modules API: https://docs.expo.dev/modules/module-api/ (Function, Events, sendEvent).
 */
class SklubotVoiceModule : Module() {
    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private var engine: AudioEngine? = null
    private var speech: DeviceSpeech? = null

    private fun engine(): AudioEngine = engine ?: AudioEngine(context, object : AudioEngine.Events {
        override fun pcm(bytes: ByteArray, level: Double) = sendEvent("onPcm", mapOf("data" to Base64.encodeToString(bytes, Base64.NO_WRAP), "level" to level))
        override fun played(id: Int) = sendEvent("onPlayed", mapOf("id" to id))
        override fun focus(state: String) = sendEvent("onFocus", mapOf("state" to state))
        override fun error(where: String, message: String) = sendEvent("onError", mapOf("where" to where, "message" to message))
    }).also { engine = it }

    private fun speech(): DeviceSpeech = speech ?: DeviceSpeech(context, object : DeviceSpeech.Events {
        override fun speech(type: String, text: String?, code: Int?) = sendEvent("onSpeech", mapOf("type" to type, "text" to text, "code" to code))
        override fun tts(type: String, id: String) = sendEvent("onTts", mapOf("type" to type, "id" to id))
    }).also { speech = it }

    override fun definition() = ModuleDefinition {
        Name("SklubotVoice")
        Events("onPcm", "onPlayed", "onFocus", "onError", "onSpeech", "onTts", "onHangUp")

        OnCreate {
            VoiceHub.onHangUp = { sendEvent("onHangUp", mapOf<String, Any>()) }
            VoiceHub.onServiceFailed = { m -> sendEvent("onError", mapOf("where" to "service", "message" to m)) }
        }
        OnDestroy {
            engine?.end(); engine = null
            speech?.release(); speech = null
            try { CallService.stop(context) } catch (_: Exception) { }
        }

        /** Call starts: focus, communication mode, speaker by default, and the foreground service with its notification. */
        Function("begin") { speaker: Boolean, title: String, text: String, hangUp: String ->
            engine().begin(speaker)
            CallService.start(context, title, text, hangUp)
        }
        Function("end") {
            engine?.end(); engine = null
            speech?.release(); speech = null
            CallService.stop(context)
        }
        Function("setSpeaker") { on: Boolean -> engine().setSpeaker(on) }
        Function("startCapture") { engine().startCapture() }
        Function("stopCapture") { engine?.stopCapture() }
        Function("play") { id: Int, wavBase64: String -> engine().play(id, Base64.decode(wavBase64, Base64.DEFAULT)) }
        Function("stopPlayback") { engine?.stopPlayback() }
        Function("setVolume") { v: Double -> engine?.setVolume(v.toFloat()) }

        Function("recognitionAvailable") { speech().recognitionAvailable() }
        Function("listen") { lang: String -> speech().listen(lang); Unit }
        Function("stopListening") { speech?.stopListening(); Unit }
        Function("speak") { id: String, text: String, lang: String, rate: Double -> speech().speak(id, text, lang, rate.toFloat()); Unit }
        Function("stopSpeaking") { speech?.stopSpeaking(); Unit }
    }
}
