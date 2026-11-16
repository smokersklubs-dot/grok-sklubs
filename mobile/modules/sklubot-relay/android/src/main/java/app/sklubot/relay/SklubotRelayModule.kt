package app.sklubot.relay

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.sklubot.android.relay.PhoneAccessibilityService
import app.sklubot.android.relay.RelayActivity
import app.sklubot.android.relay.RelayHub
import app.sklubot.android.relay.RelayService
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
        "paired" to (RelayHub.tokens(context).get() != null),
        "accessibilityWasOn" to prefs.accessibilityWasOn,
      )
    }

    /** At each start of the app: the relay's connection comes back if the user left the relay on. */
    Function("resume") { RelayService.resume(context) }

    /**
     * Opens Sklubot's own page in the accessibility settings (Settings.ACTION_ACCESSIBILITY_DETAILS_SETTINGS, Android 11+,
     * with the service's component — https://developer.android.com/reference/android/provider/Settings#ACTION_ACCESSIBILITY_DETAILS_SETTINGS),
     * or the accessibility list when that page is not available. The user turns it on there; the app never does.
     */
    Function("openAccessibility") {
      val component = ComponentName(context, PhoneAccessibilityService::class.java)
      val detail = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS")
        .putExtra(Intent.EXTRA_COMPONENT_NAME, component.flattenToString())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val list = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val opened = Build.VERSION.SDK_INT >= 30 && try { context.startActivity(detail); true } catch (_: Exception) { false }
      if (!opened) context.startActivity(list)
    }

    /** The app's info screen, where Android 13+ offers "Allow restricted settings" for an app installed from a file. */
    Function("openAppInfo") {
      context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}
