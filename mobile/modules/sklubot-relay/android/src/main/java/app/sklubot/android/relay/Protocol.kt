package app.sklubot.android.relay

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * Sklubot Relais protocol v1, revision 1.2 (docs/RELAIS-PROTOCOLE.md §13), phone side. Same messages as the desktop
 * relay (companion/src/main/protocol.js); a phone announces `device.kind: "phone"` and its own operations: taps and
 * swipes instead of a mouse, Android's global actions instead of a keyboard, the on-screen text instead of windows.
 * No `shell.run`: a phone never offers commands.
 *
 * Pure Kotlin (only org.json), so the JVM unit tests run it as is.
 */
object Proto {
    const val VERSION = 1
    const val REVISION = "1.2"
    const val CONNECT_PATH = "/api/relay/connect"
    /** Server → relay messages above this close the socket (1009). */
    const val MAX_INBOUND_BYTES = 256 * 1024
    /** Relay → server messages (screenshots included). */
    const val MAX_OUTBOUND_BYTES = 4 * 1024 * 1024
    const val MAX_TYPE_TEXT = 2000
    const val MAX_ID = 64
    const val MAX_BOT_NAME = 60
    const val MAX_CAPTURE_WIDTH = 2560
    const val MAX_NODES = 400
}

object Close {
    const val NORMAL = 1000
    const val TOO_BIG = 1009
    const val UNAUTHORIZED = 4001
    const val REVOKED = 4003
    const val PAIRING_EXPIRED = 4004
    const val TOO_MANY_MESSAGES = 4008
    const val VERSION_UNSUPPORTED = 4009
    const val REPLACED = 4010
    const val PROTOCOL_ERROR = 4400
}

object Err {
    const val INVALID_ARGS = "invalid_args"
    const val TOO_LARGE = "too_large"
    const val UNKNOWN_OP = "unknown_op"
    const val UNSUPPORTED = "unsupported"
    const val PERMISSION_MISSING = "permission_missing"
    const val NO_SESSION = "no_session"
    const val BUSY = "busy"
    const val LOCKED = "locked"
    const val CONSENT_REFUSED = "consent_refused"
    const val CONSENT_EXPIRED = "consent_expired"
    const val CONSENT_PENDING = "consent_pending"
    const val CONSENT_COOLDOWN = "consent_cooldown"
    const val RATE_LIMITED = "rate_limited"
    const val INTERNAL = "internal"
    /** 1.2, phones: the app in front is one the user blocked (banking, payment…) or Sklubot itself. */
    const val BLOCKED_APP = "blocked_app"
    /** 1.2, phones: the phone's lock screen is showing. */
    const val SCREEN_LOCKED = "screen_locked"

    val ALL = setOf(INVALID_ARGS, TOO_LARGE, UNKNOWN_OP, UNSUPPORTED, PERMISSION_MISSING, NO_SESSION, BUSY, LOCKED, CONSENT_REFUSED,
        CONSENT_EXPIRED, CONSENT_PENDING, CONSENT_COOLDOWN, RATE_LIMITED, INTERNAL, BLOCKED_APP, SCREEN_LOCKED)
}

/** `session`: needs this bot's control session. `input`: acts on the phone (refused while a consent dialog is open). `screen`: sees or touches the screen (refused on blocked apps). */
data class OpSpec(val session: Boolean, val input: Boolean, val screen: Boolean)

val OPS: Map<String, OpSpec> = linkedMapOf(
    "session.start" to OpSpec(session = false, input = false, screen = false),
    "session.end" to OpSpec(false, false, false),
    "screen.info" to OpSpec(false, false, false),
    "view.stop" to OpSpec(false, false, false),
    "screen.capture" to OpSpec(true, false, true),
    "screen.read" to OpSpec(true, false, true),
    "touch.tap" to OpSpec(true, true, true),
    "touch.swipe" to OpSpec(true, true, true),
    "keyboard.type" to OpSpec(true, true, true),
    "global.action" to OpSpec(true, true, false),
    "app.open" to OpSpec(true, true, false),
    "url.open" to OpSpec(true, true, false),
)

/** What the hello announces (view.stop is accepted but no live view is offered: screenshots only). */
val CAPABILITIES: List<String> = OPS.keys.filter { it != "view.stop" }

