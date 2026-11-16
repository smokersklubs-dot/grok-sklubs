package app.sklubot.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps a voice call going with the screen locked or the app in the background: a foreground service of type
 * "microphone" with an ongoing notification (who the call is with, a Hang up button, a tap to come back).
 * https://developer.android.com/develop/background-work/services/fgs/service-types#microphone
 * Started only from the call screen (the app is visible and RECORD_AUDIO is granted, as Android 14+ requires for this
 * type: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#wiu-restrictions),
 * stopped when the call ends.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HANG_UP) { VoiceHub.hangUp(); stopSelf(); return START_NOT_STICKY }
        val n = notification(this, intent?.getStringExtra("title") ?: "", intent?.getStringExtra("text") ?: "", intent?.getStringExtra("hangUp") ?: "")
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) else startForeground(ID, n)
        } catch (e: Exception) {
            // Not allowed now (e.g. started from the background): the call still works while the app is in front.
            VoiceHub.serviceFailed(e.message ?: "foreground service refused")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The app was swiped away: the call ends with it (nothing would show it any more).
        VoiceHub.hangUp()
        stopSelf()
    }

    companion object {
        const val ID = 61
        const val CHANNEL = "call"
        const val ACTION_HANG_UP = "app.sklubot.voice.HANG_UP"

        fun start(c: Context, title: String, text: String, hangUp: String) {
            val i = Intent(c, CallService::class.java).putExtra("title", title).putExtra("text", text).putExtra("hangUp", hangUp)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
        }

        fun stop(c: Context) { c.stopService(Intent(c, CallService::class.java)) }

        private fun notification(c: Context, title: String, text: String, hangUp: String): Notification {
            val nm = c.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, c.getString(R.string.voice_channel), NotificationManager.IMPORTANCE_LOW))
            val open = c.packageManager.getLaunchIntentForPackage(c.packageName)?.let { PendingIntent.getActivity(c, 0, it, PendingIntent.FLAG_IMMUTABLE) }
            val hang = PendingIntent.getService(c, 1, Intent(c, CallService::class.java).setAction(ACTION_HANG_UP), PendingIntent.FLAG_IMMUTABLE)
            @Suppress("DEPRECATION")
            val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CHANNEL) else Notification.Builder(c)
            b.setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_CALL)
                .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, hangUp, hang).build())
            if (open != null) b.setContentIntent(open)
            return b.build()
        }
    }
}

/** Links the notification's Hang up button and the service's state to the module (one process, one call at a time). */
object VoiceHub {
    @Volatile var onHangUp: (() -> Unit)? = null
    @Volatile var onServiceFailed: ((String) -> Unit)? = null
    fun hangUp() { onHangUp?.invoke() }
    fun serviceFailed(m: String) { onServiceFailed?.invoke(m) }
}
