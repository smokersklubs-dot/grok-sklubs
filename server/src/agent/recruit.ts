import type { Context, Hono } from "hono";
import { emit } from "../bus.js";
import { config } from "../config.js";
import { describeCron, parseCron } from "../cron.js";
import { q } from "../db.js";
import { isPlanLimit, planRoom } from "../hosted.js";
import { tr } from "../i18n.js";
import { defaultModelRef, modelLabel, type ToolSpec } from "../llm/index.js";
import { routines } from "../routines.js";
import type { RecruitCard, RecruitLimit, RecruitRoutine, RecruitSkill } from "../recruittypes.js";
import { addFromLibrary, libraryEntries } from "../skillslibrary.js";
import { audit, bots, clip, newId, publicBot, rows, settings, TeamFullError, type BotRecord, type UserRecord } from "../store.js";
import { enqueue, isPaused } from "./loop.js";
import type { BuiltinTool } from "./tools.js"; import { roles as boardRoles } from "../workboardroles.js"; import { gt } from "../guidei18n.js"; // L163 a bot for a board role (boardplan.ts)

/**
 * « Bot recruteur »: the main bot (primary) proposes ONE new specialist when a substantial or recurring request fits no
 * teammate's role. bot_propose only shows a card (recruittypes.ts): name, role, why, its instructions, skills of the
 * Bibliothèque, suggested routines (paused), its brain and the request it would take over. The card is the approval:
 * nothing is created until the owner presses « Créer ». Then (POST /bots/:id/cards/:seq/recruit) the bot is created on
 * the existing path (bots.create: the installation's and the hosted plan's limits apply), careful, in the main bot's
 * section, with the skills added as reviewed skills and the routines paused; the request is handed to it with an answer
 * route back to the main bot (the teammate reply flow of team.ts settleAsk), so its result comes back to the main bot,
 * which tells the owner. « Non merci » leaves nothing behind. The new bot gets no secret, grant or setting the account
 * does not give every new bot: nothing is copied from the main bot but its model (when the owner keeps "same brain").
 */

/** Proposals a main bot may make per conversation in 24 hours, unless the user asked for a new teammate. */
export const PROPOSALS_PER_DAY = 1;
const MAX_SKILLS = 5, MAX_ROUTINES = 3;

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const text = (v: unknown, n: number) => clip(String(v ?? "").replace(/\s+/g, " ").trim(), n);

/** Proposal cards this bot showed in the current conversation over the last 24 hours. */
export function proposalsToday(bot: Pick<BotRecord, "id" | "generation">): number {
  return q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'card' AND created_at > ? AND body LIKE '%\"type\":\"recruit\"%'", bot.id, bot.generation, Date.now() - 86_400_000)!.n;
}

/** Why one more bot cannot be created for this account right now (checked before the card and again on « Créer »). */
export function recruitLimit(userId: string): { limit: RecruitLimit; n: number } | null {
  const room = planRoom(userId);
  if (room.bots !== null && room.bots <= 0) return { limit: "plan", n: room.maxBots ?? 0 };
  if (bots.createdByBotsSince(userId, Date.now() - 86_400_000) >= config.botCreatePerDay) return { limit: "daily", n: config.botCreatePerDay };
  try { bots.assertRoom(); } catch (err) { if (err instanceof TeamFullError) return { limit: "team", n: err.max }; throw err; }
  return null;
}

const brainRef = (brain: RecruitCard["brain"], primary: BotRecord) => (brain === "same" ? primary.model : "");
const brainLabel = (brain: RecruitCard["brain"], primary: BotRecord, userId: string) => modelLabel(brainRef(brain, primary) || defaultModelRef(), userId);

function pickSkills(raw: unknown, locale: UserRecord["locale"]): RecruitSkill[] {
  const ids = Array.isArray(raw) ? raw.map((x) => String(x).trim()) : [];
  const out: RecruitSkill[] = [];
  for (const e of libraryEntries()) if (ids.includes(e.id) && out.length < MAX_SKILLS) out.push({ id: e.id, title: (e.title[locale] ?? e.title.en) });
  return out;
}

