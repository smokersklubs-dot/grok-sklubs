package app.sklubot.android.relay

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.sklubot.android.R
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService

/**
 * Glue between the pieces of the phone relay, all in the app's single process: the foreground service that holds the
 * connection (RelayService), the accessibility service (the phone's hands and eyes), the consent dialog and the app's
 * relay screen. The relay only exists while the user has turned it on in the app.
 */
object RelayHub {
    private val main = Handler(Looper.getMainLooper())
    @Volatile var service: PhoneAccessibilityService? = null
        private set
    @Volatile var connection: RelayConnection? = null
    @Volatile var core: RelayCore? = null
    @Volatile var status: RelayStatus = RelayStatus.Idle
    val scheduler: ScheduledExecutorService by lazy { Executors.newSingleThreadScheduledExecutor() }
    val workers by lazy { Executors.newFixedThreadPool(4) }
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val prompts = ConcurrentHashMap<String, (String) -> Unit>()
    private var prefs: RelayPrefs? = null
    private var tokens: TokenStore? = null
    private var actionLog: ActionLog? = null

    fun prefs(c: Context) = prefs ?: RelayPrefs(c.applicationContext).also { prefs = it }
    fun tokens(c: Context) = tokens ?: TokenStore(c.applicationContext).also { tokens = it }
    fun log(c: Context) = actionLog ?: ActionLog(c.applicationContext).also { actionLog = it }

    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    fun changed() = main.post { listeners.forEach { it() } }

    fun attachService(s: PhoneAccessibilityService) { service = s; core?.session?.let { s.showBanner(it.botName) }; changed() }
    fun detachService(s: PhoneAccessibilityService) { if (service === s) service = null; changed() }

    /** PhoneCaps for RelayCore: the accessibility service when the user enabled it, else "permission missing". */
    val caps = object : PhoneCaps {
        private fun s() = service ?: throw ProtocolError(Err.PERMISSION_MISSING, "the Sklubot accessibility service is off on this phone")
        override fun ready() = service != null
        override fun screenInfo() = service?.screenInfo() ?: JSONObject().put("platform", "android").put("accessibility", false)
        override fun capture(a: Args.Capture) = s().capture(a)
        override fun read(a: Args.Read) = s().read(a)
        override fun tap(a: Args.Tap) = s().tap(a)
        override fun swipe(a: Args.Swipe) = s().swipe(a)
        override fun type(text: String) = s().type(text)
        override fun global(action: String) = s().global(action)
        override fun resolveApp(name: String) = s().resolveApp(name)
        override fun launch(pkg: String) = s().launch(pkg)
        override fun openUrl(url: String) = s().openUrl(url)
        override fun foregroundPackages() = service?.foregroundPackages() ?: emptyList()
        override fun screenLocked() = service?.screenLocked() ?: false
    }

    /** The consent dialog and the indicators. */
    fun consentUi(c: Context) = object : ConsentUi {
        private val app = c.applicationContext
        override fun askSession(promptId: String, bot: Bot, reason: String, timeoutMs: Long, answer: (String) -> Unit) {
            prompts[promptId] = answer
            val i = Intent(app, ConsentActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY)
                .putExtra("promptId", promptId).putExtra("bot", bot.name).putExtra("reason", reason)
                .putExtra("deadline", System.currentTimeMillis() + timeoutMs)
            // Starting an activity from the background is allowed while the system binds our accessibility service
            // (https://developer.android.com/guide/components/activities/background-starts). The notification is the
            // fallback, and the way back to the question if the user leaves it.
            try { app.startActivity(i) } catch (_: Exception) { }
            RelayService.askNotification(app, bot.name, PendingIntent.getActivity(app, 2, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            changed()
        }
        override fun cancelPrompt(promptId: String) {
            prompts.remove(promptId)
            app.getSystemService(NotificationManager::class.java).cancel(RelayService.ASK_ID)
            ConsentActivity.close(promptId)
            changed()
        }
        override fun onSession(session: Session?) {
            if (session != null) service?.showBanner(session.botName) else service?.hideBannerLater()
            RelayService.refresh(app)
            changed()
        }
        override fun onLocked(locked: Boolean) { RelayService.refresh(app); changed() }
    }

    /** The dialog's answer (only from ConsentActivity, a screen of this app). */
    fun answer(c: Context, promptId: String, decision: String) {
        c.getSystemService(NotificationManager::class.java).cancel(RelayService.ASK_ID)
        prompts.remove(promptId)?.invoke(decision)
        changed()
    }

    /** Stop, from the notification, the banner, the tile or the app: ends the session and locks the relay. */
    fun stop(c: Context, source: String) {
        val core = core
        if (core != null) core.stop(source) else { prefs(c).setLocked(true) }
        service?.hideBannerLater()
        RelayService.refresh(c.applicationContext)
        changed()
    }

    fun unlock(c: Context) {
        val core = core
        if (core != null) core.unlock() else prefs(c).setLocked(false)
        RelayService.refresh(c.applicationContext)
        changed()
    }

    /** The phone's hello (protocol §3, kind "phone" from revision 1.2). */
    fun hello(c: Context): JSONObject {
        val info = caps.screenInfo()
        return JSONObject()
            .put("protocol", Proto.REVISION)
            .put("app", JSONObject().put("name", "sklubot-android").put("version", appVersion(c)))
            .put("device", JSONObject().put("name", deviceName(c)).put("platform", "android").put("kind", "phone")
                .put("arch", Build.SUPPORTED_ABIS.firstOrNull() ?: "").put("osRelease", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(60)).put("locale", java.util.Locale.getDefault().toLanguageTag()))
            .put("capabilities", org.json.JSONArray(CAPABILITIES.filter { it != "screen.capture" || Build.VERSION.SDK_INT >= 30 }))
            .put("screen", if (info.has("width")) JSONObject().put("width", info.getInt("width")).put("height", info.getInt("height")).put("scaleFactor", info.optDouble("scaleFactor", 1.0)) else JSONObject.NULL)
            .put("limits", JSONObject().put("maxInboundBytes", Proto.MAX_INBOUND_BYTES).put("maxViewFps", 0))
            .put("state", JSONObject().put("locked", prefs(c).isLocked()).put("accessibility", service != null))
    }

    private fun appVersion(c: Context): String = try { c.packageManager.getPackageInfo(c.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }

    fun deviceName(c: Context): String {
        // Settings.Global.DEVICE_NAME (API 25): the name the user gave the phone.
        val user = if (Build.VERSION.SDK_INT >= 25) try { android.provider.Settings.Global.getString(c.contentResolver, android.provider.Settings.Global.DEVICE_NAME) } catch (e: Exception) { null } else null
        return cleanText(user?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}", 60)
    }

    fun statusText(c: Context): String = when (val s = status) {
        is RelayStatus.Idle -> c.getString(R.string.relay_status_off)
        is RelayStatus.Connecting -> c.getString(R.string.relay_status_connecting)
        is RelayStatus.Pairing -> c.getString(R.string.relay_status_pairing)
        is RelayStatus.Online -> c.getString(R.string.relay_status_online, s.serverName.ifBlank { "Sklubot" })
        is RelayStatus.Waiting -> c.getString(R.string.relay_status_waiting, s.seconds)
        is RelayStatus.Unauthorized -> c.getString(if (s.revoked) R.string.relay_status_revoked else R.string.relay_status_unauthorized)
        is RelayStatus.Outdated -> c.getString(R.string.relay_status_outdated)
        is RelayStatus.Replaced -> c.getString(R.string.relay_status_replaced)
    }
}
