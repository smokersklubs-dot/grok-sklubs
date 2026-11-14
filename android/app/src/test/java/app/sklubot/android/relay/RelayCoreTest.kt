package app.sklubot.android.relay

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/** The rules the server cannot override, enforced on the phone (protocol §7, §13). */
class RelayCoreTest {
    private val sent = CopyOnWriteArrayList<JSONObject>()
    private val logged = CopyOnWriteArrayList<JSONObject>()
    private val caps = FakeCaps()
    private val ui = FakeUi()
    private val store = FakeStore()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var promptTimeout = 60_000L
    private var idleMs = 15 * 60_000L
    private val core by lazy {
        RelayCore({ sent.add(it); true }, caps, ui, store, { logged.add(it) }, scheduler, "app.sklubot.android",
            gateOptions = ConsentGate.Options(promptTimeoutMs = promptTimeout), idleSessionMs = idleMs)
    }
    private var seq = 0
    private val alice = JSONObject().put("id", "bot_alice").put("name", "Alice")
    private val bob = JSONObject().put("id", "bot_bob").put("name", "Bob")

    @After fun tearDown() { scheduler.shutdownNow() }

    private fun req(op: String, args: JSONObject = JSONObject(), bot: JSONObject = alice): JSONObject {
        val id = "r${++seq}"
        core.handleRequest(JSONObject().put("type", "req").put("id", id).put("bot", bot).put("op", op).put("args", args))
        return sent.last { it.optString("type") == "res" && it.optString("id") == id }
    }
    private fun code(res: JSONObject) = res.optJSONObject("error")?.optString("code")
    private fun events(name: String) = sent.filter { it.optString("type") == "event" && it.optString("name") == name }

    @Test fun noCommandsOnAPhone() {
        val r = req("shell.run", JSONObject().put("command", "rm -rf /"))
        assertEquals(Err.UNKNOWN_OP, code(r))
        assertTrue(r.getJSONObject("error").getString("message").contains("not available on a phone"))
        assertFalse(CAPABILITIES.contains("shell.run"))
    }

    @Test fun everythingButSessionStartNeedsASession() {
        assertEquals(Err.NO_SESSION, code(req("touch.tap", JSONObject().put("x", 10).put("y", 10))))
        assertEquals(Err.NO_SESSION, code(req("screen.capture")))
        assertTrue(caps.calls.isEmpty())
    }

    @Test fun sessionAcceptedOnThePhoneThenActions() {
        val s = req("session.start", JSONObject().put("reason", "Vérifier la facture"))
        assertTrue(s.getBoolean("ok"))
        assertEquals("once", s.getJSONObject("result").getString("grant"))
        assertEquals(listOf("Alice: Vérifier la facture"), ui.asked)
        assertEquals(1, events("consent.requested").size)
        assertEquals("once", events("consent.decided")[0].getString("decision"))
        assertEquals(1, events("session.started").size)
        assertTrue(req("touch.tap", JSONObject().put("x", 540).put("y", 1200)).getBoolean("ok"))
        assertTrue(req("touch.swipe", JSONObject().put("fromX", 540).put("fromY", 1800).put("toX", 540).put("toY", 600)).getBoolean("ok"))
        assertTrue(req("global.action", JSONObject().put("action", "back")).getBoolean("ok"))
        assertEquals(listOf("tap 540,1200", "swipe 540,1800>540,600", "global back"), caps.calls)
        val cap = req("screen.capture", JSONObject().put("maxWidth", 720)).getJSONObject("result")
        assertEquals(1080, cap.getInt("screenWidth"))
        assertEquals("another bot is told the phone is busy", Err.BUSY, code(req("touch.tap", JSONObject().put("x", 1).put("y", 1), bob)))
        assertEquals(Err.BUSY, code(req("session.start", JSONObject(), bob)))
        // A second start by the same bot: already open, no new dialog.
        assertTrue(req("session.start").getJSONObject("result").getBoolean("already"))
        assertEquals(1, ui.asked.size)
        assertTrue(req("session.end").getBoolean("ok"))
        assertEquals("bot", events("session.ended")[0].getString("reason"))
    }

