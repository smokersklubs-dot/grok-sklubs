import type { Context, Hono } from "hono";
import { RateWindow } from "./hardening.js";
import type { Locale } from "./shared.js";
import { CatalogError, teamCatalog, updateFromSource } from "./skillcatalog.js";
import { healthReport, nearDuplicates, skillMeta, skillVersions } from "./skillhealth.js";
import type { BenchResult, SkillScope } from "./skillhealthtypes.js";
import { libraryEntries } from "./skillslibrary.js";
import { audit, bots, sections, skills, skillText, type UserRecord } from "./store.js";
import { capHolds } from "./usagecaps.js";

/**
 * « Santé des compétences » (skillhealth.ts), « Catalogue de l'équipe » and versioned copies (skillcatalog.ts), the
 * « avec / sans » test bench (L134). Registered after the session check; everything acts on the signed-in account's own
 * skills and bots only (skills.owned / bots.owned).
 *   GET    /skills/health                          every skill with its health, and the curator's suggestions
 *   PATCH  /skills/:id/meta                        { pinned?, locked?, onlyOnRequest?, alwaysFull?, scope?, state? }
 *   GET    /skills/:id/versions                    older texts kept (10 at most)
 *   POST   /skills/:id/versions/:vid/restore       puts one back (the replaced text is kept in turn)
 *   POST   /skills/:id/update                      takes the newer text of its source (library or catalogue)
 *   POST   /skills/:id/publish                     puts it in the team catalogue (a new version if already there)
 *   POST   /skills/duplicates                      { name, description, body, exceptId? } near-identical skills (editor alert)
 *   POST   /skills/:id/bench                       { prompt } the same request with and without this skill
 *   POST   /skills-library/:id/bench               { prompt, botId } the same, for a library skill before adding it
 *   GET    /skills-catalog                         the team catalogue
 *   POST   /skills-catalog/:id/add                 { target: "all" | botId }
 *   DELETE /skills-catalog/:id
 */
const FR: Record<string, string> = {
  "That skill does not exist.": "Cette compétence n'existe pas.",
  "That bot does not exist.": "Ce bot n'existe pas.",
  "That version does not exist.": "Cette version n'existe pas.",
  "That skill is not in the catalogue.": "Cette compétence n'est pas dans le catalogue.",
  "That skill is not in the library.": "Cette compétence n'est pas dans la bibliothèque.",
  "Activate this skill before putting it in the catalogue.": "Active cette compétence avant de la mettre au catalogue.",
  "The catalogue is full (200 skills). Remove one first.": "Le catalogue est plein (200 compétences). Retires-en une d'abord.",
  "This skill is already up to date.": "Cette compétence est déjà à jour.",
  "Write the request to try (10 to 2000 characters).": "Écris la demande à essayer (10 à 2 000 caractères).",
  "Too many test runs. Try again in a while.": "Trop d'essais. Réessaie dans un moment.",
  "A usage cap stops this bot right now.": "Un plafond de dépenses arrête ce bot en ce moment.",
  "The test could not run: {detail}": "L'essai n'a pas pu se faire : {detail}",
};
const say = (loc: Locale | undefined, en: string, vars: Record<string, string> = {}) => (loc === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "");
class RouteError extends Error { constructor(public status: 400 | 404 | 429, message: string, public vars: Record<string, string> = {}) { super(message); } }

const benches = new RateWindow(12, 3_600_000);

/** Runs the same request twice on the bot's own model: with the skill as an instruction, and without it. */
async function bench(botId: string, userId: string, skillName: string, text: string, raw: Record<string, any>): Promise<BenchResult> {
  const bot = bots.owned(userId, botId);
  if (!bot || bot.kind !== "agent" || bot.hidden) throw new RouteError(404, "That bot does not exist."); // the bot first: nothing said about another account's
  const prompt = promptOf(raw);
  if (capHolds(bot)) throw new RouteError(400, "A usage cap stops this bot right now.");
  if (benches.over(userId)) throw new RouteError(429, "Too many test runs. Try again in a while.");
  const { ask } = await import("./agent/memory.js");
  const base = `You are ${bot.name}, an assistant. This is a test run: answer the request as you would in the chat, in its language, without tools (describe what you would do where a tool would be needed).${bot.instructions.trim() ? `\n\nStanding instructions:\n${bot.instructions.trim().slice(0, 4000)}` : ""}`;
  try {
    const [withSkill, without] = await Promise.all([
      ask(bot, `${base}\n\n## Skill to follow when it matches: ${skillName}\n${text}`, prompt, true),
      ask(bot, base, prompt, true),
    ]);
    audit(userId, "account", `Skill test run (with / without): ${skillName}`, bot.id);
    return { prompt, skillName, withSkill: { text: withSkill, chars: withSkill.length }, without: { text: without, chars: without.length } };
  } catch (err) { throw new RouteError(400, "The test could not run: {detail}", { detail: String((err as Error).message ?? err).slice(0, 200) }); }
}

