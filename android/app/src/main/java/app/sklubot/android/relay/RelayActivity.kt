package app.sklubot.android.relay

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.sklubot.android.R

/**
 * "Contrôle du téléphone": the screen where the user turns the phone relay on or off, sees the pairing code, enables
 * the accessibility service (with the official settings intent), chooses blocked apps, takes back "always" from a
 * bot, re-allows control after a Stop, reads the local action log, and forgets the server.
 */
class RelayActivity : Activity() {
    private val listener: () -> Unit = { render() }
    private lateinit var root: LinearLayout

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        root = Ui.column(this)
        val scroll = ScrollView(this).apply { setBackgroundColor(Ui.SURFACE); addView(root); fitsSystemWindows = true }
        setContentView(scroll)
        title = getString(R.string.relay_title)
    }

    override fun onResume() {
        super.onResume()
        RelayHub.addListener(listener)
        render()
    }

    override fun onPause() {
        RelayHub.removeListener(listener)
        super.onPause()
    }

    private fun accessibilityOn() = RelayHub.service != null || PhoneAccessibilityService.isEnabled(this)
    private fun notificationsOk() = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun render() {
        val prefs = RelayHub.prefs(this)
        root.removeAllViews()
        root.addView(Ui.title(this, getString(R.string.relay_title)))
        root.addView(Ui.text(this, getString(R.string.relay_intro)))

        // ── State and the main switch ──
        val state = Ui.card(this)
        val status = RelayHub.status
        state.addView(Ui.heading(this, getString(R.string.relay_state)))
        state.addView(Ui.text(this, if (prefs.isLocked()) getString(R.string.relay_locked_short) else RelayHub.statusText(this), Ui.INK))
        val server = prefs.server
        val address = try { normalizeServer(server) } catch (e: ProtocolError) { null }
        if (server == null) state.addView(Ui.text(this, getString(R.string.relay_no_server), Ui.DANGER))
        else if (address == null) state.addView(Ui.text(this, getString(R.string.relay_https_needed, server), Ui.DANGER))
        else state.addView(Ui.text(this, getString(R.string.relay_server, address.base), Ui.MUTED, 13f))
        if (status is RelayStatus.Pairing) {
            state.addView(Ui.text(this, getString(R.string.relay_pair_intro)))
            state.addView(TextView(this).apply {
                text = status.code
                textSize = 34f
                letterSpacing = 0.12f
                setTextColor(Ui.INK)
                typeface = android.graphics.Typeface.MONOSPACE
                gravity = Gravity.CENTER
                setPadding(0, Ui.dp(context, 12), 0, Ui.dp(context, 4))
                setTextIsSelectable(true)
                contentDescription = status.code.toCharArray().joinToString(" ")
            })
            state.addView(Ui.text(this, getString(R.string.relay_pair_where), Ui.MUTED, 13f))
        }
        if (status is RelayStatus.Unauthorized) state.addView(Ui.text(this, getString(R.string.relay_pair_again)))
        val session = RelayHub.core?.session
        if (session != null) {
            state.addView(Ui.text(this, getString(R.string.relay_notif_control, session.botName), Ui.DANGER))
            state.addView(Ui.button(this, getString(R.string.relay_stop), Ui.DANGER) { RelayHub.stop(this, "user") })
        }
        if (prefs.enabled) {
            state.addView(Ui.button(this, getString(R.string.relay_turn_off), Ui.INK, filled = false) { RelayService.turnOff(this); render() })
        } else {
            val can = address != null
            state.addView(Ui.button(this, getString(R.string.relay_turn_on)) {
                if (Build.VERSION.SDK_INT >= 33 && !notificationsOk()) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
                if (status is RelayStatus.Unauthorized) RelayHub.tokens(this).clear()
                RelayService.turnOn(this)
                render()
            }.apply { isEnabled = can; alpha = if (can) 1f else 0.5f })
        }
        root.addView(state)

        // ── Stop was pressed ──
        if (prefs.isLocked()) {
            val lock = Ui.card(this)
            lock.addView(Ui.heading(this, getString(R.string.relay_locked_title)))
            lock.addView(Ui.text(this, getString(R.string.relay_locked_text)))
            lock.addView(Ui.button(this, getString(R.string.relay_unlock)) { RelayHub.unlock(this) })
            root.addView(lock)
        }

        // ── What the phone needs ──
        val needs = Ui.card(this)
        needs.addView(Ui.heading(this, getString(R.string.relay_needs)))
        val a11y = accessibilityOn()
        needs.addView(Ui.badge(this, getString(if (a11y) R.string.relay_a11y_on else R.string.relay_a11y_off), a11y))
        needs.addView(Ui.text(this, getString(R.string.relay_a11y_why)))
        if (!a11y) {
            needs.addView(Ui.text(this, getString(R.string.relay_a11y_steps)))
            // The official way in: Settings.ACTION_ACCESSIBILITY_SETTINGS (https://developer.android.com/reference/android/provider/Settings#ACTION_ACCESSIBILITY_SETTINGS).
            needs.addView(Ui.button(this, getString(R.string.relay_a11y_open)) { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
            if (Build.VERSION.SDK_INT >= 33) {
                // Android 13+ hides accessibility for apps installed from a file until "Allow restricted settings" is
                // chosen in the app's info screen (https://support.google.com/android/answer/12623953).
                needs.addView(Ui.text(this, getString(R.string.relay_restricted)))
                needs.addView(Ui.button(this, getString(R.string.relay_app_info), Ui.BRAND, filled = false) {
                    open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                })
            }
        }
        if (Build.VERSION.SDK_INT < 30) needs.addView(Ui.text(this, getString(R.string.relay_old_android), Ui.DANGER))
        if (Build.VERSION.SDK_INT >= 33) {
            val n = notificationsOk()
            needs.addView(Ui.badge(this, getString(if (n) R.string.relay_notif_on else R.string.relay_notif_off), n).apply { setPadding(0, Ui.dp(context, 12), 0, 0) })
            if (!n) needs.addView(Ui.button(this, getString(R.string.relay_notif_allow), Ui.BRAND, filled = false) { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7) })
        }
        root.addView(needs)

        // ── What bots can and cannot do ──
        val can = Ui.card(this)
        can.addView(Ui.heading(this, getString(R.string.relay_can_title)))
        can.addView(Ui.text(this, getString(R.string.relay_can)))
        can.addView(Ui.text(this, getString(R.string.relay_cannot)))
        root.addView(can)

        // ── Blocked apps, bots allowed always ──
        val perms = Ui.card(this)
        perms.addView(Ui.heading(this, getString(R.string.block_title)))
        perms.addView(Ui.text(this, if (prefs.blockEnabled) resources.getQuantityString(R.plurals.block_count, prefs.blockList.size, prefs.blockList.size) else getString(R.string.block_off)))
        perms.addView(Ui.button(this, getString(R.string.block_choose), Ui.BRAND, filled = false) { startActivity(Intent(this, BlockListActivity::class.java)) })
        val always = prefs.alwaysBots()
        perms.addView(Ui.heading(this, getString(R.string.relay_always_title)).apply { setPadding(0, Ui.dp(context, 16), 0, 0) })
        if (always.isEmpty()) perms.addView(Ui.text(this, getString(R.string.relay_always_none)))
        for (b in always) {
            perms.addView(Ui.button(this, getString(R.string.relay_always_revoke, b.name), Ui.INK, filled = false) { prefs.revokeAlways(b.id); render() })
        }
        root.addView(perms)

        // ── Local action log ──
        val logCard = Ui.card(this)
        logCard.addView(Ui.heading(this, getString(R.string.relay_log_title)))
        val lines = RelayHub.log(this).tail(25)
        if (lines.isEmpty()) logCard.addView(Ui.text(this, getString(R.string.relay_log_empty)))
        for (e in lines) {
            val bot = e.optJSONObject("bot")?.optString("name").orEmpty()
            val what = listOf(e.optString("kind"), e.optString("op"), e.optString("why"), e.optString("decision"), e.optString("reason")).filter { it.isNotEmpty() }.joinToString(" · ")
            logCard.addView(Ui.text(this, "${e.optString("ts").take(19).replace('T', ' ')}  ${if (bot.isNotEmpty()) "$bot — " else ""}$what", Ui.MUTED, 12.5f))
        }
        root.addView(logCard)

        // ── Forget ──
        val forget = Ui.card(this)
        forget.addView(Ui.text(this, getString(R.string.relay_forget_text)))
        forget.addView(Ui.button(this, getString(R.string.relay_forget), Ui.DANGER, filled = false) {
            RelayService.turnOff(this)
            RelayHub.tokens(this).clear()
            prefs.forget()
            RelayHub.status = RelayStatus.Idle
            render()
        })
        root.addView(forget)
        root.addView(View(this), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 24)))
    }

    private fun open(i: Intent) = try { startActivity(i) } catch (_: Exception) { startActivity(Intent(Settings.ACTION_SETTINGS)) }
}
