package app.sklubot.live

import org.json.JSONObject

/** One notification to post: the bot, its name, the text. */
data class Alert(val botId: String, val title: String, val body: String, val waiting: Boolean)

/**
 * What in the live channel deserves a notification — the same rules as the app (src/state/reducers.ts, applyEvent):
 * a finished reply of a bot in the main chat (once per message), and a bot that starts waiting for the user.
 * Pure (org.json only): unit-tested on the JVM.
 */
class LiveRules(private val waitingText: String) {
    private val names = HashMap<String, String>()
    private val waiting = HashMap<String, Boolean>()
    private val lastSeq = HashMap<String, Int>()

    /** From GET /api/bots ({ bots: [...], live: { id: Live } }): names, and who already waits (not re-announced). */
    fun seed(list: JSONObject) {
        val bots = list.optJSONArray("bots") ?: return
        for (i in 0 until bots.length()) {
            val b = bots.optJSONObject(i) ?: continue
            names[b.optString("id")] = b.optString("name")
        }
        val live = list.optJSONObject("live") ?: return
        for (id in live.keys()) waiting[id] = !live.optJSONObject(id)?.optJSONObject("awaiting").isNullOrEmpty()
    }

    private fun JSONObject?.isNullOrEmpty() = this == null || this.length() == 0

    fun name(botId: String) = names[botId] ?: ""

    /** True when the bot list should be read again (a new bot, a renamed one). */
    var needsRoster = false
        private set

    fun rosterRead() { needsRoster = false }

    fun onEvent(ev: JSONObject): List<Alert> {
        when (ev.optString("type")) {
            "rows" -> {
                val botId = ev.optString("botId")
                val rows = ev.optJSONArray("rows") ?: return emptyList()
                for (i in rows.length() - 1 downTo 0) {
                    val row = rows.optJSONObject(i) ?: continue
                    if (row.optInt("thread", 0) != 0) continue
                    val body = row.optJSONObject("body") ?: continue
                    if (body.optString("kind") != "message" || body.optString("role") != "assistant" || body.optBoolean("streaming", false)) continue
                    val text = body.optString("text").trim()
                    if (text.isEmpty()) continue
                    val seq = row.optInt("seq", 0)
                    if (seq <= (lastSeq[botId] ?: 0)) continue
                    lastSeq[botId] = seq
                    if (!names.containsKey(botId)) needsRoster = true
                    return listOf(Alert(botId, names[botId] ?: "Sklubot", firstWords(text, 180), false))
                }
            }
            "reset" -> lastSeq.remove(ev.optString("botId"))
            "live" -> {
                val botId = ev.optString("botId")
                val awaiting = ev.optJSONObject("live")?.optJSONObject("awaiting")
                val was = waiting[botId] ?: false
                val now = awaiting != null && awaiting.length() > 0
                waiting[botId] = now
                if (!was && now) {
                    if (!names.containsKey(botId)) needsRoster = true
                    return listOf(Alert(botId, names[botId] ?: "Sklubot", awaiting!!.optString("reason").ifBlank { waitingText }, true))
                }
            }
            "bot" -> ev.optJSONObject("bot")?.let { names[it.optString("id")] = it.optString("name") }
            "roster" -> needsRoster = true
        }
        return emptyList()
    }

    companion object {
        /** First words of a message: markdown marks removed, one line (src/state/reducers.ts firstWords). */
        fun firstWords(text: String, max: Int = 140): String {
            val plain = text.replace(Regex("```[\\s\\S]*?```"), " ")
                .replace(Regex("[*_`#>~]+"), "")
                .replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
                .replace(Regex("\\s+"), " ").trim()
            return if (plain.length > max) plain.substring(0, max - 1).trimEnd() + "…" else plain
        }
    }
}

/** Server-sent events, line by line (https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation). */
class SseLines {
    private val data = StringBuilder()
    private var hasData = false

    /** Feeds one line (without its end of line); returns the data of a completed event, if any. */
    fun line(l: String): String? {
        if (l.isEmpty()) {
            if (!hasData) return null
            val out = data.toString()
            data.setLength(0)
            hasData = false
            return out
        }
        if (l.startsWith(":")) return null
        val colon = l.indexOf(':')
        val field = if (colon < 0) l else l.substring(0, colon)
        var value = if (colon < 0) "" else l.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        if (field == "data") {
            if (hasData) data.append('\n')
            data.append(value)
            hasData = true
        }
        return null
    }
}

/** Waits between reconnections: 2 s, 5 s, 15 s, 30 s, 1 min, then every 5 min — battery first. Reset by the server's hello. */
class Backoff {
    private var n = 0
    fun next(): Long { val d = STEPS[minOf(n, STEPS.size - 1)]; n++; return d }
    fun reset() { n = 0 }
    companion object { val STEPS = longArrayOf(2_000, 5_000, 15_000, 30_000, 60_000, 300_000) }
}
