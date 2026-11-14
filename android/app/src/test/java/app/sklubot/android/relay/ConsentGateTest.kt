package app.sklubot.android.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same consent rules as the desktop relay (companion/src/main/consent.js, protocol §7). */
class ConsentGateTest {
    private var t = 1_000_000L
    private val gate = ConsentGate({ t })

    @Test fun oneDialogAtATime() {
        assertNull(gate.check("a"))
        gate.open("a", "session")
        assertEquals(Err.CONSENT_PENDING, gate.check("b"))
        gate.close(refused = false)
        assertNull(gate.check("b"))
    }

    @Test fun refusalMeansOneMinuteCooldownThenTenAfterThree() {
        gate.open("a", "session"); gate.close(refused = true)
        assertEquals(Err.CONSENT_COOLDOWN, gate.check("a"))
        assertEquals(60_000L, gate.cooldownLeft("a"))
        assertNull("another bot is not held back", gate.check("b"))
        t += 60_001
        assertNull(gate.check("a"))
        gate.open("a", "session"); gate.close(refused = true)
        t += 60_001
        gate.open("a", "session"); gate.close(refused = true)
        assertEquals("third refusal in 10 min: 10 min", 10 * 60_000L, gate.cooldownLeft("a"))
    }

    @Test fun atMostSixDialogsPerTenMinutesAllBots() {
        repeat(6) { i -> assertNull(gate.check("bot$i")); gate.open("bot$i", "session"); gate.close(refused = false); t += 1000 }
        assertEquals(Err.RATE_LIMITED, gate.check("bot9"))
        t += 10 * 60_000
        assertNull(gate.check("bot9"))
    }

    @Test fun tokenBucketThirtyPerSecondBurstSixty() {
        var now = 0L
        val b = TokenBucket(60.0, 30.0) { now }
        repeat(60) { assert(b.take()) }
        assert(!b.take())
        now += 1000
        repeat(30) { assert(b.take()) }
        assert(!b.take())
    }
}
