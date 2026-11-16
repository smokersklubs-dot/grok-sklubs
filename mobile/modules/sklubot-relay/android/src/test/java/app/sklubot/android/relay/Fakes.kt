package app.sklubot.android.relay

import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.CopyOnWriteArrayList

/** A phone with no screen: records what it was asked to do. */
class FakeCaps : PhoneCaps {
    var ready = true
    var front = listOf("com.example.notes")
    var locked = false
    val calls = CopyOnWriteArrayList<String>()
    val apps = mapOf("com.example.notes" to "Notes", "com.bank.app" to "Ma Banque", "app.sklubot.android" to "Sklubot")
    override fun ready() = ready
    override fun screenInfo(): JSONObject = JSONObject().put("width", 1080).put("height", 2400).put("platform", "android")
    override fun capture(a: Args.Capture): Capture { calls.add("capture ${a.maxWidth}"); return Capture("jpeg", 540, 1200, 1080, 2400, "QUJDRA==") }
    override fun read(a: Args.Read): JSONObject { calls.add("read"); return JSONObject().put("app", JSONObject().put("package", front.first())).put("nodes", org.json.JSONArray()) }
    override fun tap(a: Args.Tap) { calls.add("tap ${a.x},${a.y}${if (a.long) " long" else ""}") }
    override fun swipe(a: Args.Swipe) { calls.add("swipe ${a.fromX},${a.fromY}>${a.toX},${a.toY}${if (a.hold) " hold" else ""}") }
    override fun type(text: String): JSONObject { calls.add("type $text"); return JSONObject().put("typed", text.length).put("method", "set_text") }
    override fun global(action: String) { calls.add("global $action") }
    override fun resolveApp(name: String) = apps.entries.firstOrNull { it.key == name || it.value.equals(name, true) }?.key
    override fun launch(pkg: String): JSONObject { calls.add("launch $pkg"); return JSONObject().put("launched", apps[pkg]) }
    override fun openUrl(url: String) { calls.add("url $url") }
    override fun foregroundPackages() = front
    override fun screenLocked() = locked
}

/** The consent dialog, answered by the test (or never). */
class FakeUi(var decision: String? = "once", var delayMs: Long = 0) : ConsentUi {
    val asked = CopyOnWriteArrayList<String>()
    val cancelled = CopyOnWriteArrayList<String>()
    val sessions = CopyOnWriteArrayList<Session?>()
    var pendingAnswer: ((String) -> Unit)? = null
    override fun askSession(promptId: String, bot: Bot, reason: String, timeoutMs: Long, answer: (String) -> Unit) {
        asked.add("${bot.name}: $reason")
        val d = decision
        if (d == null) { pendingAnswer = answer; return }
        if (delayMs > 0) Thread { Thread.sleep(delayMs); answer(d) }.start() else answer(d)
    }
    override fun cancelPrompt(promptId: String) { cancelled.add(promptId) }
    override fun onSession(session: Session?) { sessions.add(session) }
    override fun onLocked(locked: Boolean) {}
}

class FakeStore : PermStore {
    val always = Collections.synchronizedSet(HashSet<String>())
    var lockedFlag = false
    var blocked = setOf<String>()
    override fun alwaysAllowed(botId: String) = botId in always
    override fun setAlwaysAllowed(bot: Bot) { always.add(bot.id) }
    override fun isLocked() = lockedFlag
    override fun setLocked(v: Boolean) { lockedFlag = v }
    override fun blockedPackages() = blocked
}

class FakeAuth : AuthStore {
    var value: Pair<String, String>? = null
    var serverName = ""
    override fun get() = value
    override fun save(deviceId: String, token: String, serverName: String) { value = deviceId to token; this.serverName = serverName }
    override fun clear() { value = null }
}

class FakeSocket(val url: String, val listener: SocketListener) : RelaySocket {
    val sent = CopyOnWriteArrayList<JSONObject>()
    @Volatile var closed: Pair<Int, String>? = null
    override fun send(text: String): Boolean { sent.add(JSONObject(text)); return closed == null }
    override fun close(code: Int, reason: String) { if (closed == null) closed = code to reason }
    override fun cancel() { closed = 1006 to "cancel" }
    fun server(msg: JSONObject) = listener.onText(msg.toString())
}

fun waitUntil(ms: Long = 5000, what: String = "condition", probe: () -> Boolean) {
    val end = System.currentTimeMillis() + ms
    while (System.currentTimeMillis() < end) { if (probe()) return; Thread.sleep(5) }
    throw AssertionError("timed out waiting for $what")
}