    @Test fun inputIsRefusedWhileTheDialogIsOpen() {
        // Bob has a session; Alice asks and the dialog stays open: Bob's taps wait (he could tap "Allow").
        store.always.add("bot_bob")
        assertTrue(req("session.start", JSONObject(), bob).getBoolean("ok"))
        req("session.end", JSONObject(), bob)
        store.always.clear()
        ui.decision = null
        val t = Thread { req("session.start") }
        t.start()
        waitUntil(what = "dialog open") { core.gate.pending != null }
        store.always.add("bot_bob")
        assertEquals(Err.CONSENT_PENDING, code(req("touch.tap", JSONObject().put("x", 1).put("y", 1), bob)))
        ui.pendingAnswer!!("refuse")
        t.join(5000)
    }

    @Test fun refusalCooldownAndExpiry() {
        ui.decision = "refuse"
        assertEquals(Err.CONSENT_REFUSED, code(req("session.start")))
        val again = req("session.start")
        assertEquals(Err.CONSENT_COOLDOWN, code(again))
        val wait = again.getJSONObject("error").getLong("retryAfterMs")
        assertTrue(wait in 59_000..60_000)
        assertEquals("no second dialog during the cooldown", 1, ui.asked.size)
    }

    @Test fun noAnswerInTimeIsARefusal() {
        promptTimeout = 200
        ui.decision = null
        assertEquals(Err.CONSENT_EXPIRED, code(req("session.start")))
        assertEquals(1, ui.cancelled.size)
        assertEquals("expired", events("consent.decided")[0].getString("decision"))
    }

    @Test fun alwaysForThisBotSkipsTheDialogNextTime() {
        ui.decision = "always"
        assertTrue(req("session.start").getBoolean("ok"))
        req("session.end")
        assertTrue("bot_alice" in store.always)
        val s = req("session.start")
        assertEquals("always", s.getJSONObject("result").getString("grant"))
        assertEquals(1, ui.asked.size)
    }

    @Test fun stopEndsTheSessionAndLocksUntilTheUserUnlocks() {
        req("session.start")
        core.stop("notification")
        assertTrue(store.lockedFlag)
        assertEquals("user_stop", events("session.ended").last().getString("reason"))
        assertEquals("notification", events("relay.locked")[0].getString("source"))
        assertEquals(Err.LOCKED, code(req("session.start")))
        assertEquals(Err.LOCKED, code(req("screen.info")))
        assertTrue("session.end still answers", req("session.end").getBoolean("ok"))
        core.unlock()
        assertFalse(store.lockedFlag)
        assertEquals(1, events("relay.unlocked").size)
        assertTrue(req("session.start").getBoolean("ok"))
    }

