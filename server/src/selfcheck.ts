/**
 * L153 « Vérifier ce bot » (idea: Rakazo « tester les outils, pas seulement le modèle »; our own code). The web app sends
 * the bot an ordinary message (lib/selfcheck.ts) asking it, with its real tools, to read a page of this server, save a
 * small file holding a one-time word, read it back and say so. This module only LOOKS at what happened — nothing is
 * run, written or sent here:
 *   GET /bots/:id/selfcheck?token=…&since=…  → { file, page, journal }
 *   - file: "match" (the file holds exactly the word), "other" (it exists with something else), "missing";
 *   - page: whether the journal has a page-reading tool (web_fetch, browser_open…) that ended well since the check began;
 *   - journal: this bot's journal lines since then (at most 30, newest first), as Settings → Journal shows them.
 * Owner only (bots.owned).
 */
import type { Hono } from "hono"; import { tr } from "./i18n.js";
import { readLibraryFile } from "./computer.js";
import { listJournal } from "./journal.js";
import { fail } from "./routeinput.js";
import { bots, type UserRecord } from "./store.js";
import type { JournalEntry } from "./shared.js";

/** The file the bot is asked to save (in its files folder), and the shape of the one-time word. */
export const SELFCHECK_FILE = "sklubot-verification.txt";
export const SELFCHECK_TOKEN = /^SKB-[A-Z0-9]{6,12}$/;
const PAGE_TOOLS = /^(web_fetch|browser_open|browser_read|page_read|web_search)$/;

export interface SelfCheck { file: "match" | "other" | "missing"; page: boolean; journal: JournalEntry[] }

export function selfCheck(userId: string, botId: string, token: string, since: number): SelfCheck {
  let file: SelfCheck["file"] = "missing";
  for (const rel of [`files/${SELFCHECK_FILE}`, SELFCHECK_FILE]) {
    try { file = readLibraryFile(botId, rel).toString("utf8").trim() === token ? "match" : "other"; break; } catch { /* not there */ }
  }
  const journal = listJournal(userId, { botId, from: since, limit: 30 });
  return { file, page: journal.some((j) => PAGE_TOOLS.test(j.tool) && j.status === "done"), journal };
}

export function registerSelfCheckRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  api.get("/bots/:id/selfcheck", (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "") ?? fail(404, tr(user.locale, "That bot does not exist."));
    const token = c.req.query("token") ?? "";
    const since = Number(c.req.query("since"));
    if (!SELFCHECK_TOKEN.test(token) || !Number.isFinite(since) || since <= 0) fail(400, tr(user.locale, "Unknown check."));
    return c.json(selfCheck(user.id, bot.id, token, since), 200, { "cache-control": "no-store" });
  });
}