val GLOBAL_ACTIONS = setOf("back", "home", "recents", "notifications", "quick_settings", "enter")

class ProtocolError(val code: String, message: String) : Exception(message)

data class Bot(val id: String, val name: String)

private val BOT_ID = Regex("^[A-Za-z0-9_.:-]{1,64}$")
/** Control characters and bidi overrides, stripped from anything shown to the user (as protocol.js does). */
private val UNSAFE = Regex("[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069\\u200b-\\u200f]")
fun cleanText(s: String, max: Int): String = s.replace(UNSAFE, "").trim().take(max)

fun parseBot(v: Any?): Bot {
    val o = v as? JSONObject ?: throw ProtocolError(Err.INVALID_ARGS, "bot must be an object")
    val id = o.opt("id") as? String ?: throw ProtocolError(Err.INVALID_ARGS, "bot.id must be a string")
    if (!BOT_ID.matches(id)) throw ProtocolError(Err.INVALID_ARGS, "invalid bot.id")
    val name = cleanText(o.opt("name") as? String ?: "", Proto.MAX_BOT_NAME).ifEmpty { id }
    return Bot(id, name)
}

/** Validated arguments of one request. */
sealed class Args {
    data class SessionStart(val reason: String) : Args()
    object None : Args()
    data class Capture(val format: String, val maxWidth: Int, val quality: Int) : Args()
    data class Read(val maxNodes: Int) : Args()
    data class Tap(val x: Int, val y: Int, val long: Boolean, val double: Boolean) : Args()
    data class Swipe(val fromX: Int, val fromY: Int, val toX: Int, val toY: Int, val durationMs: Int, val hold: Boolean) : Args()
    data class Type(val text: String) : Args()
    data class Global(val action: String) : Args()
    data class OpenApp(val name: String) : Args()
    data class OpenUrl(val url: String) : Args()
    data class ViewStop(val viewId: String?) : Args()
}

private fun num(v: Any?, name: String, min: Double, max: Double): Int {
    val d = (v as? Number)?.toDouble() ?: throw ProtocolError(Err.INVALID_ARGS, "$name must be a number")
    if (d.isNaN() || d.isInfinite()) throw ProtocolError(Err.INVALID_ARGS, "$name must be a number")
    if (d < min || d > max) throw ProtocolError(Err.INVALID_ARGS, "$name out of range")
    return Math.round(d).toInt()
}
private fun optNum(o: JSONObject, key: String, def: Int, min: Int, max: Int): Int =
    if (!o.has(key) || o.isNull(key)) def else num(o.opt(key), key, min.toDouble(), max.toDouble())
private fun str(v: Any?, name: String, maxChars: Int): String {
    val s = v as? String ?: throw ProtocolError(Err.INVALID_ARGS, "$name must be a string")
    if (s.length > maxChars) throw ProtocolError(Err.TOO_LARGE, "$name too long")
    return s
}
private fun bool(o: JSONObject, key: String) = o.opt(key) == true
private fun coord(o: JSONObject, key: String) = num(o.opt(key), key, 0.0, 100_000.0)

/** Plain app names or package names: letters, digits, space and ._+'- (no paths, no URIs). */
private val APP_NAME = Regex("^[\\p{L}\\p{N} ._+'-]{1,100}$")

