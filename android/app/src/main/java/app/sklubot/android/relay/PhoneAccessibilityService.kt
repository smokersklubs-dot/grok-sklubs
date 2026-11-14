package app.sklubot.android.relay

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Display
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import app.sklubot.android.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The phone's hands and eyes for the relay. An AccessibilityService the user enables themselves in
 * Android Settings → Accessibility (https://developer.android.com/guide/topics/ui/accessibility/service).
 * Its configuration is res/xml/relay_accessibility.xml (canTakeScreenshot, canPerformGestures,
 * canRetrieveWindowContent). It does nothing on its own: every call comes from RelayCore, which applies the
 * user's consent, Stop, blocked apps and the lock screen first. It never reads anything while no bot has a session.
 *
 * APIs used (developer.android.com/reference):
 *  - AccessibilityService#takeScreenshot (API 30) — screenshots; older phones: not offered (see README/DEPLOIEMENT);
 *  - AccessibilityService#dispatchGesture + GestureDescription (API 24; continueStroke API 26) — taps, swipes, drags;
 *  - AccessibilityNodeInfo ACTION_SET_TEXT / ACTION_PASTE / AccessibilityAction.ACTION_IME_ENTER (API 30) — typing;
 *  - AccessibilityService#performGlobalAction (GLOBAL_ACTION_BACK, HOME, RECENTS, NOTIFICATIONS, QUICK_SETTINGS);
 *  - AccessibilityService#getWindows with flagRetrieveInteractiveWindows — which apps are on screen;
 *  - WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY — the "a bot controls your phone — Stop" banner,
 *    which needs no "draw over other apps" permission.
 */
class PhoneAccessibilityService : AccessibilityService(), PhoneCaps {
    private val main = Handler(Looper.getMainLooper())
    private val shots = Executors.newSingleThreadExecutor()
    private var banner: LinearLayout? = null
    @Volatile private var lastShotAt = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        RelayHub.attachService(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* nothing is read from events: windows are queried on request */ }
    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        RelayHub.detachService(this)
        main.post { hideBanner() }
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        RelayHub.detachService(this)
        shots.shutdownNow()
        super.onDestroy()
    }

    // ── PhoneCaps ────────────────────────────────────────────────────────────
    override fun ready() = true

    private fun screenSize(): Pair<Int, Int> {
        val wm = getSystemService(WindowManager::class.java)
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.currentWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val m = android.util.DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(m)
            m.widthPixels to m.heightPixels
        }
    }

    override fun screenInfo(): JSONObject {
        val (w, h) = screenSize()
        return JSONObject().put("width", w).put("height", h).put("scaleFactor", resources.displayMetrics.density.toDouble())
            .put("displayId", Display.DEFAULT_DISPLAY).put("displays", 1).put("platform", "android")
            .put("screenshots", Build.VERSION.SDK_INT >= 30)
    }

    override fun capture(a: Args.Capture): Capture {
        if (Build.VERSION.SDK_INT < 30) throw ProtocolError(Err.UNSUPPORTED, "screenshots need Android 11 or newer on the phone")
        var bitmap: Bitmap? = null
        for (attempt in 0..2) {
            // takeScreenshot refuses calls that come too fast (ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT): space them.
            val wait = 1100 - (System.currentTimeMillis() - lastShotAt)
            if (wait > 0) Thread.sleep(wait)
            val f = CompletableFuture<Any>()
            takeScreenshot(Display.DEFAULT_DISPLAY, shots, object : TakeScreenshotCallback {
                override fun onSuccess(result: ScreenshotResult) {
                    try {
                        val hw = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                        val soft = hw?.copy(Bitmap.Config.ARGB_8888, false)
                        result.hardwareBuffer.close()
                        f.complete(soft ?: "no bitmap")
                    } catch (e: Exception) { f.complete(e.toString()) }
                }
                override fun onFailure(errorCode: Int) { f.complete(errorCode) }
            })
            lastShotAt = System.currentTimeMillis()
            val r = try { f.get(10, TimeUnit.SECONDS) } catch (e: Exception) { "timeout" }
            if (r is Bitmap) { bitmap = r; break }
            if (r == ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) continue
            throw ProtocolError(Err.UNSUPPORTED, "the phone could not take a screenshot ($r)")
        }
        val full = bitmap ?: throw ProtocolError(Err.UNSUPPORTED, "the phone could not take a screenshot")
        val screenW = full.width
        val screenH = full.height
        var width = minOf(a.maxWidth, screenW)
        var quality = a.quality
        while (true) {
            val height = maxOf(1, Math.round(screenH.toDouble() * width / screenW).toInt())
            val scaled = if (width == screenW) full else Bitmap.createScaledBitmap(full, width, height, true)
            val out = ByteArrayOutputStream()
            scaled.compress(if (a.format == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, quality, out)
            if (scaled !== full) scaled.recycle()
            val data = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            // A message stays under 4 MiB (protocol §2).
            if (data.length < 3_800_000 || width <= 320) {
                full.recycle()
                return Capture(a.format, width, height, screenW, screenH, data)
            }
            width = (width * 0.7).toInt()
            quality = maxOf(40, quality - 10)
        }
    }

    private fun clampToScreen(x: Int, y: Int): Pair<Float, Float> {
        val (w, h) = screenSize()
        return x.coerceIn(0, w - 1).toFloat() to y.coerceIn(0, h - 1).toFloat()
    }

    private fun dispatch(vararg strokes: GestureDescription.StrokeDescription) {
        val b = GestureDescription.Builder()
        strokes.forEach { b.addStroke(it) }
        val f = CompletableFuture<Boolean>()
        val sent = dispatchGesture(b.build(), object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) { f.complete(true) }
            override fun onCancelled(gestureDescription: GestureDescription?) { f.complete(false) }
        }, main)
        if (!sent) throw ProtocolError(Err.UNSUPPORTED, "the phone refused the gesture")
        val done = try { f.get(15, TimeUnit.SECONDS) } catch (e: Exception) { false }
        if (!done) throw ProtocolError(Err.INTERNAL, "the gesture was interrupted")
    }

    override fun tap(a: Args.Tap) {
        val (x, y) = clampToScreen(a.x, a.y)
        val p = Path().apply { moveTo(x, y) }
        when {
            a.long -> dispatch(GestureDescription.StrokeDescription(p, 0, 800))
            a.double -> dispatch(GestureDescription.StrokeDescription(p, 0, 50), GestureDescription.StrokeDescription(Path().apply { moveTo(x, y) }, 150, 50))
            else -> dispatch(GestureDescription.StrokeDescription(p, 0, 60))
        }
    }

    override fun swipe(a: Args.Swipe) {
        val (fx, fy) = clampToScreen(a.fromX, a.fromY)
        val (tx, ty) = clampToScreen(a.toX, a.toY)
        if (!a.hold) {
            dispatch(GestureDescription.StrokeDescription(Path().apply { moveTo(fx, fy); lineTo(tx, ty) }, 0, a.durationMs.toLong()))
            return
        }
        // A drag: press and hold where it starts (long press), then move without lifting (continueStroke, API 26).
        if (Build.VERSION.SDK_INT < 26) throw ProtocolError(Err.UNSUPPORTED, "dragging needs Android 8 or newer")
        val hold = GestureDescription.StrokeDescription(Path().apply { moveTo(fx, fy); lineTo(fx + 1, fy) }, 0, 700, true)
        dispatch(hold)
        dispatch(hold.continueStroke(Path().apply { moveTo(fx + 1, fy); lineTo(tx, ty) }, 0, a.durationMs.toLong(), false))
    }

    private fun focusedInput(): AccessibilityNodeInfo? = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)

    override fun type(text: String): JSONObject {
        val node = focusedInput() ?: throw ProtocolError(Err.UNSUPPORTED, "no text field has the focus on the phone: tap one first")
        if (!node.isEditable) throw ProtocolError(Err.UNSUPPORTED, "the focused element is not a text field")
        val showingHint = Build.VERSION.SDK_INT >= 26 && node.isShowingHintText
        val current = if (showingHint || node.isPassword) "" else node.text?.toString() ?: ""
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, current + text) }
        if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return JSONObject().put("typed", text.length).put("method", "set_text")
        // Fallback: through the clipboard, then "paste" in the field (the clipboard keeps this text afterwards).
        val cm = getSystemService(ClipboardManager::class.java)
        val pasted = CompletableFuture<Boolean>()
        main.post { try { cm.setPrimaryClip(ClipData.newPlainText("Sklubot", text)); pasted.complete(node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) } catch (e: Exception) { pasted.complete(false) } }
        if (try { pasted.get(5, TimeUnit.SECONDS) } catch (e: Exception) { false }) return JSONObject().put("typed", text.length).put("method", "paste")
        throw ProtocolError(Err.UNSUPPORTED, "that field does not accept text")
    }

    override fun global(action: String) {
        val ok = when (action) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "quick_settings" -> performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
            "enter" -> {
                if (Build.VERSION.SDK_INT < 30) throw ProtocolError(Err.UNSUPPORTED, "enter needs Android 11 or newer")
                val node = focusedInput() ?: throw ProtocolError(Err.UNSUPPORTED, "no text field has the focus")
                node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
            }
            else -> false
        }
        if (!ok) throw ProtocolError(Err.UNSUPPORTED, "the phone refused $action")
    }

    private val packageName_ = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")

    /** Launchable apps; visible to this app thanks to the <queries> launcher intent in the manifest (Android 11 package visibility). */
    fun launchableApps(): List<Pair<String, String>> {
        val pm = packageManager
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        return pm.queryIntentActivities(i, 0).map { it.activityInfo.packageName to it.loadLabel(pm).toString() }.distinctBy { it.first }
    }

    override fun resolveApp(name: String): String? {
        if (packageName_.matches(name) && packageManager.getLaunchIntentForPackage(name) != null) return name
        val apps = launchableApps()
        val n = name.lowercase()
        return (apps.firstOrNull { it.second.lowercase() == n } ?: apps.firstOrNull { it.second.lowercase().startsWith(n) } ?: apps.firstOrNull { it.second.lowercase().contains(n) })?.first
    }

    override fun launch(pkg: String): JSONObject {
        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: throw ProtocolError(Err.UNSUPPORTED, "that app cannot be opened")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        val label = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() } catch (e: Exception) { pkg }
        return JSONObject().put("launched", label).put("package", pkg)
    }

    override fun openUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            throw ProtocolError(Err.UNSUPPORTED, "no app on the phone opens that address")
        }
    }

    private fun appWindows(): List<AccessibilityWindowInfo> =
        try { windows.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }.sortedByDescending { it.layer } } catch (e: Exception) { emptyList() }

    override fun foregroundPackages(): List<String> {
        val list = appWindows().mapNotNull { it.root?.packageName?.toString() }.toMutableList()
        rootInActiveWindow?.packageName?.toString()?.let { if (it !in list) list.add(0, it) }
        return list
    }

    override fun screenLocked(): Boolean = getSystemService(KeyguardManager::class.java).isKeyguardLocked

    override fun read(a: Args.Read): JSONObject {
        val nodes = JSONArray()
        var truncated = false
        val front = foregroundPackages().firstOrNull() ?: ""
        val roots = try {
            windows.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION || it.type == AccessibilityWindowInfo.TYPE_SYSTEM }
                .sortedByDescending { it.layer }.mapNotNull { it.root }
        } catch (e: Exception) { listOfNotNull(rootInActiveWindow) }
        val rect = Rect()
        fun walk(n: AccessibilityNodeInfo, depth: Int) {
            if (nodes.length() >= a.maxNodes) { truncated = true; return }
            if (depth > 40 || !n.isVisibleToUser) return
            val text = if (n.isPassword) (if (n.text.isNullOrEmpty()) "" else "••••") else n.text?.toString().orEmpty()
            val desc = n.contentDescription?.toString().orEmpty()
            if (text.isNotBlank() || desc.isNotBlank() || n.isEditable || (n.isClickable && depth > 0)) {
                n.getBoundsInScreen(rect)
                if (rect.width() > 0 && rect.height() > 0) {
                    nodes.put(ScreenNode(cleanText(text, 300), cleanText(desc, 200), n.viewIdResourceName?.substringAfter(":id/").orEmpty().take(60),
                        n.className?.toString()?.substringAfterLast('.').orEmpty().take(40), rect.left, rect.top, rect.width(), rect.height(),
                        n.isClickable, n.isEditable, n.isFocused, if (n.isCheckable) n.isChecked else null).toJson())
                }
            }
            for (i in 0 until n.childCount) n.getChild(i)?.let { walk(it, depth + 1) }
        }
        roots.forEach { walk(it, 0) }
        val label = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(front, 0)).toString() } catch (e: Exception) { front }
        val (w, h) = screenSize()
        return JSONObject().put("app", JSONObject().put("package", front).put("label", label)).put("nodes", nodes).put("truncated", truncated)
            .put("screenWidth", w).put("screenHeight", h)
    }

    // ── The banner while a bot has control ───────────────────────────────────
    /** Shown above every app while a bot has the control session; its Stop button stops and locks the relay. */
    @SuppressLint("SetTextI18n")
    fun showBanner(botName: String) = main.post {
        hideBanner()
        val d = resources.displayMetrics.density
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#C62828"))
            setPadding((12 * d).toInt(), (4 * d).toInt(), (6 * d).toInt(), (4 * d).toInt())
        }
        bar.addView(TextView(this).apply {
            text = getString(R.string.relay_banner, botName)
            setTextColor(Color.WHITE)
            textSize = 13f
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(Button(this).apply {
            text = getString(R.string.relay_stop)
            textSize = 12f
            minHeight = 0
            minimumHeight = 0
            setOnClickListener { RelayHub.stop(this@PhoneAccessibilityService, "banner") }
        })
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP }
        try {
            getSystemService(WindowManager::class.java).addView(bar, lp)
            banner = bar
        } catch (e: Exception) { banner = null }
    }

    fun hideBanner() {
        val b = banner ?: return
        banner = null
        try { getSystemService(WindowManager::class.java).removeView(b) } catch (_: Exception) { }
    }

    fun hideBannerLater() = main.post { hideBanner() }

    companion object {
        fun isEnabled(context: Context): Boolean {
            val enabled = android.provider.Settings.Secure.getString(context.contentResolver, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            val me = android.content.ComponentName(context, PhoneAccessibilityService::class.java).flattenToString()
            return enabled.split(':').any { it.equals(me, ignoreCase = true) }
        }
    }
}
