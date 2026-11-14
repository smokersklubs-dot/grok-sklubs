package app.sklubot.android.relay

import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToLong

/** A WebSocket, as the connection needs it (OkHttp in the app, a fake in the tests). */
interface RelaySocket {
    fun send(text: String): Boolean
    fun close(code: Int, reason: String)
    fun cancel()
}

interface SocketListener {
    fun onOpen()
    fun onText(text: String)
    fun onBinary()
    fun onClosed(code: Int, reason: String)
    fun onFailure(error: String)
}

fun interface SocketFactory {
    fun open(url: String, listener: SocketListener): RelaySocket
}

/** The device token, kept encrypted with the Android Keystore in the app (TokenStore.kt). */
interface AuthStore {
    fun get(): Pair<String, String>?
    fun save(deviceId: String, token: String, serverName: String)
    fun clear()
}

sealed class RelayStatus {
    object Idle : RelayStatus()
    object Connecting : RelayStatus()
    data class Pairing(val code: String, val expiresAt: String?) : RelayStatus()
    data class Online(val serverName: String) : RelayStatus()
    data class Waiting(val seconds: Long, val detail: String) : RelayStatus()
    /** The server no longer knows this phone (4001) or removed it (4003): pair again. */
    data class Unauthorized(val revoked: Boolean) : RelayStatus()
    object Outdated : RelayStatus()
    object Replaced : RelayStatus()
}

/** 1 s, 2 s, 4 s… capped at 60 s, ±30 % jitter (protocol §9, connection.js). */
fun backoffDelay(attempt: Int, rand: () -> Double = Math::random): Long {
    val base = min(60_000.0, 1000.0 * Math.pow(2.0, maxOf(0, attempt).toDouble()))
    return (base * (0.7 + rand() * 0.6)).roundToLong()
}

private val TOKEN_RE = Regex("^[A-Za-z0-9._~-]{16,512}$")
private val DEVICE_ID_RE = Regex("^[A-Za-z0-9_.:-]{1,64}$")
private val PAIR_CODE_RE = Regex("^[A-Z0-9-]{4,16}$")

/**
 * The outbound connection to `${SERVER}/api/relay/connect` (protocol §3–§5, §9), the phone's counterpart of
 * companion/src/main/connection.js: hello, pairing, device token and its rotation, revocation, flood and size limits,
 * reconnection with backoff. Requests go to RelayCore on worker threads. Nothing is sent before `welcome`.
 * WebSocket pings (every 25 s, a missing pong closes the socket) are done by OkHttp's pingInterval (OkHttpSockets.kt).
 */
