package app.sklubot.android.relay

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** What the phone can do (the accessibility service). Every call may throw ProtocolError. */
interface PhoneCaps {
    /** The accessibility service is enabled and connected. */
    fun ready(): Boolean
    fun screenInfo(): JSONObject
    fun capture(a: Args.Capture): Capture
    fun read(a: Args.Read): JSONObject
    fun tap(a: Args.Tap)
    fun swipe(a: Args.Swipe)
    /** Returns { typed, method: "set_text" | "paste" }. */
    fun type(text: String): JSONObject
    fun global(action: String)
    /** The package of an installed app with a launcher entry, by package name or label; null if none. */
    fun resolveApp(name: String): String?
    fun launch(pkg: String): JSONObject
    fun openUrl(url: String)
    /** Packages of the application windows on screen now, front first (empty if unknown). */
    fun foregroundPackages(): List<String>
    fun screenLocked(): Boolean
}

data class Capture(val format: String, val width: Int, val height: Int, val screenWidth: Int, val screenHeight: Int, val base64: String)

data class Session(val botId: String, val botName: String, val grant: String, val startedAt: Long, var lastActivity: Long, val sessionId: String)

/** The phone's own screens (consent dialog, relay settings): what the user sees of the relay. */
interface ConsentUi {
    /** Shows the dialog on the phone; `answer` is called once with "once", "always" or "refuse". */
    fun askSession(promptId: String, bot: Bot, reason: String, timeoutMs: Long, answer: (String) -> Unit)
    fun cancelPrompt(promptId: String)
    fun onSession(session: Session?)
    fun onLocked(locked: Boolean)
}

/** Settings only the user changes, on the phone. The server has no operation that reaches them (protocol §10). */
interface PermStore {
    fun alwaysAllowed(botId: String): Boolean
    fun setAlwaysAllowed(bot: Bot)
    fun isLocked(): Boolean
    fun setLocked(v: Boolean)
    /** The apps the user blocked (empty when the toggle is off). */
    fun blockedPackages(): Set<String>
}

/**
 * The phone relay once it is authenticated: the rules the server cannot override, ported from the desktop relay
 * (companion/src/main/relay-core.js):
 *  - a control session is accepted on the phone (once / always for this bot / refuse), 60 s without answer = refusal;
 *  - consent dialogs are rate limited (ConsentGate); input is refused while a dialog is open;
 *  - Stop (notification, banner, quick-settings tile) ends the session and locks until the user re-allows in the app;
 *  - nothing on the lock screen, nothing on the apps the user blocked; no tapping or typing in Sklubot itself (a bot
 *    could otherwise approve its own requests in the web app);
 *  - every action is written to the local log (never a screenshot);
 *  - no commands at all: `shell.run` is an unknown operation here.
 * Transport, screens and storage are injected: the JVM unit tests drive it with fakes.
 */
