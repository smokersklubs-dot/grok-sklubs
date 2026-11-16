package app.sklubot.android.relay

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
import app.sklubot.android.R

/**
 * Holds the relay's WebSocket while the user has turned the relay on, as a foreground service with a persistent
 * notification (https://developer.android.com/develop/background-work/services/fgs). Type "specialUse"
 * (https://developer.android.com/develop/background-work/services/fgs/service-types#special-use): a connection the
 * user keeps open so their own bots can reach their phone fits none of the other types. Declared in the manifest with
 * FOREGROUND_SERVICE_SPECIAL_USE and the PROPERTY_SPECIAL_USE_FGS_SUBTYPE property.
 *
 * Only started from the app's relay screen (a visible activity), never from the server.
 */
class RelayService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_CONTROL -> { RelayHub.stop(this, "notification"); return START_NOT_STICKY }
            ACTION_TURN_OFF -> { turnOff(this); return START_NOT_STICKY }
        }
        val prefs = RelayHub.prefs(this)
        val server = try { normalizeServer(prefs.server) } catch (e: ProtocolError) { null }
        if (!prefs.enabled || server == null) { stopSelf(); return START_NOT_STICKY }
        goForeground()
        if (RelayHub.connection == null) start(server)
        return START_STICKY
    }

    private fun goForeground() {
        val n = notification(this)
        if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ONGOING_ID, n)
    }

    private fun start(server: ServerAddress) {
        val app = applicationContext
        val log = RelayHub.log(app)
        val conn = RelayConnection(
            wsUrl = server.wsUrl, hello = { RelayHub.hello(app) }, auth = RelayHub.tokens(app),
            sockets = OkHttpSockets("SklubotAndroid/${try { packageManager.getPackageInfo(packageName, 0).versionName } catch (e: Exception) { "" }}"),
            scheduler = RelayHub.scheduler, workers = RelayHub.workers, log = { log.write(it) },
            onStatus = { s -> RelayHub.status = s; refresh(app); RelayHub.changed() },
        )
        val core = RelayCore(send = conn::send, caps = RelayHub.caps, ui = RelayHub.consentUi(app), store = RelayHub.prefs(app),
            log = { log.write(it) }, scheduler = RelayHub.scheduler, ownPackage = packageName)
        conn.core = core
        RelayHub.core = core
        RelayHub.connection = conn
        conn.start()
    }

    override fun onDestroy() {
        RelayHub.connection?.stop("stopped")
        RelayHub.connection = null
        RelayHub.core = null
        RelayHub.service?.hideBannerLater()
        RelayHub.status = RelayStatus.Idle
        RelayHub.changed()
        super.onDestroy()
    }

    companion object {
        const val ONGOING_ID = 41
        const val ASK_ID = 42
        const val ACTION_STOP_CONTROL = "app.sklubot.android.relay.STOP_CONTROL"
        const val ACTION_TURN_OFF = "app.sklubot.android.relay.TURN_OFF"
        private const val CH_RELAY = "relay"
        private const val CH_ASK = "relay-ask"

        fun turnOn(c: Context) {
            RelayHub.prefs(c).enabled = true
            val i = Intent(c, RelayService::class.java)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
        }

        /** The relay is on (the user's choice) but its service is not running (after an update, or the app restarted). */
        fun resume(c: Context) {
            val prefs = RelayHub.prefs(c)
            val server = try { normalizeServer(prefs.server) } catch (e: ProtocolError) { null }
            if (!prefs.enabled || server == null || RelayHub.connection != null) return
            val i = Intent(c, RelayService::class.java)
            try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) } catch (_: Exception) { /* not allowed now: next app start */ }
        }

        fun turnOff(c: Context) {
            RelayHub.prefs(c).enabled = false
            c.stopService(Intent(c, RelayService::class.java))
            c.getSystemService(NotificationManager::class.java).cancel(ONGOING_ID)
        }

        private fun channels(c: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = c.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_RELAY, c.getString(R.string.relay_channel), NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CH_ASK, c.getString(R.string.relay_channel_ask), NotificationManager.IMPORTANCE_HIGH))
        }

        private fun builder(c: Context, channel: String): Notification.Builder {
            channels(c)
            @Suppress("DEPRECATION")
            return if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, channel) else Notification.Builder(c)
        }

        /** The persistent notification: relay on, and while a bot has control, who it is and a Stop button. */
        fun notification(c: Context): Notification {
            val session = RelayHub.core?.session
            val locked = RelayHub.prefs(c).isLocked()
            val open = PendingIntent.getActivity(c, 0, Intent(c, RelayActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
            val b = builder(c, CH_RELAY)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle(if (session != null) c.getString(R.string.relay_notif_control, session.botName) else c.getString(R.string.relay_notif_title))
                .setContentText(if (locked) c.getString(R.string.relay_locked_short) else RelayHub.statusText(c))
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
            if (session != null) {
                b.setColor(0xFFC62828.toInt())
                b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, c.getString(R.string.relay_stop),
                    PendingIntent.getService(c, 1, Intent(c, RelayService::class.java).setAction(ACTION_STOP_CONTROL), PendingIntent.FLAG_IMMUTABLE)).build())
            }
            b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, c.getString(R.string.relay_turn_off),
                PendingIntent.getService(c, 3, Intent(c, RelayService::class.java).setAction(ACTION_TURN_OFF), PendingIntent.FLAG_IMMUTABLE)).build())
            return b.build()
        }

        fun refresh(c: Context) {
            if (!RelayHub.prefs(c).enabled) return
            try { c.getSystemService(NotificationManager::class.java).notify(ONGOING_ID, notification(c)) } catch (_: SecurityException) { }
        }

        /** "Alice asks to control this phone": opens the question if the dialog did not come up by itself. */
        fun askNotification(c: Context, botName: String, open: PendingIntent) {
            val n = builder(c, CH_ASK)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(c.getString(R.string.consent_notif, botName))
                .setContentText(c.getString(R.string.consent_notif_text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .apply { if (Build.VERSION.SDK_INT >= 26) setTimeoutAfter(60_000) }
                .build()
            try { c.getSystemService(NotificationManager::class.java).notify(ASK_ID, n) } catch (_: SecurityException) { }
        }
    }
}
