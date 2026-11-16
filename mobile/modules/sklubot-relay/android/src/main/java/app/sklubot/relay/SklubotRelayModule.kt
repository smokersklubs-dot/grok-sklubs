package app.sklubot.relay

import android.content.Context
import android.content.Intent
import app.sklubot.android.relay.PhoneAccessibilityService
import app.sklubot.android.relay.RelayActivity
import app.sklubot.android.relay.RelayHub
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The bridge between the Sklubot app (React Native) and the phone relay. It only opens the relay's own screen and
 * tells it the server address; turning the relay on, pairing, enabling accessibility and every consent stay taps of
 * the user in the native screens. https://docs.expo.dev/modules/module-api/
 */
class SklubotRelayModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SklubotRelay")

    /** The relay reads the server address from the app's preferences ("sklubot" / "server"), like android/ did. */
    Function("setServer") { origin: String ->
      context.getSharedPreferences("sklubot", Context.MODE_PRIVATE).edit().putString("server", origin).apply()
    }

    Function("openRelay") {
      val activity = appContext.currentActivity
      val intent = Intent(context, RelayActivity::class.java)
      if (activity != null) activity.startActivity(intent)
      else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("status") {
      val prefs = RelayHub.prefs(context)
      mapOf(
        "enabled" to prefs.enabled,
        "accessibility" to (RelayHub.service != null || PhoneAccessibilityService.isEnabled(context)),
        "locked" to prefs.isLocked(),
        "state" to RelayHub.statusText(context),
      )
    }
  }
}
