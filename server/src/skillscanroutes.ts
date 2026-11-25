import type { Context, Hono } from "hono"; import { tr } from "./i18n.js";
import { fetchSkillMarkdown } from "./agent/tools-team.js";
import { emit } from "./bus.js";
import { RateWindow } from "./hardening.js";
import { acceptSkill, scanAccount, scanBot, scanSkill } from "./skillscan.js";
import { bots, type UserRecord } from "./store.js";

/**
 * « Contrôle de sécurité des compétences » (skillscan.ts, docs/COMPETENCES.md), registered after the session check by
 * skillsroutes.ts. Everything acts on the signed-in account's own bots and skills only (another account's: 404).
 *   POST /skills/scan                     checks every skill of the account's bots → { report }
 *   POST /skills/scan/text                { name?, description?, body, needs?, approvals?, check?, output? } → { scan } (nothing saved)
 *   GET  /bots/:id/skills/scan            the check of each skill of one bot → { scans: { [skillId]: { scan, accepted, blocked } } }
 *   POST /bots/:id/skills/import/scan     { url } reads a skill file at a public address and checks it → { name, description, size, scan } (nothing saved)
 *   POST /skills/:id/scan/accept          the owner read the findings and accepts this text: the skill becomes active → { skill }
 */
const texts = new RateWindow(120, 60_000);
const fetches = new RateWindow(20, 600_000);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export function registerSkillScanRoutes(api: Hono<any>) {
  const json = async (c: Context): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; };
  const ownedAgent = (c: Context) => { const b = bots.owned((c.get("user") as UserRecord).id, c.req.param("id")!); return b && b.kind === "agent" ? b : null; };
  const noBot = (c: Context) => c.json({ error: tr((c.get("user") as UserRecord).locale, "That bot does not exist.") }, 404);
  const tooMany = (c: Context) => c.json({ error: tr((c.get("user") as UserRecord).locale, "Too many checks. Wait a little and try again.") }, 429);

  api.post("/skills/scan", (c) => {
    const user = c.get("user") as UserRecord;
    if (texts.over(user.id)) return tooMany(c);
    return c.json({ report: scanAccount(user.id) });
  });
  api.post("/skills/scan/text", async (c) => {
    if (texts.over((c.get("user") as UserRecord).id)) return tooMany(c);
    const b = await json(c);
    return c.json({ scan: scanSkill({ name: str(b.name, 80), description: str(b.description ?? b.when, 300), body: str(b.body ?? b.steps, 20_000), needs: str(b.needs, 2000), approvals: str(b.approvals, 2000), check: str(b.check, 2000), output: str(b.output, 2000) }) });
  });
  api.get("/bots/:id/skills/scan", (c) => {
    const bot = ownedAgent(c);
    return bot ? c.json({ scans: scanBot(bot.id) }) : noBot(c);
  });
  api.post("/bots/:id/skills/import/scan", async (c) => {
    const bot = ownedAgent(c);
    if (!bot) return noBot(c);
    if (fetches.over(bot.userId)) return tooMany(c);
    const b = await json(c);
    try {
      const s = await fetchSkillMarkdown(str(b.url, 2000), AbortSignal.timeout(25_000));
      const body = s.body.slice(0, 20_000);
      return c.json({ name: s.name, description: s.description, size: s.body.length, scan: scanSkill({ name: s.name, description: s.description, body }) });
    } catch (err) { return c.json({ error: (err as Error).message }, 400); }
  });
  api.post("/skills/:id/scan/accept", (c) => {
    const user = c.get("user") as UserRecord;
    const skill = acceptSkill(user.id, c.req.param("id")!);
    if (!skill) return c.json({ error: tr((c.get("user") as UserRecord).locale, "That skill does not exist.") }, 404);
    emit(user.id, { type: "memories", botId: skill.botId });
    return c.json({ skill });
  });
}
