package app.sklubot.android.relay

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/** Protocol message handling (§3–§5, §9) with a fake WebSocket. */
class RelayConnectionTest {
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val workers = Executors.newFixedThreadPool(2)
    private val sockets = CopyOnWriteArrayList<FakeSocket>()
    private val statuses = CopyOnWriteArrayList<RelayStatus>()
    private val auth = FakeAuth()
    private val caps = FakeCaps()
    private val conn = RelayConnection("wss://sklubot.example/api/relay/connect",
        { JSONObject().put("device", JSONObject().put("name", "Pixel").put("platform", "android").put("kind", "phone")).put("capabilities", org.json.JSONArray(CAPABILITIES)) },
        auth, SocketFactory { url, l -> FakeSocket(url, l).also { sockets.add(it) } }, scheduler, workers, {}, { statuses.add(it) }, rand = { 0.0 })
    init {
        conn.core = RelayCore(conn::send, caps, FakeUi(), FakeStore(), {}, scheduler, "app.sklubot.android")
    }

    @After fun tearDown() { conn.stop(); scheduler.shutdownNow(); workers.shutdownNow() }

    private fun open(): FakeSocket { conn.start(); val s = sockets.last(); s.listener.onOpen(); return s }
    private fun msg(type: String) = JSONObject().put("type", type)

    @Test fun pairingThenWelcome() {
        val s = open()
        val hello = s.sent[0]
        assertEquals("hello", hello.getString("type"))
        assertEquals(1, hello.getInt("v"))
        assertTrue(hello.isNull("auth"))
        assertEquals("phone", hello.getJSONObject("device").getString("kind"))
        s.server(msg("pair.code").put("code", "K7QM-2XPA").put("expiresAt", "2026-11-14T10:10:00.000Z"))
        assertEquals(RelayStatus.Pairing("K7QM-2XPA", "2026-11-14T10:10:00.000Z"), conn.status)
        // A request before welcome is ignored.
        s.server(msg("req").put("id", "r1").put("bot", JSONObject().put("id", "b").put("name", "B")).put("op", "screen.info"))
        Thread.sleep(50)
        assertEquals(1, s.sent.size)
        val token = "q8V" + "a".repeat(40)
        s.server(msg("paired").put("deviceId", "dev_123").put("token", token).put("serverName", "Sklubot de Léa"))
        assertEquals("dev_123" to token, auth.value)
        assertEquals(JSONObject().put("type", "token.ack").put("deviceId", "dev_123").toString(), s.sent[1].toString())
        s.server(msg("welcome").put("v", 1).put("deviceId", "dev_123").put("serverName", "Sklubot de Léa"))
        assertEquals(RelayStatus.Online("Sklubot de Léa"), conn.status)
        val state = s.sent[2]
        assertEquals("relay.state", state.getString("name"))
        assertFalse(state.getBoolean("locked"))
        // Now requests are answered.
        s.server(msg("req").put("id", "r2").put("bot", JSONObject().put("id", "b").put("name", "B")).put("op", "screen.info"))
        waitUntil { s.sent.any { it.optString("id") == "r2" } }
        assertEquals(1080, s.sent.first { it.optString("id") == "r2" }.getJSONObject("result").getInt("width"))
    }

    @Test fun knownDeviceRotationAndRevoke() {
        auth.value = "dev_1" to "t".repeat(43)
        val s = open()
        assertEquals("dev_1", s.sent[0].getJSONObject("auth").getString("deviceId"))
        s.server(msg("pair.code").put("code", "AAAA-BBBB"))
        assertFalse("a paired phone ignores pairing codes", conn.status is RelayStatus.Pairing)
        s.server(msg("welcome").put("v", 1))
        val next = "n".repeat(43)
        s.server(msg("token.rotate").put("token", next))
        assertEquals("dev_1" to next, auth.value)
        assertEquals("token.ack", s.sent.last().getString("type"))
        s.server(msg("token.rotate").put("token", "short"))
        assertEquals(Close.PROTOCOL_ERROR, s.closed!!.first)
    }

