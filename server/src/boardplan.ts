/**
 * L163 « plan créé depuis la discussion » and « bot créé automatiquement pour un rôle » (backlog A-FAIRE L163, RESTE
 * 23/11). See docs/TABLEAU.md.
 *
 * Clean room: built from docs/cleanroom/10-timon.md T9 (the lead puts a plan in front of the owner, who chooses before
 * anything runs) and T10/T12 (a role nobody holds; a bot made for a role takes the lead's model) only; the studied
 * product is AGPL-3.0: ideas only, none of its code was read.
 *
 *  - board_plan_propose (bot tool): the bot puts a plan on a card in the chat (boardplantypes.ts) — up to 12 tasks, each
 *    with a kind (a project role), an optional bot named by its name, a priority and the earlier tasks it waits on.
 *    Nothing is created by the tool.
 *  - The owner answers the card (POST /bots/:id/rows/:seq/boardplan): « Mettre sur le tableau » with the tasks they keep
 *    ticked (a task that waited on one left out no longer waits on it), and « lancer tout de suite » or not; or « Non
 *    merci ». The tasks are created with the board's own rules (workboard.ts board.create: titles, bots of the account,
 *    no loops, at most 500 tasks): all of them or none.
 *  - A kind of the kept tasks that no bot holds and no task names a bot for: a proposal card (the « bot recruteur » card,
 *    agent/recruit.ts) is put in the main bot's chat for that role, one per role, never twice while one waits. The bot
 *    is only created when the owner presses « Créer » on it; it then holds the role on the board (and takes the main
 *    bot's model, T10). The board's « Proposer un bot » on a role nobody holds does the same
 *    (POST /board/roles/:role/propose-bot).
 * Isolation: a card is reached through the owner's own bot (bots.owned); every task is created for that owner only.
 */
import type { Hono } from "hono";
import { gt } from "./guidei18n.js";
import { recruitLimit } from "./agent/recruit.js";
import { modelLabel, defaultModelRef } from "./llm/index.js";
import { audit, bots, clip, newId, rows, type BotRecord, type UserRecord } from "./store.js";
import type * as Workboard from "./workboard.js";
import { wt } from "./worki18n.js";
import { roles } from "./workboardroles.js";
import { TASK_KINDS, type TaskKind } from "./workboardtypes.js";
import type { BoardPlanCard, PlanTask } from "./boardplantypes.js";
import type { RecruitCard } from "./recruittypes.js";
import type { BuiltinTool } from "./agent/tools.js";
import { q } from "./db.js";

export const MAX_PLAN_TASKS = 12;
const isKind = (k: unknown): k is TaskKind => (TASK_KINDS as readonly string[]).includes(String(k));
const line = (v: unknown, n: number) => clip(String(v ?? "").replace(/\s+/g, " ").trim(), n);

/** The plan as the tool gave it, checked: a card, or the reason it was refused (in English, for the model). */
export function readPlan(userId: string, raw: { title?: unknown; why?: unknown; tasks?: unknown }): BoardPlanCard | string {
  const list = Array.isArray(raw.tasks) ? raw.tasks : [];
  if (!list.length) return "Give the plan at least one task.";
  if (list.length > MAX_PLAN_TASKS) return `At most ${MAX_PLAN_TASKS} tasks in one plan.`;
  const tasks: PlanTask[] = [];
  for (const [i, t] of (list as Record<string, unknown>[]).entries()) {
    const title = line(t?.title, 160);
    if (!title) return `Task ${i + 1} needs a title.`;
    const kind = isKind(t?.kind) ? t.kind : "";
    let botId: string | null = null, botName = "";
    if (t?.bot !== undefined && String(t.bot).trim()) {
      const b = bots.byName(userId, String(t.bot).trim());
      if (!b || b.kind !== "agent") return `Task ${i + 1}: there is no bot called "${line(t.bot, 60)}". Name one of the team's bots, or leave it empty.`;
      botId = b.id; botName = b.name;
    }
    const after = (Array.isArray(t?.after) ? t.after : []).map(Number);
    if (after.some((n) => !Number.isInteger(n) || n < 1 || n > i)) return `Task ${i + 1} waits on a task that is not before it in the plan (give the numbers of earlier tasks, from 1).`;
    const p = Number(t?.priority);
    tasks.push({ title, description: clip(String(t?.description ?? "").trim(), 4000), kind, botId, botName, priority: Number.isInteger(p) && p >= 1 && p <= 5 ? p : 3, after: [...new Set(after.map((n) => n - 1))].slice(0, 20) });
  }
  return { type: "boardplan", planId: newId("bpl"), title: line(raw.title, 120) || tasks[0].title, why: line(raw.why, 300), tasks, status: "pending", missingRoles: missingRoles(userId, tasks) };
}

/** The kinds of these tasks that nobody would run: no task of that kind names a bot, and no bot holds the role. */
export function missingRoles(userId: string, tasks: Pick<PlanTask, "kind" | "botId">[]): TaskKind[] {
  const held = new Map(roles.list(userId).map((r) => [r.role, !!r.botId]));
  const out = new Set<TaskKind>();
  for (const t of tasks) if (t.kind && !t.botId && !held.get(t.kind)) out.add(t.kind);
  return [...out];
}