class RelayConnection(
    private val wsUrl: String,
    private val hello: () -> JSONObject,
    private val auth: AuthStore,
    private val sockets: SocketFactory,
    private val scheduler: ScheduledExecutorService,
    private val workers: ExecutorService,
    private val log: (JSONObject) -> Unit,
    private val onStatus: (RelayStatus) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    private val rand: () -> Double = Math::random,
) {
    lateinit var core: RelayCore
    @Volatile var status: RelayStatus = RelayStatus.Idle
        private set
    private var socket: RelaySocket? = null
    /** Each socket gets a generation: callbacks of an older socket are ignored. */
    private var generation = 0
    @Volatile private var authenticated = false
    @Volatile private var wanted = false
    private var pairing = false
    private var attempt = 0
    private var reconnectTimer: ScheduledFuture<*>? = null
    private var stableTimer: ScheduledFuture<*>? = null
    private var floodWindow = 0L
    private var floodCount = 0
    private val lock = Any()

    private fun setStatus(s: RelayStatus) { status = s; onStatus(s) }

    fun start() = synchronized(lock) {
        wanted = true
        attempt = 0
        connect()
    }

    /** The user turned the relay off: last words, then the socket is closed and nothing reconnects. */
    fun stop(reason: String = "stopped") {
        synchronized(lock) {
            if (::core.isInitialized) core.onDisconnected(reason)
            socket?.send(JSONObject().put("type", "bye").put("reason", reason).toString())
            wanted = false
            clearTimers()
            closeSocket(Close.NORMAL, "bye")
        }
        setStatus(RelayStatus.Idle)
    }

    /** Used by RelayCore: only once authenticated. */
    fun send(msg: JSONObject): Boolean {
        if (!authenticated || !wanted) return false
        return sendRaw(msg)
    }

    private fun sendRaw(msg: JSONObject): Boolean {
        val s = msg.toString()
        if (s.length > Proto.MAX_OUTBOUND_BYTES) return false // chars ≥ bytes / 4; the caps keep captures far below
        return socket?.send(s) ?: false
    }

    private fun clearTimers() {
        reconnectTimer?.cancel(false); stableTimer?.cancel(false)
        reconnectTimer = null; stableTimer = null
    }

    private fun closeSocket(code: Int, reason: String) {
        val s = socket ?: return
        socket = null
        authenticated = false
        generation++
        try { s.close(code, reason) } catch (_: Exception) { }
    }

    private fun connect() {
        if (!wanted) return
        clearTimers()
        closeSocket(Close.NORMAL, "reconnect")
        setStatus(RelayStatus.Connecting)
        pairing = false
        floodCount = 0
        val gen = ++generation
        socket = sockets.open(wsUrl, object : SocketListener {
            override fun onOpen() = synchronized(lock) { if (gen == generation) sendHello() }
            override fun onText(text: String) { if (gen == generation) onMessage(text) }
            override fun onBinary() { if (gen == generation) protocolError("binary messages are not used by protocol v1") }
            override fun onClosed(code: Int, reason: String) { if (gen == generation) onClose(code, reason) }
            override fun onFailure(error: String) {
                if (gen != generation) return
                log(JSONObject().put("kind", "conn.error").put("error", error.take(200)))
                onClose(1006, error)
            }
        })
    }

    private fun sendHello() {
        val a = auth.get()
        val h = hello().put("type", "hello").put("v", Proto.VERSION)
            .put("auth", if (a != null) JSONObject().put("deviceId", a.first).put("token", a.second) else JSONObject.NULL)
        sendRaw(h)
    }

    /** Called on OkHttp's reader thread. */
    fun onMessage(text: String) {
        val t = clock()
        if (t - floodWindow > 1000) { floodWindow = t; floodCount = 0 }
        if (++floodCount > 200) {
            log(JSONObject().put("kind", "conn.flood"))
            return synchronized(lock) { socket?.close(Close.TOO_MANY_MESSAGES, "too many messages"); Unit }
        }
        // OkHttp has no inbound size limit: §2 is enforced here (a char is at least one UTF-8 byte).
        if (text.length > Proto.MAX_INBOUND_BYTES || text.toByteArray(Charsets.UTF_8).size > Proto.MAX_INBOUND_BYTES) {
            return synchronized(lock) { socket?.close(Close.TOO_BIG, "message too big"); Unit }
        }
        val msg = try { JSONObject(text) } catch (e: Exception) { return protocolError("invalid JSON") }
        val type = msg.opt("type") as? String ?: return protocolError("missing type")
        dispatch(type, msg)
    }

    private fun protocolError(why: String) {
        log(JSONObject().put("kind", "conn.protocol_error").put("why", why))
        synchronized(lock) { socket?.close(Close.PROTOCOL_ERROR, why.take(100)) }
    }

    private fun dispatch(type: String, msg: JSONObject) {
        when (type) {
            "pair.code" -> {
                if (authenticated || auth.get() != null) return
                val code = msg.opt("code") as? String
                if (code == null || !PAIR_CODE_RE.matches(code)) return protocolError("bad pairing code")
                pairing = true
                setStatus(RelayStatus.Pairing(code, msg.opt("expiresAt") as? String))
            }
            "paired" -> {
                if (authenticated || !pairing) return
                val token = msg.opt("token") as? String
                val deviceId = msg.opt("deviceId") as? String
                if (token == null || !TOKEN_RE.matches(token)) return protocolError("bad token")
                if (deviceId == null || !DEVICE_ID_RE.matches(deviceId)) return protocolError("bad deviceId")
                // Saved before the acknowledgement: if the ack is lost, the server still accepts this token (§4).
                auth.save(deviceId, token, (msg.opt("serverName") as? String ?: "").take(80))
                pairing = false
                sendRaw(JSONObject().put("type", "token.ack").put("deviceId", deviceId))
            }
            "welcome" -> {
                if (msg.opt("v") != Proto.VERSION) return synchronized(lock) { socket?.close(Close.VERSION_UNSUPPORTED, "version"); Unit }
                if (auth.get() == null) return protocolError("welcome before pairing")
                authenticated = true
                setStatus(RelayStatus.Online((msg.opt("serverName") as? String ?: "").take(80)))
                synchronized(lock) { stableTimer = scheduler.schedule({ synchronized(lock) { attempt = 0 } }, 30, TimeUnit.SECONDS) }
                core.stateEvent()
            }
            "token.rotate" -> {
                if (!authenticated) return
                val token = msg.opt("token") as? String
                if (token == null || !TOKEN_RE.matches(token)) return protocolError("bad token")
                val a = auth.get() ?: return
                auth.save(a.first, token, (status as? RelayStatus.Online)?.serverName ?: "")
                sendRaw(JSONObject().put("type", "token.ack").put("deviceId", a.first))
            }
            "revoke" -> {
                auth.clear()
                synchronized(lock) { wanted = false; closeSocket(Close.NORMAL, "revoked") }
                core.onDisconnected()
                setStatus(RelayStatus.Unauthorized(revoked = true))
            }
            "req" -> if (authenticated) workers.execute { core.handleRequest(msg) }
            "cancel", "view.ack" -> Unit // nothing on a phone is cancellable, and there is no live view
            "error" -> log(JSONObject().put("kind", "server.error").put("code", (msg.opt("code") as? String ?: "").take(40)))
            else -> log(JSONObject().put("kind", "conn.unknown_type").put("type", type.take(40)))
        }
    }

    private fun onClose(code: Int, reason: String) {
        val next: RelayStatus?
        synchronized(lock) {
            socket = null
            authenticated = false
            pairing = false
            generation++
            stableTimer?.cancel(false); stableTimer = null
            if (::core.isInitialized) core.onDisconnected()
            log(JSONObject().put("kind", "conn.closed").put("code", code).put("reason", reason.take(100)))
            if (!wanted) return
            next = when (code) {
                Close.UNAUTHORIZED -> { wanted = false; RelayStatus.Unauthorized(revoked = false) }
                Close.REVOKED -> { auth.clear(); wanted = false; RelayStatus.Unauthorized(revoked = true) }
                Close.VERSION_UNSUPPORTED -> { wanted = false; RelayStatus.Outdated }
                Close.REPLACED -> { wanted = false; RelayStatus.Replaced }
                else -> {
                    val delay = backoffDelay(attempt++, rand)
                    reconnectTimer = scheduler.schedule({ synchronized(lock) { connect() } }, delay, TimeUnit.MILLISECONDS)
                    RelayStatus.Waiting((delay + 500) / 1000, reason.take(80))
                }
            }
        }
        next?.let { setStatus(it) }
    }
}