function pickRoutines(raw: unknown, locale: UserRecord["locale"]): RecruitRoutine[] | string {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_ROUTINES) : [];
  const out: RecruitRoutine[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const name = text(r?.name, 80), schedule = text(r?.schedule, 60), prompt = String(r?.prompt ?? "").trim().slice(0, 2000);
    if (!name || !schedule || !prompt) return "Each suggested routine needs a name, a schedule (five-field cron) and what to do.";
    try { parseCron(schedule); } catch (err) { return `The schedule "${schedule}" is not valid: ${(err as Error).message}.`; }
    out.push({ name, schedule, when: describeCron(schedule, locale), prompt });
  }
  return out;
}

export function libraryLines(locale: UserRecord["locale"]): string[] {
  return libraryEntries().map((e) => `  - ${e.id} — ${(e.title[locale] ?? e.title.en)}: ${(e.summary[locale] ?? e.summary.en)}`);
}

export const recruitTools: BuiltinTool[] = [
  {
    spec: {
      name: "bot_propose",
      description: "Main bot only. Propose ONE new specialist teammate to the user, on a card they approve (the card is the approval: nothing is created before they press its button). Only when the request clearly falls outside every teammate's role AND is recurring or substantial — never for a small one-off question, never when a teammate fits (hand it with bot_message instead). At most one proposal per conversation per day unless the user asked for a new teammate. After calling it, end your turn: once the user creates it, the request is handed to it automatically and its result comes back to you.",
      inputSchema: obj({
        name: str("Its name: short, unique on the team"), role: str("Its role in a few words, e.g. \"Comptable\""),
        why: str("One line, in the user's language: why a new teammate rather than you or an existing one"),
        instructions: str("Its standing instructions, in the user's language: what it does, how, for whom"),
        skills: { type: "array", items: { type: "string" }, description: `Ids of Bibliothèque skills that fit its job (at most ${MAX_SKILLS}), from the list in your instructions` },
        routines: { type: "array", description: `Routines it could run (at most ${MAX_ROUTINES}); they are created paused`, items: { type: "object", properties: { name: str("Routine name"), schedule: str("Five-field cron, e.g. \"0 9 * * 1\""), prompt: str("What it does each time") }, required: ["name", "schedule", "prompt"] } },
        brain: { type: "string", enum: ["same", "default"], description: "\"same\": your own model (default); \"default\": the account's default model" },
        task: str("The user's request to hand over, with all the context it needs"),
        user_asked: { type: "boolean", description: "True only when the user themselves asked for a new teammate in this conversation" },
      }, ["name", "role", "why", "instructions", "task"]),
    },
    activity: "messaging", label: "Proposing a new teammate", group: "team", audited: true, detail: (a) => String(a.name ?? ""),
    run: async (a, c) => {
      const me = bots.byId(c.bot.id) ?? c.bot;
      if (!me.primary || me.parentId) return { content: "Only the main bot can propose a new teammate. Hand the request to the main bot or a teammate with bot_message.", isError: true };
      const loc = c.user.locale;
      const name = text(a.name, 60), role = text(a.role, 60), why = text(a.why, 240), task = String(a.task ?? "").trim().slice(0, 4000);
      const instructions = String(a.instructions ?? "").trim().slice(0, 8000);
      if (!name || !role || !why || !instructions || !task) return { content: "Give the name, the role, why, its instructions and the request to hand over.", isError: true };
      if (bots.byName(c.user.id, name)) return { content: `A bot called "${name}" already exists. Pick another name, or hand the request to it with bot_message.`, isError: true };
      const fits = bots.list(c.user.id).find((b) => b.kind === "agent" && b.id !== me.id && b.label.trim().toLowerCase() === role.toLowerCase());
      if (fits) return { content: `${fits.name} already has this role (${fits.label}). Hand the request to it with bot_message instead of proposing a new teammate.`, isError: true };
      if (a.user_asked !== true && proposalsToday(me) >= PROPOSALS_PER_DAY) return { content: "You already proposed a new teammate in this conversation today. Do not propose another unless the user asks: do the work yourself or hand it to a teammate.", isError: true };
      const routinesPicked = pickRoutines(a.routines, loc);
      if (typeof routinesPicked === "string") return { content: routinesPicked, isError: true };
      const brain: RecruitCard["brain"] = a.brain === "default" ? "default" : "same";
      const lim = recruitLimit(c.user.id);
      const card: RecruitCard = {
        type: "recruit", name, role, why, instructions, skills: pickSkills(a.skills, loc), routines: routinesPicked,
        brain, brainLabel: brainLabel(brain, me, c.user.id), task, status: "pending", ...(lim ? { limit: lim.limit, limitN: lim.n } : {}),
      };
      rows.append(c.bot, { kind: "card", card });
      if (lim) return { content: `The proposal card is shown, but ${name} cannot be created right now (${lim.limit === "plan" ? "the user's plan bot limit" : lim.limit === "daily" ? "bots created by bots today" : "the team is full"}); the card shows the user what to do. Help with the request yourself in the meantime, and end your turn.`, summary: name, endTurn: true };
      return { content: `The proposal card for ${name} is in front of the user. End your turn now and wait. If they create it, the request is handed to ${name} automatically and its answer comes back to you as a message: then tell the user the outcome. If they say no thanks, help with the request yourself.`, summary: name, endTurn: true };
    },
  },
];