function promptOf(b: Record<string, any>): string {
  const p = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (p.length < 10 || p.length > 2000) throw new RouteError(400, "Write the request to try (10 to 2000 characters).");
  return p;
}
const flag = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function registerSkillHealthRoutes(api: Hono<any>) {
  const handle = (fn: (c: Context, user: UserRecord, b: Record<string, any>) => Promise<Response> | Response) => async (c: Context) => {
    const user = c.get("user") as UserRecord;
    try {
      const parsed = c.req.method === "GET" || c.req.method === "DELETE" ? {} : await c.req.json().catch(() => ({}));
      return await fn(c, user, parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
    } catch (err) {
      if (err instanceof RouteError) return c.json({ error: say(user.locale, err.message, err.vars) }, err.status);
      if (err instanceof CatalogError) return c.json({ error: say(user.locale, err.message) }, err.status);
      throw err;
    }
  };
  const own = (user: UserRecord, id: string) => skills.owned(user.id, id) ?? (() => { throw new RouteError(404, "That skill does not exist."); })();

  api.get("/skills/health", handle((c, user) => c.json({ report: healthReport(user.id) })));
  api.post("/skills/duplicates", handle((c, user, b) => {
    const text = { name: String(b.name ?? "").slice(0, 200), description: String(b.description ?? "").slice(0, 2000), body: String(b.body ?? "").slice(0, 40_000) };
    const exceptId = typeof b.exceptId === "string" ? b.exceptId : undefined;
    return c.json({ similar: nearDuplicates(user.id, text, exceptId).map((x) => ({ skillId: x.skill.id, name: x.skill.name, botName: x.botName, score: x.score })) });
  }));
  api.patch("/skills/:id/meta", handle((c, user, b) => {
    const s = own(user, c.req.param("id")!);
    const owner = bots.list(user.id);
    for (const k of ["pinned", "locked", "onlyOnRequest", "alwaysFull"] as const) { const v = flag(b[k]); if (v !== undefined) skillMeta.setFlag(s.id, k, v); }
    if (b.scope && typeof b.scope === "object") {
      // Only the account's own bots and sections are kept.
      const botIds = new Set(owner.map((x) => x.id)), secIds = new Set(sections.list(user.id).map((x) => x.id));
      const scope: SkillScope = { bots: ids(b.scope.bots).filter((x) => botIds.has(x)), sections: ids(b.scope.sections).filter((x) => secIds.has(x)), exclude: ids(b.scope.exclude).filter((x) => botIds.has(x)) };
      skillMeta.setScope(s.id, scope);
    }
    if (b.state === "archived" || b.state === "active") { skillMeta.setState(s.id, b.state, "owner"); audit(user.id, "account", `Skill ${b.state === "archived" ? "archived" : "brought back"}: ${s.name}`, s.botId); }
    return c.json({ report: healthReport(user.id) });
  }));
  api.get("/skills/:id/versions", handle((c, user) => c.json({ versions: skillVersions.list(own(user, c.req.param("id")!).id) })));
  api.post("/skills/:id/versions/:vid/restore", handle((c, user) => {
    const s = own(user, c.req.param("id")!);
    const skill = skillVersions.restore(s.id, c.req.param("vid")!) ?? (() => { throw new RouteError(404, "That version does not exist."); })();
    audit(user.id, "account", `Skill put back to an earlier version: ${s.name}`, s.botId);
    return c.json({ skill });
  }));
  api.post("/skills/:id/update", handle((c, user) => c.json({ skill: updateFromSource(user.id, own(user, c.req.param("id")!).id, user.locale) })));
  api.post("/skills/:id/publish", handle((c, user) => c.json({ entry: teamCatalog.publish(user.id, own(user, c.req.param("id")!).id) })));
  api.post("/skills/:id/bench", handle(async (c, user, b) => {
    const s = own(user, c.req.param("id")!);
    return c.json({ result: await bench(s.botId, user.id, s.name, skillText(s), b) });
  }));
  api.post("/skills-library/:id/bench", handle(async (c, user, b) => {
    const e = libraryEntries().find((x) => x.id === c.req.param("id")) ?? (() => { throw new RouteError(404, "That skill is not in the library."); })();
    const t = e.text[user.locale] ?? e.text.en!;
    return c.json({ result: await bench(String(b.botId ?? ""), user.id, e.title[user.locale], skillText({ description: t.description, body: t.body }), b) });
  }));
  api.get("/skills-catalog", handle((c, user) => c.json({ catalog: teamCatalog.list(user.id) })));
  api.post("/skills-catalog/:id/add", handle((c, user, b) => c.json({ report: teamCatalog.add(user.id, c.req.param("id")!, typeof b.target === "string" && b.target ? b.target : "all") })));
  api.delete("/skills-catalog/:id", handle((c, user) => { teamCatalog.remove(user.id, c.req.param("id")!); return c.json({ ok: true }); }));
}
