package app.sklubot.android.relay

/**
 * Local consent gate, the same rules as the desktop relay (companion/src/main/consent.js): whether a consent dialog
 * may be shown at all, so the server can never make dialogs pop up in a loop, and the single pending dialog.
 *  - one dialog at a time;
 *  - after a refusal (or no answer), the same bot waits 1 min; after 3 refusals in 10 min, 10 min;
 *  - at most 6 dialogs per 10 min, all bots together.
 */
class ConsentGate(private val now: () -> Long, private val o: Options = Options()) {
    data class Options(
        val promptTimeoutMs: Long = 60_000,
        val cooldownMs: Long = 60_000,
        val longCooldownMs: Long = 10 * 60_000,
        val refusalWindowMs: Long = 10 * 60_000,
        val refusalsBeforeLong: Int = 3,
        val globalWindowMs: Long = 10 * 60_000,
        val globalMaxPrompts: Int = 6,
    )

    data class Pending(val id: String, val botId: String, val kind: String)

    private val promptTimes = ArrayList<Long>()
    private val refusals = HashMap<String, MutableList<Long>>()
    private val cooldownUntil = HashMap<String, Long>()
    private var seq = 0

    @Volatile var pending: Pending? = null
        private set

    val promptTimeoutMs get() = o.promptTimeoutMs

    /** null when a dialog may be shown now, else the error code to answer with. */
    @Synchronized fun check(botId: String): String? {
        val t = now()
        if (pending != null) return Err.CONSENT_PENDING
        if (t < (cooldownUntil[botId] ?: 0)) return Err.CONSENT_COOLDOWN
        promptTimes.removeAll { t - it >= o.globalWindowMs }
        if (promptTimes.size >= o.globalMaxPrompts) return Err.RATE_LIMITED
        return null
    }

    @Synchronized fun cooldownLeft(botId: String): Long = maxOf(0, (cooldownUntil[botId] ?: 0) - now())

    /** Reserves the single dialog slot. Call only after check() returned null. */
    @Synchronized fun open(botId: String, kind: String): Pending {
        promptTimes.add(now())
        val p = Pending("p${++seq}", botId, kind)
        pending = p
        return p
    }

    /** Closes the pending dialog and records the outcome. */
    @Synchronized fun close(refused: Boolean) {
        val p = pending ?: return
        pending = null
        if (!refused) return
        val t = now()
        val list = (refusals[p.botId] ?: mutableListOf()).filter { t - it < o.refusalWindowMs }.toMutableList()
        list.add(t)
        refusals[p.botId] = list
        val long = list.size >= o.refusalsBeforeLong
        cooldownUntil[p.botId] = t + if (long) o.longCooldownMs else o.cooldownMs
    }
}

/** 30 requests per second on average, bursts of 60 (protocol §2), as relay-core.js. */
class TokenBucket(private val capacity: Double, private val perSecond: Double, private val now: () -> Long) {
    private var tokens = capacity
    private var last = now()

    @Synchronized fun take(): Boolean {
        val t = now()
        tokens = minOf(capacity, tokens + (t - last) / 1000.0 * perSecond)
        last = t
        if (tokens < 1) return false
        tokens -= 1
        return true
    }
}
