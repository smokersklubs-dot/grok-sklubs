package app.sklubot.android.relay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import org.robolectric.RuntimeEnvironment
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * The relay's screens, rendered with Robolectric's native graphics (no emulator needed) and saved as PNG files in
 * `screens.dir`, in French. Also checks that each screen builds and shows what it must.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w411dp-h891dp-xxhdpi")
class ScreensTest {
    private val app get() = RuntimeEnvironment.getApplication()

    @Before fun setUp() {
        app.getSharedPreferences("sklubot", Context.MODE_PRIVATE).edit().putString("server", "https://sklubot.example.com").commit()
        RelayHub.status = RelayStatus.Idle
    }

    private fun shoot(a: Activity, name: String, width: Int = 1080): File {
        val root: View = a.window.decorView
        val w = width
        root.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        val h = maxOf(root.measuredHeight, 600)
        root.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(bmp))
        val dir = File(System.getProperty("screens.dir") ?: "build/screens").apply { mkdirs() }
        val f = File(dir, "$name.png")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return f
    }

    private fun texts(v: View): List<String> = when (v) {
        is android.widget.TextView -> listOf(v.text.toString())
        is android.view.ViewGroup -> (0 until v.childCount).flatMap { texts(v.getChildAt(it)) }
        else -> emptyList()
    }

    @Test fun relayScreenOff() {
        val a = Robolectric.buildActivity(RelayActivity::class.java).setup().get()
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all.contains("Allumer le relais"))
        assertTrue(all.contains("Service d'accessibilité : désactivé"))
        assertTrue(all.contains("Ouvrir les réglages d'accessibilité"))
        assertTrue(shoot(a, "01-relais-eteint").length() > 1000)
    }

    @Test fun relayScreenPairing() {
        RelayHub.prefs(app).enabled = true
        RelayHub.status = RelayStatus.Pairing("K7QM-2XPA", null)
        val a = Robolectric.buildActivity(RelayActivity::class.java).setup().get()
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all.contains("K7QM-2XPA"))
        assertTrue(all.contains("Réglages → Ordinateurs"))
        shoot(a, "02-relais-code-appairage")
        RelayHub.prefs(app).enabled = false
    }

    @Test fun relayScreenLocked() {
        RelayHub.prefs(app).enabled = true
        RelayHub.prefs(app).setLocked(true)
        RelayHub.status = RelayStatus.Online("Sklubot de Léa")
        val a = Robolectric.buildActivity(RelayActivity::class.java).setup().get()
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all.contains("Réautoriser le contrôle"))
        shoot(a, "03-relais-verrouille")
        RelayHub.prefs(app).setLocked(false)
        RelayHub.prefs(app).enabled = false
    }

    @Test fun consentDialog() {
        val i = Intent(app, ConsentActivity::class.java).putExtra("promptId", "p1").putExtra("bot", "Alice")
            .putExtra("reason", "Regarder ton agenda pour trouver un créneau").putExtra("deadline", System.currentTimeMillis() + 60_000)
        val a = Robolectric.buildActivity(ConsentActivity::class.java, i).setup().get()
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all.contains("Laisser Alice contrôler ce téléphone ?"))
        assertTrue(all.contains("Autoriser cette fois") && all.contains("Toujours autoriser ce bot") && all.contains("Refuser"))
        shoot(a, "04-question-consentement", a.window.attributes.width.takeIf { it > 0 } ?: 920)
    }

    @Test fun blockList() {
        val a = Robolectric.buildActivity(BlockListActivity::class.java).setup().get()
        val all = texts(a.window.decorView).joinToString("\n")
        assertTrue(all.contains("Bloquer les applis de paiement et banque que je choisis"))
        shoot(a, "05-applis-bloquees")
    }
}