fun validateArgs(op: String, raw: Any?): Args {
    val a: JSONObject = when (raw) {
        null, JSONObject.NULL -> JSONObject()
        is JSONObject -> raw
        else -> throw ProtocolError(Err.INVALID_ARGS, "args must be an object")
    }
    return when (op) {
        "session.start" -> Args.SessionStart(if (a.has("reason")) cleanText(str(a.opt("reason"), "reason", 300), 300) else "")
        "session.end", "screen.info" -> Args.None
        "view.stop" -> Args.ViewStop(if (a.has("viewId")) str(a.opt("viewId"), "viewId", Proto.MAX_ID) else null)
        "screen.capture" -> {
            val format = if (a.has("format")) str(a.opt("format"), "format", 8) else "jpeg"
            if (format != "jpeg" && format != "png") throw ProtocolError(Err.INVALID_ARGS, "format must be jpeg or png")
            Args.Capture(format, optNum(a, "maxWidth", 1280, 64, Proto.MAX_CAPTURE_WIDTH), optNum(a, "quality", 70, 10, 95))
        }
        "screen.read" -> Args.Read(optNum(a, "maxNodes", 200, 1, Proto.MAX_NODES))
        "touch.tap" -> {
            val t = Args.Tap(coord(a, "x"), coord(a, "y"), bool(a, "long"), bool(a, "double"))
            if (t.long && t.double) throw ProtocolError(Err.INVALID_ARGS, "long and double cannot both be set")
            t
        }
        "touch.swipe" -> Args.Swipe(coord(a, "fromX"), coord(a, "fromY"), coord(a, "toX"), coord(a, "toY"), optNum(a, "durationMs", 300, 50, 3000), bool(a, "hold"))
        "keyboard.type" -> {
            val text = str(a.opt("text"), "text", Proto.MAX_TYPE_TEXT)
            if (text.isEmpty()) throw ProtocolError(Err.INVALID_ARGS, "text is empty")
            Args.Type(text)
        }
        "global.action" -> {
            val action = str(a.opt("action"), "action", 32).lowercase()
            if (action !in GLOBAL_ACTIONS) throw ProtocolError(Err.INVALID_ARGS, "action must be one of ${GLOBAL_ACTIONS.joinToString()}")
            Args.Global(action)
        }
        "app.open" -> {
            val name = str(a.opt("name"), "name", 100).trim()
            if (!APP_NAME.matches(name) || name.startsWith("-")) throw ProtocolError(Err.INVALID_ARGS, "invalid application name")
            Args.OpenApp(name)
        }
        "url.open" -> {
            val s = str(a.opt("url"), "url", 4096).trim()
            val scheme = try { URI(s).scheme?.lowercase() } catch (e: Exception) { null }
            if (scheme !in setOf("http", "https", "mailto")) throw ProtocolError(Err.INVALID_ARGS, "only http, https and mailto")
            Args.OpenUrl(s)
        }
        else -> throw ProtocolError(Err.UNKNOWN_OP, "unknown operation")
    }
}

/** "sklubot.example.com" → base and WebSocket URL. https only, except loopback (as normalizeServer in protocol.js). */
data class ServerAddress(val base: String, val wsUrl: String)

fun normalizeServer(input: String?): ServerAddress {
    var raw = (input ?: "").trim()
    if (raw.isEmpty()) throw ProtocolError("invalid_server", "empty")
    if (!Regex("^[a-z]+://", RegexOption.IGNORE_CASE).containsMatchIn(raw)) raw = "https://$raw"
    val u = try { URI(raw) } catch (e: Exception) { throw ProtocolError("invalid_server", "invalid address") }
    val scheme = u.scheme?.lowercase()
    val host = u.host ?: throw ProtocolError("invalid_server", "no host")
    val loopback = host in setOf("localhost", "127.0.0.1", "[::1]", "::1")
    if (scheme == "http" && !loopback) throw ProtocolError("insecure_server", "https required")
    if (scheme != "http" && scheme != "https") throw ProtocolError("invalid_server", "bad scheme")
    if (u.userInfo != null) throw ProtocolError("invalid_server", "credentials in URL")
    val authority = u.rawAuthority
    val path = (u.rawPath ?: "").trimEnd('/')
    return ServerAddress("$scheme://$authority$path", "${if (scheme == "https") "wss" else "ws"}://$authority$path${Proto.CONNECT_PATH}")
}

/** One node of the accessibility tree, as screen.read reports it (screen pixels). */
data class ScreenNode(val text: String, val desc: String, val id: String, val cls: String, val x: Int, val y: Int, val w: Int, val h: Int,
                      val clickable: Boolean, val editable: Boolean, val focused: Boolean, val checked: Boolean?) {
    fun toJson(): JSONObject = JSONObject().apply {
        if (text.isNotEmpty()) put("text", text)
        if (desc.isNotEmpty()) put("desc", desc)
        if (id.isNotEmpty()) put("id", id)
        if (cls.isNotEmpty()) put("class", cls)
        put("bounds", JSONArray(listOf(x, y, w, h)))
        if (clickable) put("click", true)
        if (editable) put("edit", true)
        if (focused) put("focused", true)
        if (checked != null) put("checked", checked)
    }
}
