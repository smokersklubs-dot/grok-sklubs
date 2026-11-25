/**
 * « Chantier » — the planner turn: the planner bot reads the owner's brief and proposes what it understood (observations,
 * assumptions, open questions), the requirements with their acceptance check, the graph of tasks and each task's contract.
 * Nothing runs from it: the plan is a proposal the owner edits and approves on the chantier page (principle 3 and 4).
 *
 * The planner reconstructs BEHAVIOUR only (principle 1, Sklubot's clean-room rules): observable, testable requirements,
 * never another product's source code, prompts, texts, names or assets.
 *
 * It is one side request without tools (memory.ts ask, like the peer reviewer), counted in the chantier's cost; a bot that
 * is paused, held by a usage cap or by the hosted plan is not asked. When it cannot answer usably, the owner gets a blank
 * plan to fill in, with the reason.
 */
import { hostedHoldsBot, isPaused, tell } from "./agent/loop.js"; import type { Locale } from "./shared.js";
import { capHolds } from "./usagecaps.js";
import { bots, clip, now, rows, users, type BotRecord } from "./store.js";
import { ct } from "./chantieri18n.js";
import { applyLessons, chantiers, checkPlan, lessons, spend, usageBetween, type ChantierRecord } from "./chantiers.js";
import type { ChantierPlan } from "./chantiertypes.js";

export const PLANNER_MARK = "<chantier_planner>";

type Ask = (bot: BotRecord, system: string, prompt: string, selected: boolean) => Promise<string>;

const SHAPE = `{"observations":["what the brief says for sure"],"assumptions":["what you assume, to confirm"],"unknowns":[{"id":"q1","text":"question only the owner can answer"}],
"requirements":[{"id":"r1","text":"observable behaviour","acceptance":"how to check it"}],
"tasks":[{"key":"short-key","title":"…","role":"research|spec|build|check|other","botId":"<id from the team>","reviewerBotId":"<another bot id or empty>","deliverable":"…","resources":["file:… if two tasks touch the same thing"],"integration":false,
"contract":{"input":"…","output":"files it writes in its folder","scope":["what must not change"],"criteria":[{"id":"k1","text":"explicit criterion for the reviewer"}],
"checks":[{"id":"c1","kind":"file_exists|file_count|size_between|json_fields|same_order|text_present|image_size","label":"in plain words","path":"relative to the task's folder", "...":"the fields that kind needs"}]}}],
"edges":[{"from":"task-key","to":"task-key","artifact":"what passes: requirements, sources, code, failure report…"}],"maxAttempts":3}`;

export function plannerSystem(locale: Locale): string {
  return [
    PLANNER_MARK,
    `You plan a "chantier": a piece of work split between several bots. Write every text for the owner in ${locale === "fr" ? "French, simple words, tutoiement" : "English, simple words"}.`,
    "1. Turn the brief into observable, testable requirements. Keep apart what is observed (stated), assumed, and unknown (questions only the owner can answer). Every requirement has an acceptance check. Reconstruct behaviour only: never ask anyone to copy another product's source code, prompts, texts, names or assets.",
    "2. Give each participant (a bot of the team) a bounded job with a defined deliverable (research with sources, specification, build, check).",
    "3. Draw the graph: independent tasks have no link (they run in parallel), a task that needs another's result has a link naming the artifact that passes. Two tasks touching the same file name it in resources.",
    "4. Write each task's contract BEFORE anything runs: input, output (files it writes in its own folder), exact checks a program can run (file counts, sizes, JSON fields, order, texts, PNG sizes), explicit criteria for a reviewer bot (meaning, visual quality — the reviewer must be another bot), and the scope: what must not change.",
    "Check kinds: file_exists{path}; file_count{path, ext?, equals | countOf{path, field?}}; size_between{path, min?, max?}; json_fields{path, field?, fields[]}; same_order{path, field, other{path, field, task?}}; text_present{path, texts[] | textsOf{path, field}}; image_size{path, width, height}. A check may read another task's folder with task:\"key\" (an integration check).",
    "Use the owner's lessons below when they apply. Return only JSON, exactly this shape:",
    SHAPE,
    "</chantier_planner>",
  ].join("\n");
}

