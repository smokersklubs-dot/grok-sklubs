package app.sklubot.android.relay

import android.app.Activity
import android.os.Bundle
import android.os.CountDownTimer
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ScrollView
import app.sklubot.android.R
import java.lang.ref.WeakReference

/**
 * The question asked on the phone itself before a bot may control it: "Autoriser cette fois" / "Toujours autoriser
 * ce bot" / "Refuser". The server cannot answer it: only this screen calls RelayHub.answer. While it is open, RelayCore
 * refuses every tap, swipe and keystroke from the bot (it could otherwise tap "Allow" itself), and taps arriving
 * through an overlay are filtered (filterTouchesWhenObscured). Buttons answer only after 1 s; no answer in 60 s is a
 * refusal (decided by RelayCore's own timer).
 */
class ConsentActivity : Activity() {
    private var promptId = ""
    private var answered = false
    private var timer: CountDownTimer? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setFinishOnTouchOutside(false)
        promptId = intent.getStringExtra("promptId") ?: return finish()
        current = WeakReference(this)
        val bot = intent.getStringExtra("bot") ?: "?"
        val reason = intent.getStringExtra("reason").orEmpty()
        val deadline = intent.getLongExtra("deadline", System.currentTimeMillis() + 60_000)

        val box = Ui.column(this, 24)
        box.addView(Ui.title(this, getString(R.string.consent_title, bot), 20f))
        if (reason.isNotBlank()) box.addView(Ui.text(this, getString(R.string.consent_reason, reason), Ui.INK))
        box.addView(Ui.text(this, getString(R.string.consent_what)))
        box.addView(Ui.text(this, getString(R.string.consent_stop)))
        val countdown = Ui.text(this, "", Ui.MUTED, 13f)
        box.addView(countdown)
        val buttons = listOf(
            Ui.button(this, getString(R.string.consent_once)) { decide("once") },
            Ui.button(this, getString(R.string.consent_always), Ui.BRAND, filled = false) { decide("always") },
            Ui.button(this, getString(R.string.consent_refuse), Ui.DANGER, filled = false) { decide("refuse") },
        )
        buttons.forEach { it.isEnabled = false; it.alpha = 0.5f; box.addView(it) }
        // The buttons wake up after about a second, so a tap meant for what was on screen before does not answer.
        box.postDelayed({ buttons.forEach { it.isEnabled = true; it.alpha = 1f } }, 1000)
        setContentView(ScrollView(this).apply { addView(box) })
        // At most 360 dp wide, and never wider than 92 % of a narrow screen.
        window.setLayout(minOf(Ui.dp(this, 360), (resources.displayMetrics.widthPixels * 0.92).toInt()), ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setGravity(Gravity.CENTER)
        timer = object : CountDownTimer(maxOf(0, deadline - System.currentTimeMillis()), 1000) {
            override fun onTick(left: Long) { countdown.text = getString(R.string.consent_countdown, (left / 1000).toInt()) }
            override fun onFinish() { if (!answered) finish() }
        }.start()
    }

    private fun decide(decision: String) {
        if (answered) return
        answered = true
        RelayHub.answer(this, promptId, decision)
        finish()
    }

    @Deprecated("Back answers \"refuse\" (OnBackInvokedCallback needs API 33).")
    override fun onBackPressed() { decide("refuse") }

    override fun onDestroy() {
        timer?.cancel()
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    companion object {
        private var current: WeakReference<ConsentActivity>? = null
        /** The question expired or the relay stopped: close the dialog if it is the one on screen. */
        fun close(promptId: String) {
            val a = current?.get() ?: return
            a.runOnUiThread { if (a.promptId == promptId && !a.isFinishing) { a.answered = true; a.finish() } }
        }
    }
}