// ── « Créer » / « Non merci » ───────────────────────────────────────────────
type Env = { Variables: { user: UserRecord } };
const err = (c: Context, status: 400 | 404 | 409, error: string) => c.json({ error }, status);

/** What happens on « Créer »: the bot, its skills and paused routines, its place, then the handover. Throws nothing. */
export function createRecruit(primary: BotRecord, user: UserRecord, seq: number, card: RecruitCard, edits: { name?: unknown; role?: unknown; instructions?: unknown }): { ok: true; bot: BotRecord } | { ok: false; status: 400 | 409; error: string } {
  const loc = user.locale;
  const name = edits.name !== undefined ? text(edits.name, 60) : card.name;
  const role = edits.role !== undefined ? text(edits.role, 60) : card.role;
  const instructions = edits.instructions !== undefined ? String(edits.instructions).trim().slice(0, 8000) : card.instructions;
  if (!name || !role || !instructions) return { ok: false, status: 400, error: tr(loc, "Give it a name, a role and instructions.") };
  if (bots.byName(user.id, name)) return { ok: false, status: 409, error: tr(loc, "A bot called \"{name}\" already exists. Pick another name.", { name }) };
  const blocked = (limit: RecruitLimit, n: number) => {
    rows.updateCard(primary, primary.generation, seq, (k) => (k.type === "recruit" ? { ...k, limit, limitN: n } : k));
    const why = limit === "plan" ? "Limit of your plan reached ({n} bots)." : limit === "daily" ? "Your bots already created {n} bots in the last 24 hours." : "The team is full ({n} bots).";
    return { ok: false as const, status: 409 as const, error: tr(loc, why, { n }) };
  };
  const lim = recruitLimit(user.id);
  if (lim) return blocked(lim.limit, lim.n);
  let created: BotRecord;
  try {
    created = bots.create(user.id, { name, label: role, instructions, model: brainRef(card.brain, primary), autonomy: "careful", createdBy: primary.id });
  } catch (e) {
    if (isPlanLimit(e)) return blocked("plan", Number(e.vars.n) || 0);
    if (e instanceof TeamFullError) return blocked("team", e.max);
    return { ok: false, status: 409, error: (e as Error).message };
  }
  // In the main bot's section of the sidebar (and so paused with it when that section is paused).
  if (primary.sectionId) bots.patch(created.id, { sectionId: primary.sectionId });
  const added: string[] = [];
  for (const s of card.skills) {
    try { if (addFromLibrary(user.id, s.id, created.id, loc).added.length) added.push(s.title); } catch { /* left out of the library since: skipped */ }
  }
  const tz = settings.profile(user.id).timezone || "UTC";
  for (const r of card.routines) routines.create(created.id, { name: r.name, prompt: r.prompt, trigger: "cron", schedule: r.schedule, timezone: tz, paused: true });
  rows.append(created, { kind: "event", event: "bot", text: tr(loc, "{bot} created this bot.", { bot: primary.name }) }, 0);
  rows.updateCard(primary, primary.generation, seq, (k) => (k.type === "recruit" ? { ...k, name, role, instructions, status: "created", botId: created.id, botName: created.name, limit: undefined, limitN: undefined } : k));
  audit(user.id, "account", `${primary.name}: created the bot ${created.name} from its proposal (skills: ${added.join(", ") || "none"}, ${card.routines.length} paused routine(s))`, primary.id);
  emit(user.id, { type: "roster" });
  emit(user.id, { type: "bot", bot: publicBot(bots.byId(created.id) ?? created) });
  // The handover: its answer comes back to the main bot (team.ts settleAsk with no one waiting), which tells the owner.
  const now = bots.byId(created.id) ?? created;
  if (isPaused(now)) {
    rows.append(primary, { kind: "message", role: "assistant", text: tr(loc, "{name} is ready, but its section is paused: resume it, then ask me to hand it the request.", { name: created.name }) }, 0);
    return { ok: true, bot: now };
  }
  // L163 (boardplan.ts): a bot proposed for a role of the work board holds that role; the board gives it its tasks.
  if (card.boardRole) { boardRoles.set(user.id, card.boardRole, { botId: created.id }); rows.append(primary, { kind: "message", role: "assistant", text: gt(loc, "{name} now holds its role on the work board.", { name: created.name }) }, 0); return { ok: true, bot: now }; }
  const handover = tr(loc, "{user} asked for this, and I am handing it to you: {task}\nWhen it is done, answer with the result: I will pass it on.", { user: user.name, task: card.task });
  rows.append(now, { kind: "message", role: "user", text: handover, origin: { kind: "bot", id: primary.id, name: primary.name } }, 0);
  enqueue(now.id, { kind: "bot", fromName: primary.name, text: handover, depth: 1, ask: { id: newId("ask"), fromId: primary.id } });
  rows.append(primary, { kind: "message", role: "assistant", text: tr(loc, "I handed this to {name}, I will keep you posted.", { name: created.name }) }, 0);
  return { ok: true, bot: now };
}