    @Test fun revokeClearsTheTokenAndStops() {
        auth.value = "dev_1" to "t".repeat(43)
        val s = open()
        s.server(msg("welcome").put("v", 1))
        s.server(msg("revoke"))
        assertNull(auth.value)
        assertEquals(RelayStatus.Unauthorized(revoked = true), conn.status)
        Thread.sleep(100)
        assertEquals("no reconnection", 1, sockets.size)
    }

    @Test fun closeCodes() {
        auth.value = "dev_1" to "t".repeat(43)
        var s = open()
        s.listener.onClosed(4001, "unauthorized")
        assertEquals(RelayStatus.Unauthorized(revoked = false), conn.status)
        assertTrue("4001 keeps the token for a new pairing decision by the user", auth.value != null)
        Thread.sleep(100)
        assertEquals(1, sockets.size)

        s = open()
        s.listener.onClosed(4003, "revoked")
        assertNull(auth.value)

        auth.value = "dev_1" to "t".repeat(43)
        s = open()
        s.listener.onClosed(4010, "replaced")
        assertEquals(RelayStatus.Replaced, conn.status)

        s = open()
        s.listener.onFailure("connection reset")
        assertTrue(conn.status is RelayStatus.Waiting)
        waitUntil(what = "reconnect after backoff") { sockets.size == 5 }
    }

    @Test fun malformedAndOversizedMessages() {
        var s = open()
        s.listener.onBinary()
        assertEquals(Close.PROTOCOL_ERROR, s.closed!!.first)
        s = open(); s.listener.onText("{not json"); assertEquals(Close.PROTOCOL_ERROR, s.closed!!.first)
        s = open(); s.listener.onText("{\"no\":1}"); assertEquals(Close.PROTOCOL_ERROR, s.closed!!.first)
        s = open(); s.listener.onText("{\"type\":\"x\",\"pad\":\"${"x".repeat(Proto.MAX_INBOUND_BYTES)}\"}"); assertEquals(Close.TOO_BIG, s.closed!!.first)
        s = open(); repeat(205) { s.listener.onText("{\"type\":\"whatever\"}") }; assertEquals(Close.TOO_MANY_MESSAGES, s.closed!!.first)
        s = open(); s.server(msg("pair.code").put("code", "<script>")); assertEquals(Close.PROTOCOL_ERROR, s.closed!!.first)
    }

    @Test fun stopSaysByeAndDoesNotReconnect() {
        auth.value = "dev_1" to "t".repeat(43)
        val s = open()
        s.server(msg("welcome").put("v", 1))
        conn.stop()
        assertEquals("bye", s.sent.last().getString("type"))
        assertEquals(Close.NORMAL, s.closed!!.first)
        assertEquals(RelayStatus.Idle, conn.status)
    }

    @Test fun backoff() {
        assertEquals(700L, backoffDelay(0) { 0.0 })
        assertEquals(1300L, backoffDelay(0) { 1.0 })
        assertEquals(2800L, backoffDelay(2) { 0.0 })
        assertEquals(78_000L, backoffDelay(30) { 1.0 })
    }

    @Test fun serverAddress() {
        assertEquals(ServerAddress("https://sklubot.example.com", "wss://sklubot.example.com/api/relay/connect"), normalizeServer("sklubot.example.com/"))
        assertEquals("ws://127.0.0.1:8080/api/relay/connect", normalizeServer("http://127.0.0.1:8080").wsUrl)
        assertEquals("insecure_server", runCatching { normalizeServer("http://192.168.1.10") }.exceptionOrNull().let { (it as ProtocolError).code })
        assertEquals("invalid_server", runCatching { normalizeServer("https://user:pw@x.com") }.exceptionOrNull().let { (it as ProtocolError).code })
    }
}