    @Test fun blockedAppsLockScreenAndSklubotItself() {
        req("session.start")
        store.blocked = setOf("com.bank.app")
        caps.front = listOf("com.bank.app")
        assertEquals(Err.BLOCKED_APP, code(req("screen.capture")))
        assertEquals(Err.BLOCKED_APP, code(req("screen.read")))
        assertEquals(Err.BLOCKED_APP, code(req("touch.tap", JSONObject().put("x", 1).put("y", 1))))
        assertEquals(Err.BLOCKED_APP, code(req("keyboard.type", JSONObject().put("text", "1234"))))
        assertEquals(Err.BLOCKED_APP, code(req("global.action", JSONObject().put("action", "enter"))))
        assertTrue("leaving the app is allowed", req("global.action", JSONObject().put("action", "home")).getBoolean("ok"))
        // A blocked app in split screen behind another app counts too.
        caps.front = listOf("com.example.notes", "com.bank.app")
        assertEquals(Err.BLOCKED_APP, code(req("screen.capture")))
        // A bot cannot open a blocked app, nor Sklubot itself.
        caps.front = listOf("com.example.notes")
        assertEquals(Err.BLOCKED_APP, code(req("app.open", JSONObject().put("name", "Ma Banque"))))
        assertEquals(Err.BLOCKED_APP, code(req("app.open", JSONObject().put("name", "app.sklubot.android"))))
        assertEquals(Err.UNSUPPORTED, code(req("app.open", JSONObject().put("name", "Nope"))))
        assertTrue(req("app.open", JSONObject().put("name", "notes")).getBoolean("ok"))
        // Sklubot in front: it may be looked at, never tapped (its approval cards are there).
        caps.front = listOf("app.sklubot.android")
        assertTrue(req("screen.capture").getBoolean("ok"))
        assertEquals(Err.BLOCKED_APP, code(req("touch.tap", JSONObject().put("x", 5).put("y", 5))))
        // The lock screen.
        caps.front = listOf("com.example.notes")
        caps.locked = true
        assertEquals(Err.SCREEN_LOCKED, code(req("screen.capture")))
        assertEquals(Err.SCREEN_LOCKED, code(req("touch.swipe", JSONObject().put("fromX", 1).put("fromY", 1).put("toX", 2).put("toY", 2))))
        assertEquals(listOf("global home", "launch com.example.notes", "capture 1280"), caps.calls)
        // The toggle off: nothing blocked any more (Sklubot itself still is).
        caps.locked = false
        store.blocked = emptySet()
        caps.front = listOf("com.bank.app")
        assertTrue(req("screen.capture").getBoolean("ok"))
    }

    @Test fun accessibilityServiceOff() {
        caps.ready = false
        assertEquals(Err.PERMISSION_MISSING, code(req("session.start")))
        assertTrue(ui.asked.isEmpty())
    }

    @Test fun argumentsAreChecked() {
        req("session.start")
        assertEquals(Err.INVALID_ARGS, code(req("url.open", JSONObject().put("url", "javascript:alert(1)"))))
        assertEquals(Err.INVALID_ARGS, code(req("url.open", JSONObject().put("url", "intent://x#Intent;end"))))
        assertEquals(Err.TOO_LARGE, code(req("keyboard.type", JSONObject().put("text", "x".repeat(2001)))))
        assertEquals(Err.INVALID_ARGS, code(req("global.action", JSONObject().put("action", "power_off"))))
        assertEquals(Err.INVALID_ARGS, code(req("touch.tap", JSONObject().put("x", "10").put("y", 1))))
        assertEquals(Err.INVALID_ARGS, code(req("app.open", JSONObject().put("name", "../../system"))))
        assertEquals(Err.INVALID_ARGS, code(req("touch.tap", JSONObject().put("x", 1).put("y", 1), JSONObject().put("id", "bad id!"))))
        assertTrue(req("url.open", JSONObject().put("url", "https://example.com/a?b=c")).getBoolean("ok"))
    }

    @Test fun rateLimited() {
        val codes = (1..70).map { code(req("screen.info")) }
        assertTrue(codes.take(60).all { it == null })
        assertTrue(codes.drop(60).any { it == Err.RATE_LIMITED })
    }

    @Test fun theLogKeepsActionsNeverScreenshots() {
        req("session.start")
        req("screen.capture")
        req("keyboard.type", JSONObject().put("text", "bonjour"))
        val all = logged.joinToString("\n")
        assertFalse(all.contains("QUJDRA=="))
        assertTrue(all.contains("\"op\":\"keyboard.type\""))
        assertTrue(logged.any { it.optString("kind") == "session.started" })
    }

    @Test fun idleSessionEnds() {
        idleMs = 150
        req("session.start")
        waitUntil(what = "idle end") { events("session.ended").isNotEmpty() }
        assertEquals("idle", events("session.ended")[0].getString("reason"))
        assertEquals(Err.NO_SESSION, code(req("screen.capture")))
    }

    @Test fun disconnectEndsTheSession() {
        req("session.start")
        core.onDisconnected()
        assertEquals("disconnected", events("session.ended")[0].getString("reason"))
        assertEquals(null, core.session)
    }
}