// ── A bot for a role nobody holds: a proposal card, never a silent creation ─────────────────────────────
const ROLE_NAME: Record<TaskKind, string> = { code: "Coder", review: "Reviewer", research: "Researcher", docs: "Writer", chore: "Helper" };
const ROLE_JOB: Record<TaskKind, string> = {
  code: "You write and change code for the work board's tasks, in small steps, and say what you changed and how you checked it.",
  review: "You review the work of the other bots: you look for bugs, risks and missing tests, and say clearly « OK » or « à corriger », with why.",
  research: "You look things up for the work board's tasks: you read sources, give the links, and never invent a figure.",
  docs: "You write the documentation of what the team made: short, simple words, with examples.",
  chore: "You take the small chores of the work board: tidying, renaming, simple checks.",
};
export class PlanRefused extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

/** A proposal for this role already waits in the main bot's chat. */
function pendingProposal(main: BotRecord, role: TaskKind): boolean {
  return q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'card' AND body LIKE '%\"boardRole\":%' ORDER BY seq DESC LIMIT 40", main.id, main.generation)
    .some((r) => { try { const c = JSON.parse(r.body).card as RecruitCard; return c.type === "recruit" && c.boardRole === role && c.status === "pending"; } catch { return false; } });
}

/** Puts a « new bot for this role » proposal in the main bot's chat (the owner presses « Créer » or not). */
export function proposeRoleBot(user: UserRecord, role: unknown): { botId: string; seq: number } {
  const loc = user.locale;
  if (role === "lead") throw new PlanRefused(400, gt(loc, "The lead is the main bot: it needs no new bot."));
  if (!isKind(role)) throw new PlanRefused(404, gt(loc, "Unknown role."));
  if (roles.list(user.id).find((r) => r.role === role)?.botId) throw new PlanRefused(409, gt(loc, "A bot already holds this role."));
  const main = bots.primary(user.id);
  if (!main || main.kind !== "agent") throw new PlanRefused(409, gt(loc, "You have no main bot to show the proposal."));
  if (pendingProposal(main, role)) throw new PlanRefused(409, gt(loc, "A proposal for this role is already waiting for you."));
  const base = gt(loc, ROLE_NAME[role]);
  let name = base;
  for (let n = 2; bots.byName(user.id, name) && n < 50; n++) name = `${base} ${n}`;
  const lim = recruitLimit(user.id);
  const card: RecruitCard = {
    type: "recruit", name, role: base, why: gt(loc, "Nobody holds this role on the work board, and tasks of this kind would wait for nobody."),
    instructions: gt(loc, ROLE_JOB[role]), skills: [], routines: [], brain: "same", brainLabel: modelLabel(main.model || defaultModelRef(), user.id),
    task: gt(loc, "Take the board tasks of the role “{role}” (the work board gives them to you). Start by saying hello in one line.", { role: base }),
    status: "pending", boardRole: role, ...(lim ? { limit: lim.limit, limitN: lim.n } : {}),
  };
  rows.append(main, { kind: "notice", tone: "info", text: gt(loc, "Nobody holds the role “{role}” yet: here is a proposal for a bot to take it. Nothing is created until you press « Créer ».", { role: base }) }, 0);
  const seq = rows.append(main, { kind: "card", card }, 0).seq;
  return { botId: main.id, seq };
}

