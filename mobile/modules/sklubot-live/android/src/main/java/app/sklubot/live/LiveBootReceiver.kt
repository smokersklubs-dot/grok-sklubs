package app.sklubot.live

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After a reboot, only when the user chose "Relancer au démarrage du téléphone"; after an update of the app, when the
 * option is on (it was running). Both broadcasts allow starting a foreground service from the background
 * (https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#background-start-restriction-exemptions),
 * and specialUse is not among the types Android 15 forbids from BOOT_COMPLETED
 * (https://developer.android.com/about/versions/15/behavior-changes-15#fgs-boot-completed).
 */
class LiveBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val s = LiveStore.of(context)
        if (!s.enabled) return
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> if (s.onBoot) LiveService.start(context)
            Intent.ACTION_MY_PACKAGE_REPLACED -> LiveService.start(context)
        }
    }
}
