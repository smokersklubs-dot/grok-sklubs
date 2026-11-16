package app.sklubot.live

import android.app.NotificationManager
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The app's switch for the background connection. https://docs.expo.dev/modules/module-api/ */
class SklubotLiveModule : Module() {
    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("SklubotLive")

        /** Turned on in Réglages (the app is in front): saves the choice and the session, starts the service. */
        Function("enable") { origin: String, session: String, onBoot: Boolean ->
            val s = LiveStore.of(context)
            s.save(origin, session)
            s.onBoot = onBoot
            s.enabled = true
            LiveService.start(context)
        }
        Function("disable") { LiveService.turnOff(context) }
        Function("setOnBoot") { on: Boolean -> LiveStore.of(context).onBoot = on }
        /** The session changed (signed in again): the service uses the new one at its next connection. */
        Function("updateSession") { origin: String, session: String ->
            val s = LiveStore.of(context)
            if (s.enabled) s.save(origin, session)
        }
        /** At each start of the app: a service that the system or an update stopped comes back. */
        Function("resume") {
            val s = LiveStore.of(context)
            if (s.enabled && s.session() != null) LiveService.start(context)
        }
        Function("setAppInFront") { front: Boolean -> LiveStore.of(context).appInFront = front }
        Function("clearBot") { botId: String ->
            context.getSystemService(NotificationManager::class.java).cancel(LiveService.TAG_BOT, botId.hashCode())
        }
        Function("status") {
            val s = LiveStore.of(context)
            mapOf("enabled" to s.enabled, "onBoot" to s.onBoot)
        }
    }
}