export function registerRecruitRoutes(api: Hono<Env>) {
  api.post("/bots/:id/cards/:seq/recruit", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot) return err(c, 404, tr(user.locale, "That bot does not exist."));
    if (bot.kind !== "agent") return err(c, 400, tr(user.locale, "A group chat cannot do that."));
    const seq = Number(c.req.param("seq"));
    const row = rows.get(bot.id, bot.generation, seq);
    const card = row?.body.kind === "card" && row.body.card.type === "recruit" ? row.body.card : null;
    if (!card) return err(c, 400, tr(user.locale, "That is not a proposed teammate."));
    if (card.status !== "pending") return err(c, 409, tr(user.locale, "This was already answered."));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action === "decline") {
      rows.updateCard(bot, bot.generation, seq, (k) => (k.type === "recruit" ? { ...k, status: "declined" } : k));
      audit(user.id, "account", `${bot.name}: proposal of a new bot declined (${card.name})`, bot.id);
      return c.json({ ok: true });
    }
    if (b.action !== "create") return err(c, 400, tr(user.locale, "Unknown action."));
    if (!bot.primary) return err(c, 409, tr(user.locale, "Only the main bot can set up a new teammate."));
    const r = createRecruit(bot, user, seq, card, { name: b.name, role: b.role, instructions: b.instructions });
    return r.ok ? c.json({ ok: true, bot: publicBot(r.bot) }) : err(c, r.status, r.error);
  });
}
