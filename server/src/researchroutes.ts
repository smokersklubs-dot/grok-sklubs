import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type { BuiltinTool } from "./agent/tools.js";
import { RateWindow } from "./hardening.js";
import { q } from "./db.js";
import { createReport, listReports, resumeReport } from "./researchreports.js";
import { bots, type UserRecord } from "./store.js";
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
      "Start a durable evidence report only when the user asks for an in-depth investigation. Plan precise distinct questions; use direct primary source URLs when known. Progress and final evidence are saved in this conversation and Research panel.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        plan: { type: "array", items: { type: "string" } },
        seeds: { type: "array", items: { type: "string" } },
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
        .update(JSON.stringify([c.thread ?? 0, message.seq, a.subject, a.plan, a.seeds ?? []]))
        .digest("hex");
      const job = createReport(
        c.bot,
        {
          subject: a.subject,
          plan: a.plan,
          seeds: a.seeds,
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
