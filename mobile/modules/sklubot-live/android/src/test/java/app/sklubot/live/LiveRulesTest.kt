package app.sklubot.live

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveRulesTest {
    private fun rows(botId: String, vararg r: String) = JSONObject("""{"type":"rows","botId":"$botId","generation":1,"rows":[${r.joinToString(",")}]}""")
    private fun msg(seq: Int, text: String, role: String = "assistant", streaming: Boolean = false, thread: Int = 0) =
        """{"botId":"b","generation":1,"seq":$seq,"rev":$seq,"createdAt":1,"thread":$thread,"body":{"kind":"message","role":"$role","text":"$text","streaming":$streaming}}"""

    private fun seeded() = LiveRules("Needs you").apply {
        seed(JSONObject("""{"bots":[{"id":"b","name":"Nova"}],"live":{"b":{"running":false,"activity":null,"awaiting":null}}}"""))
    }

    @Test fun notifiesAFinishedReplyOnce() {
        val r = seeded()
        assertTrue(r.onEvent(rows("b", msg(5, "Je cherche", streaming = true))).isEmpty())
        assertEquals(listOf(Alert("b", "Nova", "Voilà le résumé", false)), r.onEvent(rows("b", msg(5, "Voilà le **résumé**"))))
        // The same message rewritten later (a reaction…) is not announced again.
        assertTrue(r.onEvent(rows("b", msg(5, "Voilà le résumé"))).isEmpty())
        assertEquals(1, r.onEvent(rows("b", msg(6, "Autre chose"))).size)
    }

    @Test fun ignoresUserMessagesThreadsAndEmptyText() {
        val r = seeded()
        assertTrue(r.onEvent(rows("b", msg(1, "Salut", role = "user"))).isEmpty())
        assertTrue(r.onEvent(rows("b", msg(2, "Dans le fil", thread = 1))).isEmpty())
        assertTrue(r.onEvent(rows("b", msg(3, "  "))).isEmpty())
    }

    @Test fun announcesANewWaitOnly() {
        val r = LiveRules("Needs you").apply {
            seed(JSONObject("""{"bots":[{"id":"b","name":"Nova"},{"id":"c","name":"Max"}],"live":{"c":{"awaiting":{"reason":"Old","since":1}}}}"""))
        }
        val wait = JSONObject("""{"type":"live","botId":"b","live":{"running":true,"awaiting":{"reason":"Approve the email","since":2}}}""")
        assertEquals(listOf(Alert("b", "Nova", "Approve the email", true)), r.onEvent(wait))
        assertTrue(r.onEvent(wait).isEmpty())
        assertTrue(r.onEvent(JSONObject("""{"type":"live","botId":"c","live":{"awaiting":{"reason":"Old","since":1}}}""")).isEmpty())
        r.onEvent(JSONObject("""{"type":"live","botId":"b","live":{"running":false,"awaiting":null}}"""))
        assertEquals("Needs you", r.onEvent(JSONObject("""{"type":"live","botId":"b","live":{"awaiting":{"reason":"","since":3}}}"""))[0].body)
    }

    @Test fun learnsNamesAndAsksForTheRosterWhenABotIsUnknown() {
        val r = seeded()
        r.onEvent(JSONObject("""{"type":"bot","bot":{"id":"b","name":"Nova 2"}}"""))
        assertEquals("Nova 2", r.onEvent(rows("b", msg(9, "ok")))[0].title)
        r.onEvent(rows("z", msg(1, "hello")))
        assertTrue(r.needsRoster)
        r.rosterRead()
        r.onEvent(JSONObject("""{"type":"roster"}"""))
        assertTrue(r.needsRoster)
    }

    @Test fun aResetStartsTheCountAgain() {
        val r = seeded()
        r.onEvent(rows("b", msg(4, "un")))
        r.onEvent(JSONObject("""{"type":"reset","botId":"b","generation":2}"""))
        assertEquals(1, r.onEvent(rows("b", msg(1, "nouvelle conversation"))).size)
    }

    @Test fun firstWordsLikeTheApp() {
        assertEquals("Titre lien", LiveRules.firstWords("# Titre\n[lien](https://x)"))
        assertEquals("abcd…", LiveRules.firstWords("abcdefgh", 5))
    }

    @Test fun parsesServerSentEvents() {
        val s = SseLines()
        assertEquals(null, s.line(": comment"))
        assertEquals(null, s.line("data: {\"type\":"))
        assertEquals(null, s.line("data:\"ping\"}"))
        assertEquals("{\"type\":\n\"ping\"}", s.line(""))
        assertEquals(null, s.line(""))
        assertEquals(null, s.line("event: x"))
        assertEquals(null, s.line("data: a"))
        assertEquals("a", s.line(""))
    }

    @Test fun backsOffForTheBattery() {
        val b = Backoff()
        assertEquals(listOf(2_000L, 5_000L, 15_000L, 30_000L, 60_000L, 300_000L, 300_000L), List(7) { b.next() })
        b.reset()
        assertEquals(2_000L, b.next())
    }
}
