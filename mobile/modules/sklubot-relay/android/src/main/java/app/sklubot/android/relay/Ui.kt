package app.sklubot.android.relay

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Small helpers for the relay's screens, in the app's colours (res/values/styles.xml). */
internal object Ui {
    const val INK = 0xFF1D1E22.toInt()
    const val MUTED = 0xFF55575E.toInt()
    const val SURFACE = 0xFFF3F2EE.toInt()
    const val CARD = 0xFFFFFFFF.toInt()
    const val BRAND = 0xFFE0502F.toInt()
    const val DANGER = 0xFFC62828.toInt()
    const val OK = 0xFF2E7D32.toInt()

    fun dp(c: Context, v: Int) = (v * c.resources.displayMetrics.density).toInt()

    fun column(c: Context, pad: Int = 20) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(c, pad), dp(c, pad), dp(c, pad), dp(c, pad))
    }

    fun card(c: Context) = column(c, 16).apply {
        background = GradientDrawable().apply { setColor(CARD); cornerRadius = dp(c, 14).toFloat() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(c, 12) }
    }

    fun title(c: Context, text: CharSequence, size: Float = 22f) = TextView(c).apply {
        this.text = text; textSize = size; setTextColor(INK); typeface = Typeface.DEFAULT_BOLD
    }

    fun heading(c: Context, text: CharSequence) = title(c, text, 16f)

    fun text(c: Context, text: CharSequence, color: Int = MUTED, size: Float = 14.5f) = TextView(c).apply {
        this.text = text; textSize = size; setTextColor(color); setLineSpacing(0f, 1.15f)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(c, 6) }
    }

    fun button(c: Context, label: CharSequence, color: Int = BRAND, filled: Boolean = true, onClick: (View) -> Unit) = Button(c).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        setTextColor(if (filled) Color.WHITE else color)
        background = GradientDrawable().apply {
            setColor(if (filled) color else Color.TRANSPARENT); cornerRadius = dp(c, 12).toFloat()
            if (!filled) setStroke(dp(c, 1), color)
        }
        minHeight = dp(c, 48)
        // Taps that come through another window drawn over this one are ignored (tapjacking).
        filterTouchesWhenObscured = true
        setOnClickListener(onClick)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(c, 10) }
    }

    fun badge(c: Context, text: CharSequence, ok: Boolean) = TextView(c).apply {
        this.text = text
        textSize = 13f
        setTextColor(if (ok) OK else DANGER)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.START
    }
}