// ── The owner's answer on the plan card ───────────────────────────────────────────────────
export async function answerPlan(bot: BotRecord, user: UserRecord, seq: number, b: { action?: unknown; keep?: unknown; launch?: unknown }): Promise<BoardPlanCard> {
  const loc = user.locale;
  // Loaded here: workboard.ts hangs on the goals at load time, and this module is loaded with the tools (import cycle).
  const { board, BoardError, MAX_TASKS } = (await import("./workboard.js")) as typeof Workboard;
  const row = Number.isInteger(seq) ? rows.get(bot.id, bot.generation, seq) : null;
  if (row?.body.kind !== "card" || row.body.card.type !== "boardplan") throw new PlanRefused(404, gt(loc, "There is no such card here."));
  const card = row.body.card;
  if (card.status !== "pending") throw new PlanRefused(409, gt(loc, "This plan was already answered."));
  if (b.action === "dismiss") {
    const next: BoardPlanCard = { ...card, status: "dismissed" };
    rows.updateCard(bot, row.generation, seq, () => next);
    return next;
  }
  if (b.action !== "create") throw new PlanRefused(400, gt(loc, "Unknown action."));
  const keep = new Set(Array.isArray(b.keep) ? b.keep.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < card.tasks.length) : card.tasks.map((_t, i) => i));
  if (!keep.size) throw new PlanRefused(400, gt(loc, "Tick at least one task."));
  const have = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_tasks WHERE user_id = ?", user.id)!.n;
  if (have + keep.size > MAX_TASKS) throw new PlanRefused(409, gt(loc, "The board is too full for this plan ({n} tasks at most): delete finished tasks first.", { n: MAX_TASKS }));
  const ids: string[] = card.tasks.map(() => "");
  try {
    card.tasks.forEach((t, i) => {
      if (!keep.has(i)) return;
      // A bot named by the plan may have been deleted since: the task then goes to nobody (its role decides, T12).
      const botId = t.botId && bots.owned(user.id, t.botId)?.kind === "agent" ? t.botId : null;
      ids[i] = board.create(user.id, { title: t.title, description: t.description, botId, priority: t.priority, deps: t.after.map((j) => ids[j]).filter(Boolean), kind: t.kind, batch: card.planId }).task.id;
    });
  } catch (e) {
    for (const id of [...ids].reverse()) if (id) { try { board.remove(user.id, id); } catch { /* left as is */ } }
    if (e instanceof BoardError) throw new PlanRefused(e.status === 413 ? 400 : e.status, wt(loc, e.message, e.vars));
    throw e;
  }
  const created = ids.filter(Boolean);
  const launch = b.launch === true;
  if (launch) board.launch(user.id, created);
  const kept = card.tasks.filter((_t, i) => keep.has(i));
  const proposed: TaskKind[] = [];
  for (const role of missingRoles(user.id, kept)) {
    try { proposeRoleBot(user, role); proposed.push(role); } catch { /* already proposed, or no main bot: the board shows « personne » */ }
  }
  const next: BoardPlanCard = { ...card, status: "created", taskIds: ids, launched: launch, proposedRoles: proposed };
  rows.updateCard(bot, row.generation, seq, () => next);
  rows.append(bot, { kind: "notice", tone: "info", text: gt(loc, launch ? "Plan put on the board and launched: {n} task(s)." : "Plan put on the board: {n} task(s).", { n: created.length }) }, row.thread ?? 0);
  audit(user.id, "account", `${bot.name}: plan "${card.title}" put on the board (${created.length} task(s)${launch ? ", launched" : ""})`, bot.id);
  return next;
}

export const boardPlanTools: BuiltinTool[] = [
  {
    spec: {
      name: "board_plan_propose",
      description: "Puts a work plan in front of the owner on a card, for the work board (« Tableau de travail »): a few tasks, each with its kind (code, review, research, docs, chore), optionally the team bot that should do it (by name), a priority (1 most urgent … 5) and the earlier tasks of the plan it must wait for. Nothing is created by this tool: the owner ticks the tasks to keep and puts them on the board (and launches them) from the card. Use it when the owner asks you to plan a piece of work for the team, or when a request clearly needs several steps or several bots. Then end your turn and wait.",
      inputSchema: {
        type: "object", required: ["title", "tasks"],
        properties: {
          title: { type: "string", description: "The plan's name, a few words" },
          why: { type: "string", description: "One line, in the owner's language: what the plan achieves" },
          tasks: {
            type: "array", description: `1 to ${MAX_PLAN_TASKS} tasks, in order`,
            items: {
              type: "object", required: ["title"],
              properties: {
                title: { type: "string", description: "What to do, a few words, in the owner's language" },
                description: { type: "string", description: "What done looks like and anything the bot needs" },
                kind: { type: "string", enum: [...TASK_KINDS] },
                bot: { type: "string", description: "Name of the team bot that should do it (optional: else the bot holding the role of its kind)" },
                priority: { type: "integer", minimum: 1, maximum: 5 },
                after: { type: "array", items: { type: "integer" }, description: "Numbers (from 1) of earlier tasks of this plan it waits for" },
              },
            },
          },
        },
      },
    },
    activity: "planning", label: "Proposing a plan for the board", detail: (a) => String(a.title ?? ""),
    run: async (a, c) => {
      const card = readPlan(c.user.id, a);
      if (typeof card === "string") return { content: card, isError: true };
      rows.append(c.bot, { kind: "card", card }, c.thread);
      const nobody = card.missingRoles.length ? ` Nobody holds the role(s) ${card.missingRoles.join(", ")} yet: if the owner puts the plan on the board, a proposal card for a bot per role is shown to them (nothing is created unless they accept).` : "";
      return { content: `The plan card (${card.tasks.length} task(s)) is in front of the owner. Nothing is on the board yet: they tick the tasks to keep and put them there.${nobody} End your turn now and wait.` };
    },
  },
];

export function registerBoardPlanRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  api.post("/bots/:id/rows/:seq/boardplan", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") return c.json({ error: "That bot does not exist." }, 404);
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    try { return c.json({ card: await answerPlan(bot, user, Number(c.req.param("seq")), body) }); }
    catch (e) { if (e instanceof PlanRefused) return c.json({ error: e.message }, e.status); throw e; }
  });
  api.post("/board/roles/:role/propose-bot", (c) => {
    try { return c.json(proposeRoleBot(c.get("user"), c.req.param("role"))); }
    catch (e) { if (e instanceof PlanRefused) return c.json({ error: e.message }, e.status); throw e; }
  });
}