class RelayCore(
    private val send: (JSONObject) -> Boolean,
    private val caps: PhoneCaps,
    private val ui: ConsentUi,
    private val store: PermStore,
    private val log: (JSONObject) -> Unit,
    private val scheduler: ScheduledExecutorService,
    private val ownPackage: String,
    private val now: () -> Long = System::currentTimeMillis,
    gateOptions: ConsentGate.Options = ConsentGate.Options(),
    private val idleSessionMs: Long = 15 * 60_000,
) {
    val gate = ConsentGate(now, gateOptions)
    private val bucket = TokenBucket(60.0, 30.0, now)
    private val lock = Any()
    @Volatile var session: Session? = null
        private set
    private var idleTimer: ScheduledFuture<*>? = null
    private var sessionSeq = 0
    @Volatile private var pendingPromptId: String? = null

    val locked get() = store.isLocked()

    // ── outbound ──
    private fun ok(id: String, result: JSONObject = JSONObject()) { send(JSONObject().put("type", "res").put("id", id).put("ok", true).put("result", result)) }
    private fun fail(id: String, code: String, message: String = code, retryAfterMs: Long? = null) {
        val e = JSONObject().put("code", code).put("message", message.take(500))
        if (retryAfterMs != null) e.put("retryAfterMs", retryAfterMs)
        send(JSONObject().put("type", "res").put("id", id).put("ok", false).put("error", e))
    }
    fun event(name: String, data: JSONObject = JSONObject()) {
        data.put("type", "event").put("name", name).put("ts", isoTime(now()))
        send(data)
    }
    private fun botJson(b: Bot) = JSONObject().put("id", b.id).put("name", b.name)
    private fun entry(kind: String, bot: Bot? = null) = JSONObject().put("kind", kind).also { if (bot != null) it.put("bot", botJson(bot)) }

    /** A `req` from the server. Runs on a worker thread (it may wait up to 60 s for the user). */
    fun handleRequest(msg: JSONObject) {
        val id = (msg.opt("id") as? String)?.takeIf { it.isNotEmpty() && it.length <= Proto.MAX_ID } ?: return
        if (!bucket.take()) return fail(id, Err.RATE_LIMITED, "too many requests")
        val bot = try { parseBot(msg.opt("bot")) } catch (e: ProtocolError) { return fail(id, Err.INVALID_ARGS, e.message ?: "") }
        val op = msg.opt("op") as? String ?: ""
        val spec = OPS[op]
        if (spec == null) {
            log(entry("refused", bot).put("op", op.take(40)).put("why", Err.UNKNOWN_OP))
            return fail(id, Err.UNKNOWN_OP, if (op == "shell.run") "commands are not available on a phone" else "unknown operation")
        }
        val args = try { validateArgs(op, msg.opt("args")) } catch (e: ProtocolError) { return fail(id, e.code, e.message ?: e.code) }

        if (locked && op != "session.end" && op != "view.stop") {
            log(entry("refused", bot).put("op", op).put("why", Err.LOCKED))
            return fail(id, Err.LOCKED, "the user stopped remote control on this phone")
        }
        if (spec.input && gate.pending != null) {
            log(entry("refused", bot).put("op", op).put("why", Err.CONSENT_PENDING))
            return fail(id, Err.CONSENT_PENDING, "input is paused while a consent dialog is open")
        }
        if (spec.session) {
            val s = session ?: return fail(id, Err.NO_SESSION, "start a control session first")
            if (s.botId != bot.id) return fail(id, Err.BUSY, "another bot has the control session")
            touch()
        }
        if ((spec.screen || op == "session.start" || op == "global.action") && !caps.ready()) {
            return fail(id, Err.PERMISSION_MISSING, "the Sklubot accessibility service is off on this phone")
        }
        screenGuard(op, args)?.let { why ->
            log(entry("refused", bot).put("op", op).put("why", why))
            return fail(id, why, if (why == Err.SCREEN_LOCKED) "the phone is locked" else "the app on screen is blocked on this phone")
        }

        log(entry("request", bot).put("op", op).put("args", summarize(args)))
        try {
            when (args) {
                is Args.SessionStart -> startSession(id, bot, args.reason)
                is Args.ViewStop -> ok(id)
                is Args.None -> if (op == "session.end") {
                    synchronized(lock) { if (session?.botId == bot.id) endSession("bot") }
                    ok(id)
                } else ok(id, caps.screenInfo())
                is Args.Capture -> {
                    val c = caps.capture(args)
                    ok(id, JSONObject().put("format", c.format).put("width", c.width).put("height", c.height)
                        .put("screenWidth", c.screenWidth).put("screenHeight", c.screenHeight).put("data", c.base64))
                }
                is Args.Read -> ok(id, caps.read(args))
                is Args.Tap -> { caps.tap(args); ok(id) }
                is Args.Swipe -> { caps.swipe(args); ok(id) }
                is Args.Type -> ok(id, caps.type(args.text))
                is Args.Global -> { caps.global(args.action); ok(id) }
                is Args.OpenUrl -> { caps.openUrl(args.url); ok(id) }
                is Args.OpenApp -> {
                    val pkg = caps.resolveApp(args.name) ?: return fail(id, Err.UNSUPPORTED, "no app called ${args.name} on this phone")
                    if (pkg == ownPackage || pkg in store.blockedPackages()) {
                        log(entry("refused", bot).put("op", op).put("why", Err.BLOCKED_APP))
                        return fail(id, Err.BLOCKED_APP, "that app is blocked on this phone")
                    }
                    ok(id, caps.launch(pkg))
                }
            }
        } catch (e: ProtocolError) {
            log(entry("error", bot).put("op", op).put("error", e.message ?: e.code))
            fail(id, if (e.code in Err.ALL) e.code else Err.INTERNAL, e.message ?: e.code)
        } catch (e: Exception) {
            log(entry("error", bot).put("op", op).put("error", e.toString().take(300)))
            fail(id, Err.INTERNAL, e.toString())
        }
    }

    /** The lock screen, the apps the user blocked, and typing in Sklubot itself: decided here, on the phone. */
    private fun screenGuard(op: String, args: Args): String? {
        val touches = op == "touch.tap" || op == "touch.swipe" || op == "keyboard.type" || (args is Args.Global && args.action == "enter")
        val sees = op == "screen.capture" || op == "screen.read"
        if (!touches && !sees) return null
        if (caps.screenLocked()) return Err.SCREEN_LOCKED
        val front = caps.foregroundPackages()
        val blocked = store.blockedPackages()
        if (front.any { it in blocked }) return Err.BLOCKED_APP
        if (touches && front.any { it == ownPackage }) return Err.BLOCKED_APP
        return null
    }

    // ── sessions ──
    private fun startSession(id: String, bot: Bot, reason: String) {
        synchronized(lock) {
            val s = session
            if (s != null) {
                return if (s.botId == bot.id) ok(id, JSONObject().put("sessionId", s.sessionId).put("grant", s.grant).put("already", true))
                else fail(id, Err.BUSY, "another bot has the control session")
            }
        }
        val grant: String
        if (store.alwaysAllowed(bot.id)) {
            grant = "always"
        } else {
            val blocked = gate.check(bot.id)
            if (blocked != null) {
                log(entry("prompt.blocked", bot).put("why", blocked))
                return fail(id, blocked, "a consent dialog cannot be shown right now", if (blocked == Err.CONSENT_COOLDOWN) gate.cooldownLeft(bot.id) else null)
            }
            val decision = prompt(bot, reason)
            when (decision) {
                "refuse" -> return fail(id, Err.CONSENT_REFUSED, "the user refused the control session")
                "expired" -> return fail(id, Err.CONSENT_EXPIRED, "nobody answered on the phone")
                "always" -> store.setAlwaysAllowed(bot)
            }
            grant = if (decision == "always") "always" else "once"
        }
        synchronized(lock) {
            // Stop may have been pressed, or another bot may have won, while the dialog was open.
            if (locked) return fail(id, Err.LOCKED, "the user stopped remote control on this phone")
            if (session != null) return fail(id, Err.BUSY, "another bot has the control session")
            val t = now()
            val s = Session(bot.id, bot.name, grant, t, t, "s${t.toString(36)}${++sessionSeq}")
            session = s
            touch()
            ui.onSession(s)
            log(entry("session.started", bot).put("grant", grant))
            event("session.started", JSONObject().put("bot", botJson(bot)).put("grant", grant).put("sessionId", s.sessionId))
            ok(id, JSONObject().put("sessionId", s.sessionId).put("grant", grant))
        }
    }

    /** One dialog through the gate (already checked). Returns once, always, refuse or expired. */
    private fun prompt(bot: Bot, reason: String): String {
        val p = gate.open(bot.id, "session")
        pendingPromptId = p.id
        event("consent.requested", JSONObject().put("bot", botJson(bot)).put("kind", "session"))
        val answer = CompletableFuture<String>()
        try { ui.askSession(p.id, bot, reason, gate.promptTimeoutMs) { answer.complete(it) } } catch (e: Exception) { answer.complete("expired") }
        var decision = try { answer.get(gate.promptTimeoutMs, TimeUnit.MILLISECONDS) } catch (e: TimeoutException) { "expired" } catch (e: Exception) { "expired" }
        if (decision !in setOf("once", "always", "refuse")) decision = "expired"
        if (decision == "expired") ui.cancelPrompt(p.id)
        gate.close(decision == "refuse" || decision == "expired")
        pendingPromptId = null
        log(entry("consent", bot).put("prompt", "session").put("decision", decision))
        event("consent.decided", JSONObject().put("bot", botJson(bot)).put("kind", "session").put("decision", decision))
        return decision
    }

    private fun touch() {
        val s = session ?: return
        s.lastActivity = now()
        idleTimer?.cancel(false)
        idleTimer = scheduler.schedule({ synchronized(lock) { if (session === s) endSession("idle") } }, idleSessionMs, TimeUnit.MILLISECONDS)
    }

    /** Ends the session (call with `lock` held or from a single thread). */
    private fun endSession(reason: String) {
        idleTimer?.cancel(false)
        idleTimer = null
        val s = session ?: return
        session = null
        ui.onSession(null)
        log(entry("session.ended", Bot(s.botId, s.botName)).put("reason", reason))
        event("session.ended", JSONObject().put("bot", botJson(Bot(s.botId, s.botName))).put("reason", reason).put("sessionId", s.sessionId))
    }

    /** The user pressed Stop (notification, banner or tile): ends everything and locks. */
    fun stop(source: String) {
        pendingPromptId?.let { ui.cancelPrompt(it) }
        synchronized(lock) { endSession("user_stop") }
        if (!locked) {
            store.setLocked(true)
            ui.onLocked(true)
            log(entry("locked").put("source", source))
            event("relay.locked", JSONObject().put("source", source))
        }
    }

    /** Only from the app's own screen. */
    fun unlock() {
        if (!locked) return
        store.setLocked(false)
        ui.onLocked(false)
        log(entry("unlocked"))
        event("relay.unlocked")
    }

    /** Connection lost or relay turned off: nothing continues unattended. */
    fun onDisconnected(reason: String = "disconnected") {
        pendingPromptId?.let { ui.cancelPrompt(it) }
        synchronized(lock) { endSession(reason) }
    }

    fun stateEvent() = event("relay.state", JSONObject().put("locked", locked).put("session", session?.let { JSONObject().put("botId", it.botId).put("botName", it.botName) } ?: JSONObject.NULL))

    /** What goes into the local log: never image data, typed text shortened. */
    private fun summarize(a: Args): JSONObject = when (a) {
        is Args.Type -> JSONObject().put("text", if (a.text.length > 200) a.text.take(200) + "…" else a.text).put("length", a.text.length)
        is Args.Tap -> JSONObject().put("x", a.x).put("y", a.y).put("long", a.long).put("double", a.double)
        is Args.Swipe -> JSONObject().put("fromX", a.fromX).put("fromY", a.fromY).put("toX", a.toX).put("toY", a.toY).put("hold", a.hold)
        is Args.Global -> JSONObject().put("action", a.action)
        is Args.OpenApp -> JSONObject().put("name", a.name)
        is Args.OpenUrl -> JSONObject().put("url", a.url.take(300))
        is Args.SessionStart -> JSONObject().put("reason", a.reason)
        else -> JSONObject()
    }
}

/** ISO-8601 in UTC with milliseconds (java.time needs API 26; this app starts at 24). */
fun isoTime(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))