export function plannerPrompt(c: ChantierRecord): string {
  const team = bots.list(c.userId).filter((b) => b.kind === "agent" && !b.hidden).map((b) => ({ id: b.id, name: b.name, role: b.label || b.description.slice(0, 160), model: b.model || "default" }));
  const learnt = lessons.of(c.userId).map((l) => ({ rule: l.rule, appliesTo: l.appliesTo, evidence: clip(l.evidence, 300) }));
  return JSON.stringify({ title: c.title, brief: c.brief, team, lessons: learnt });
}

/** A blank plan the owner fills in (one task for the planner bot), when the planner gave nothing usable. */
export function blankPlan(c: ChantierRecord): ChantierPlan {
  return {
    observations: [], assumptions: [], unknowns: [], requirements: [],
    tasks: [{ key: "tache-1", title: c.title, role: "build", botId: c.plannerBotId, reviewerBotId: "", deliverable: "", contract: { input: c.brief.slice(0, 2000), output: "", checks: [], criteria: [], scope: [] }, resources: [] }],
    edges: [], maxAttempts: 3,
  };
}

/** Why a bot cannot take a side request now, in words, or null. */
export function unavailable(bot: BotRecord): string | null {
  const loc = users.localeOf(bot.userId);
  if (isPaused(bot)) return ct(loc, "{bot} is paused", { bot: bot.name });
  if (capHolds(bot)) return ct(loc, "{bot} reached a usage cap", { bot: bot.name });
  if (hostedHoldsBot(bot)) return ct(loc, "your plan holds {bot} for now", { bot: bot.name });
  return null;
}

/**
 * Runs the planner turn and stores the proposal (status « proposed »). Returns the problems the owner still has to fix
 * before approving. The owner is told in the planner bot's chat and by a notification.
 */
export async function planChantier(c: ChantierRecord, ask: Ask): Promise<string[]> {
  const loc = users.localeOf(c.userId);
  const planner = bots.byId(c.plannerBotId);
  let plan: ChantierPlan | null = null;
  let note = "";
  if (!planner || planner.userId !== c.userId) note = ct(loc, "The planner bot is gone: fill in the plan yourself.");
  else {
    const held = unavailable(planner);
    if (held) note = ct(loc, "The planner could not be asked ({why}): fill in the plan yourself, or ask again later.", { why: held });
    else {
      const t0 = now();
      try {
        const answer = await ask(planner, plannerSystem(loc), plannerPrompt(c), false);
        const raw = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
        plan = checkPlan(raw, c.userId, loc).plan;
        if (!plan.tasks.length) { plan = null; note = ct(loc, "The planner proposed no task: fill in the plan yourself."); }
      } catch (e) {
        note = ct(loc, "The planner's answer could not be read ({why}): fill in the plan yourself, or ask again.", { why: clip((e as Error).message, 120) });
      } finally {
        const u = usageBetween(planner.id, t0, now());
        if (u.costUsd || u.tokens) spend.add(c.id, "planner", u.costUsd, u.tokens);
      }
    }
  }
  const final = plan ?? blankPlan(c);
  applyLessons(c.userId, final);
  const { problems } = checkPlan(final, c.userId, loc);
  chantiers.set(c.id, { status: "proposed", plan: final, note });
  if (planner && planner.userId === c.userId) {
    rows.append(planner, { kind: "notice", tone: "info", text: ct(loc, "Chantier “{title}”: the plan is ready. Open it to read, edit and approve it — nothing starts before you approve.", { title: c.title }) }, 0);
    bots.bumpUnread(planner.id);
    tell({ type: "waiting", bot: planner, text: ct(loc, "Chantier “{title}”: the plan waits for your approval", { title: clip(c.title, 80) }) });
  }
  return problems;
}
