import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type { BuiltinTool } from "./agent/tools.js";
import { RateWindow } from "./hardening.js";
import { q } from "./db.js";
import { createReport, listReports, resumeReport } from "./researchreports.js";
import { bots, type UserRecord } from "./store.js";
import { dropFeed, hasFeed, newFeedToken, searchPastReports, setWatch, watchOf, type WatchEvery } from "./researchwatch.js";
import { hasPersonalX, setPersonalX, xSearchProvider } from "./xsearch.js";
const requests = new RateWindow(12, 60_000);
export function registerResearch(api: Hono<any>) {
  api.use("/research/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  api.get("/research/x-account", (c) => {
    const id = c.get("user").id;
    return c.json({ personal: hasPersonalX(id), provider: xSearchProvider(id) });
  });
  api.put("/research/x-account", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (typeof body?.token !== "string") return c.json({ error: "Jeton X invalide." }, 400);
    try {
      setPersonalX(c.get("user").id, body.token.trim());
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Impossible d’enregistrer ce jeton." }, 400);
    }
  });
  api.delete("/research/x-account", (c) => {
    setPersonalX(c.get("user").id, null);
    return c.json({ ok: true });
  });
  api.get("/bots/:id/research", (c) => {
    const bot = bots.owned(c.get("user").id, c.req.param("id"));
    if (!bot || bot.hidden || bot.kind !== "agent") return c.json({ error: "Bot introuvable." }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json({ reports: listReports(bot) });
  });
  api.post("/bots/:id/research", async (c) => {
    const user: UserRecord = c.get("user"),
      bot = bots.owned(user.id, c.req.param("id"));
    if (!bot || bot.hidden || bot.kind !== "agent") return c.json({ error: "Bot introuvable." }, 404);
    if (requests.over(user.id)) return c.json({ error: "Réessaie dans une minute." }, 429);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Demande invalide." }, 400);
    try {
      return c.json(
        createReport(bot, { ...body, locale: user.locale }, body.requestId ?? "", body.thread ?? 0),
        201,
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Demande invalide." }, 400);
    }
  });
  registerResearchWatch(api); // L87 veille, past reports, Atom feed (below)
  api.post("/bots/:id/research/:report/continue", (c) => {
    const bot = bots.owned(c.get("user").id, c.req.param("id"));
    if (!bot || bot.hidden || bot.kind !== "agent") return c.json({ error: "Bot introuvable." }, 404);
    if (bot.disabledTools.includes("web"))
      return c.json({ error: "La recherche web est désactivée." }, 403);
    if (!resumeReport(bot, c.req.param("report")))
      return c.json({ error: "Aucune recherche interrompue à reprendre." }, 409);
    return c.json({ ok: true });
  });
}
export const researchTool: BuiltinTool = {
  spec: {
    name: "deep_research_start",
    description:
      "Start a durable evidence report only when the user asks for an in-depth investigation. Plan precise distinct questions; use direct primary source URLs when known. Set window when the user asks about a period (\"ce mois-ci\" = month): older sources are set aside. Add free sources when they fit: hn (tech, startups), polymarket (forecasts, elections, events: shown as bettors' odds, never facts), reddit and youtube (what people say; read-only through Agent Reach), openalex (scholarly works of every field) and pubmed (medicine and life sciences). Progress and final evidence are saved in this conversation and Research panel.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        plan: { type: "array", items: { type: "string" } },
        seeds: { type: "array", items: { type: "string" } },
        window: { type: "string", enum: ["any", "week", "month", "year"], description: "Only sources published in this period" },
        sources: { type: "array", items: { type: "string", enum: ["hn", "polymarket", "reddit", "youtube", "openalex", "pubmed"] } },
      },
      required: ["subject", "plan"],
    },
  },
  group: "web",
  activity: "searching",
  label: "Deep research",
  audited: true,
  run: async (a, c) => {
    if (c.origin !== "user" || c.tainted)
      return { content: "Ask the user to start a research report from the + menu.", isError: true };
    try {
      const message = q.get<{ seq: number }>(
        "SELECT seq FROM rows WHERE bot_id=? AND generation=? AND thread=? AND kind='message' AND json_extract(body,'$.role')='user' ORDER BY seq DESC LIMIT 1",
        c.bot.id, c.bot.generation, c.thread ?? 0,
      );
      if (!message) throw Error("Demande de recherche introuvable dans la discussion.");
      const key = createHash("sha256")
        .update(JSON.stringify([c.thread ?? 0, message.seq, a.subject, a.plan, a.seeds ?? [], ...(a.window || a.sources ? [a.window ?? null, a.sources ?? []] : [])]))
        .digest("hex");
      const job = createReport(
        c.bot,
        {
          subject: a.subject,
          plan: a.plan,
          seeds: a.seeds,
          window: a.window,
          extras: a.sources,
          discover: true,
          model: true,
          locale: c.user.locale,
        },
        key,
        c.thread,
      );
      return {
        content:
          "The research is queued. The final report will be posted here. Progress is available under + → Deep research. ID " +
          job.id,
        summary: "Research queued",
      };
    } catch (e) {
      return { content: e instanceof Error ? e.message : "Research could not start.", isError: true };
    }
  },
};

