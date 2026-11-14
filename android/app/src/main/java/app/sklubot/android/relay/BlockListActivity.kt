package app.sklubot.android.relay

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import app.sklubot.android.R

/**
 * "Applis bloquées": the apps where bots may neither look nor touch (screenshots, screen text, taps, typing are
 * refused while one of them is on screen, and they cannot be opened by a bot). Which apps are banking or payment apps
 * cannot be known in general, so the user picks them; the switch "bloquer les applis de paiement et banque que je
 * choisis" is on by default. The list of apps comes from the launcher intent declared in the manifest's <queries>
 * (https://developer.android.com/training/package-visibility/declaring).
 */
class BlockListActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        title = getString(R.string.block_title)
        val prefs = RelayHub.prefs(this)
        val root = Ui.column(this)
        root.addView(Ui.title(this, getString(R.string.block_title)))
        root.addView(Ui.text(this, getString(R.string.block_intro)))
        val toggle = Switch(this).apply {
            text = getString(R.string.block_toggle)
            textSize = 15f
            setTextColor(Ui.INK)
            isChecked = prefs.blockEnabled
            filterTouchesWhenObscured = true
            setPadding(0, Ui.dp(context, 14), 0, Ui.dp(context, 8))
            setOnCheckedChangeListener { _, on -> prefs.blockEnabled = on }
        }
        root.addView(toggle)
        val list = Ui.card(this)
        val pm = packageManager
        @Suppress("DEPRECATION")
        val apps = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .distinctBy { it.first }.filter { it.first != packageName }.sortedBy { it.second.lowercase() }
        val chosen = prefs.blockList.toMutableSet()
        // Apps already blocked but no longer installed stay in the list until unticked.
        val all = apps + chosen.filter { p -> apps.none { it.first == p } }.map { it to it }
        if (all.isEmpty()) list.addView(Ui.text(this, getString(R.string.block_no_apps)))
        for ((pkg, label) in all) {
            list.addView(CheckBox(this).apply {
                text = label
                textSize = 15f
                setTextColor(Ui.INK)
                isChecked = pkg in chosen
                filterTouchesWhenObscured = true
                contentDescription = "$label ($pkg)"
                setOnCheckedChangeListener { _, on -> if (on) chosen.add(pkg) else chosen.remove(pkg); prefs.blockList = chosen.toSet() }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 48)))
        }
        root.addView(list)
        root.addView(Ui.text(this, getString(R.string.block_always), Ui.MUTED, 13f))
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.SURFACE); addView(root); fitsSystemWindows = true })
    }
}
