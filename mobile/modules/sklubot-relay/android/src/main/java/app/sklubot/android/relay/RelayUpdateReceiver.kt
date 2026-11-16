package app.sklubot.android.relay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After an update of the app, Android stops its processes, so the relay's connection (RelayService) is gone although
 * the user left the relay on. ACTION_MY_PACKAGE_REPLACED (https://developer.android.com/reference/android/content/Intent#ACTION_MY_PACKAGE_REPLACED)
 * brings it back; that broadcast may start a foreground service from the background
 * (https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#background-start-restriction-exemptions).
 * Pairing and the user's choices are untouched by an update (private preferences and the Keystore key survive it).
 * The accessibility service is never turned on here: only the user does that, in the phone's settings.
 */
class RelayUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        RelayService.resume(context)
    }
}