/** L87: « Veille » on a report, « Chercher dans mes rapports », and the private Atom feed (researchwatch.ts). */
function registerResearchWatch(api: Hono<any>) {
  api.get("/research/search", (c) => c.json({ hits: searchPastReports(c.get("user").id, String(c.req.query("q") ?? "").slice(0, 300)) }));
  api.get("/bots/:id/research/:report/watch", (c) => {
    const bot = bots.owned(c.get("user").id, c.req.param("id"));
    if (!bot || bot.kind !== "agent") return c.json({ error: "Bot introuvable." }, 404);
    const w = watchOf(c.req.param("report"), bot.id); // only a report of this bot (account isolation)
    return c.json({ every: w?.every ?? null, nextAt: w?.next_at ?? null });
  });
  api.put("/bots/:id/research/:report/watch", async (c) => {
    const bot = bots.owned(c.get("user").id, c.req.param("id"));
    if (!bot || bot.hidden || bot.kind !== "agent") return c.json({ error: "Bot introuvable." }, 404);
    const every = (await c.req.json().catch(() => ({})))?.every;
    if (every !== null && every !== "week" && every !== "month") return c.json({ error: "Choisis week, month ou null." }, 400);
    try { return c.json(setWatch(bot, c.req.param("report"), every as WatchEvery | null)); } catch (e) { return c.json({ error: (e as Error).message }, 404); }
  });
  api.get("/research/feed", (c) => c.json({ enabled: hasFeed(c.get("user").id) }));
  /** A new private address (the old one stops working); the token is shown in this answer only. */
  api.post("/research/feed", (c) => c.json({ enabled: true, path: `/api/research-feed/${newFeedToken(c.get("user").id)}.atom` }));
  api.delete("/research/feed", (c) => { dropFeed(c.get("user").id); return c.json({ enabled: false }); });
}

/** L87 « Chercher dans mes rapports »: the bot finds what the account's past research reports already established. */
export const pastReportsTool: BuiltinTool = {
  spec: {
    name: "research_reports_search",
    description: "Search the account's finished deep-research reports by words, before starting a new one: returns the matching reports, their date and the best matching evidence line.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  group: "web", activity: "searching", label: "Searching past reports", parallel: true,
  run: async (a, c) => {
    const hits = searchPastReports(c.user.id, String(a.query ?? ""));
    if (!hits.length) return { content: "No past report matches.", summary: "0 reports" };
    return { content: hits.map((h) => `- ${h.subject} (${new Date(h.updated).toISOString().slice(0, 10)}, by ${h.botName}, report ${h.id}): ${h.excerpt}`).join("\n"), summary: `${hits.length} reports` };
  },
};
