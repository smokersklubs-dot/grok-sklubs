package app.sklubot.live

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * "Rester connecté en arrière-plan": holds GET /api/events (server-sent events, a ping every 20 s, server/src/routes.ts)
 * while the user keeps the option on, and posts a local notification as soon as a bot replies or waits for them — the
 * same rules as the app (LiveRules). A foreground service with a low-importance ongoing notification, as Android
 * requires (https://developer.android.com/develop/background-work/services/fgs), of type specialUse (see the manifest).
 *
 * Battery: one HTTP connection, no polling; after a drop it waits longer and longer (Backoff: 2 s … 5 min); with no
 * network it waits for the system to report one (ConnectivityManager default-network callback) instead of retrying.
 * Signed out (401) or option turned off: it stops and forgets the session.
 */
class LiveService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        // The server pings every 20 s: no byte for 75 s means the connection is dead.
        .readTimeout(75, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()
    private val backoff = Backoff()
    private lateinit var store: LiveStore
    private lateinit var rules: LiveRules
    @Volatile private var call: Call? = null
    @Volatile private var stopped = false
    private var worker: Thread? = null
    private var retry: Runnable? = null
    private var online = true
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = LiveStore.of(this)
        rules = LiveRules(getString(R.string.live_waiting))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { turnOff(this); return START_NOT_STICKY }
        if (!store.enabled || store.origin == null || store.session() == null) { stopSelf(); return START_NOT_STICKY }
        try {
            val n = ongoing(getString(R.string.live_text))
            if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ONGOING_ID, n)
        } catch (e: Exception) {
            // Not allowed to start now (Android 12+ from the background): it starts again when the app is opened.
            stopSelf()
            return START_NOT_STICKY
        }
        watchNetwork()
        if (worker == null) connect()
        // Killed by the system: started again with the saved choice and session.
        return START_STICKY
    }

    private fun watchNetwork() {
        if (netCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = main.post { if (!online) { online = true; backoff.reset(); reconnectNow() } }.let { }
            override fun onLost(network: Network) = main.post {
                if (cm.activeNetwork == null) { online = false; status(getString(R.string.live_offline)) }
            }.let { }
        }
        try { cm.registerDefaultNetworkCallback(cb); netCallback = cb } catch (_: Exception) { }
    }

    private fun reconnectNow() {
        retry?.let { main.removeCallbacks(it) }
        retry = null
        call?.cancel()
        if (worker == null) connect()
    }

    private fun connect() {
        val origin = store.origin ?: return
        val session = store.session() ?: return
        val t = Thread({ run(origin, session) }, "sklubot-live")
        worker = t
        t.start()
    }

    private fun run(origin: String, session: String) {
        var unauthorized = false
        try {
            val cookie = "sklubot_session=$session"
            // Names of the bots and who already waits (so a wait already known is not announced again).
            http.newCall(Request.Builder().url("$origin/api/bots").header("Cookie", cookie).header("Accept", "application/json").build()).execute().use { r ->
                if (r.code == 401) { unauthorized = true; return }
                if (r.isSuccessful) rules.seed(JSONObject(r.body?.string() ?: "{}"))
            }
            val c = http.newCall(Request.Builder().url("$origin/api/events").header("Cookie", cookie).header("Accept", "text/event-stream").build())
            call = c
            c.execute().use { r ->
                if (r.code == 401) { unauthorized = true; return }
                if (!r.isSuccessful) return
                val src = r.body?.source() ?: return
                val sse = SseLines()
                while (!stopped) {
                    val line = src.readUtf8Line() ?: break
                    val data = sse.line(line) ?: continue
                    val ev = try { JSONObject(data) } catch (_: Exception) { continue }
                    if (ev.optString("type") == "hello") { backoff.reset(); main.post { status(getString(R.string.live_text)) } }
                    for (a in rules.onEvent(ev)) notifyAlert(a)
                    if (rules.needsRoster) {
                        rules.rosterRead()
                        try {
                            http.newCall(Request.Builder().url("$origin/api/bots").header("Cookie", cookie).build()).execute().use { b -> if (b.isSuccessful) rules.seed(JSONObject(b.body?.string() ?: "{}")) }
                        } catch (_: Exception) { }
                    }
                }
            }
        } catch (_: Exception) {
            // Dropped, timed out or offline: retried below.
        } finally {
            call = null
            main.post {
                worker = null
                when {
                    stopped -> Unit
                    unauthorized -> turnOff(this) // signed out elsewhere, or the session was revoked
                    !online -> status(getString(R.string.live_offline))
                    else -> {
                        val delay = backoff.next()
                        status(getString(R.string.live_retry, (delay / 1000).toInt()))
                        val r = Runnable { retry = null; if (!stopped && worker == null) connect() }
                        retry = r
                        main.postDelayed(r, delay)
                    }
                }
            }
        }
    }

    private fun notifyAlert(a: Alert) {
        // The app in front shows (and notifies) by itself.
        if (store.appInFront) return
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH_BOTS) == null) {
            nm.createNotificationChannel(NotificationChannel(CH_BOTS, getString(R.string.live_channel_bots), NotificationManager.IMPORTANCE_HIGH))
        }
        // A tap opens that bot's chat (sklubot://bot/<id>, handled by the app like the website's links).
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("sklubot://bot/${Uri.encode(a.botId)}")).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pi = PendingIntent.getActivity(this, a.botId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val icon = resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: android.R.drawable.ic_dialog_email
        @Suppress("DEPRECATION")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH_BOTS) else Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH)
        val n = b.setSmallIcon(icon).setColor(0xFFE2552D.toInt()).setContentTitle(a.title).setContentText(a.body)
            .setStyle(Notification.BigTextStyle().bigText(a.body)).setAutoCancel(true).setContentIntent(pi)
            .setCategory(Notification.CATEGORY_MESSAGE).build()
        try { nm.notify(TAG_BOT, a.botId.hashCode(), n) } catch (_: SecurityException) { /* notifications refused */ }
    }

    private fun status(text: String) {
        if (stopped) return
        try { getSystemService(NotificationManager::class.java).notify(ONGOING_ID, ongoing(text)) } catch (_: SecurityException) { }
    }

    private fun ongoing(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        // Low importance: no sound, no peek, a small icon only (the least intrusive a foreground service may be).
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CH_LIVE, getString(R.string.live_channel), NotificationManager.IMPORTANCE_MIN))
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE) }
        val stop = PendingIntent.getService(this, 1, Intent(this, LiveService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val icon = resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: android.R.drawable.stat_notify_sync
        @Suppress("DEPRECATION")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH_LIVE) else Notification.Builder(this).setPriority(Notification.PRIORITY_MIN)
        b.setSmallIcon(icon).setContentTitle(getString(R.string.live_title)).setContentText(text).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, getString(R.string.live_stop), stop).build())
        if (open != null) b.setContentIntent(open)
        return b.build()
    }

    override fun onDestroy() {
        stopped = true
        retry?.let { main.removeCallbacks(it) }
        call?.cancel()
        netCallback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) { } }
        netCallback = null
        super.onDestroy()
    }

    companion object {
        const val ONGOING_ID = 71
        const val TAG_BOT = "sklubot-bot"
        const val CH_LIVE = "live"
        /** Same channel id as the app's own notifications (src/notify, expo-notifications channel "bots"). */
        const val CH_BOTS = "bots"
        const val ACTION_STOP = "app.sklubot.live.STOP"

        fun start(c: Context) {
            val i = Intent(c, LiveService::class.java)
            try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) } catch (_: Exception) { /* not allowed now */ }
        }

        /** The option off (from the app, or the notification's Stop): the service stops and the session copy is erased. */
        fun turnOff(c: Context) {
            LiveStore.of(c).clear()
            c.stopService(Intent(c, LiveService::class.java))
            c.getSystemService(NotificationManager::class.java).cancel(ONGOING_ID)
        }
    }
}
