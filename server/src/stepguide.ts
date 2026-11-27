/**
 * L153 carte « pas à pas » and L145 « premier bot qui liste et fait ce qui reste à installer » (ideas: Hermes, OpenClaw,
 * Noah, Rakazo, Nightly — our own code).
 *
 * A « pas à pas » card (guidetypes.ts) walks the owner through a fix, one short step at a time; each step names the
 * read-only check (guidechecks.ts) that confirms it worked, run when the owner presses « Vérifier ». Two kinds of guide:
 *  - "doctor:<checkId>": a Docteur line that says « À corriger » (doctor.ts). Settings → Docteur → « Pas à pas » puts the
 *    card in the main bot's chat (POST /doctor/guides/:checkId). Known lines have their own steps; any other gets « do
 *    what the Docteur says » then « check with the Docteur ».
 *  - "setup": what remains to install or set up for this account — a model, a model that answers, the bots' computers,
 *    two-factor sign-in, automatic backups (the last ones for the installation's owner only). The main bot shows it on
 *    the owner's request (« Ce qui reste à installer » in its welcome, POST /bots/:id/setup-guide) or by itself with the
 *    guide_show tool, and setup_status lets it read the list to talk the owner through it. Nothing on it is paid, and
 *    no step ever asks for a key or a password in the chat: those are typed in Settings (the step's `open`).
 * The bot never ticks a step itself: a server check, or the owner's « C'est fait » on a step nothing can see.
 *
 *  POST /doctor/guides/:checkId                          → { botId, seq }   (404 unknown line, 409 no main bot)
 *  POST /bots/:id/setup-guide                            → { seq }          (owner; an agent bot)
 *  POST /bots/:id/rows/:seq/stepguide { action: "check" | "self" | "dismiss", step? } → { card }
 */
import type { Hono } from "hono";
import { audit, bots, rows, type BotRecord, type UserRecord } from "./store.js";
import { computerKind } from "./computer.js";
import { doctorFindings } from "./doctor.js";
import { doctorFacts } from "./doctorroutes.js";
import { backupView } from "./autobackup.js";
import { isOperator } from "./hosted.js";
import { linuxReady } from "./linux.js";
import { cachedHealth, botModelRef } from "./modelhealth.js";
import { twoFactorOn } from "./twofactor.js";
import { isEngineRef } from "./agent/engine.js";
import { warmupOf } from "./enginewarmup.js";
import { knownCheck, mainAgent, modelsAvailable, runCheck } from "./guidechecks.js";
import { gt } from "./guidei18n.js";
import type { GuideStep, StepGuideCard } from "./guidetypes.js";
import type { BuiltinTool } from "./agent/tools.js";
import type { Locale } from "./shared.js";

type StepIn = Omit<GuideStep, "state" | "id" | "title" | "detail"> & { title: string; detail: string };
const step = (loc: Locale, i: number, s: StepIn, vars: Record<string, string | number> = {}): GuideStep => {
  if (!knownCheck(s.check)) throw new Error(`unknown check ${s.check}`);
  return { id: `s${i + 1}`, title: gt(loc, s.title, vars), detail: gt(loc, s.detail, vars), check: s.check, state: "todo", ...(s.command ? { command: s.command } : {}), ...(s.open ? { open: s.open } : {}) };
};

const DOCTOR_ID = /^[a-z0-9_.]{2,80}$/;
const checkLine = (id: string): StepIn => ({ title: "Check with the Docteur", detail: "« Vérifier » runs this Docteur line again.", check: `doctor:${id}` });
const RESTART: StepIn = { title: "Restart Sklubot", detail: "Stop Sklubot and start it again so it reads the change.", check: "self" };

/** The steps for one Docteur line (known lines have their own; others: do what it says, then check). */
export function doctorSteps(checkId: string, remediation?: string): StepIn[] {
  switch (checkId) {
    case "auth.session_secret": return [
      { title: "Make a strong secret", detail: "Type this on the machine that runs Sklubot:", command: "openssl rand -hex 32", check: "self" },
      { title: "Put it in the .env file as SESSION_SECRET", detail: "Open the .env file of Sklubot and replace the line SESSION_SECRET=… with the secret you just made. Do not paste it in the chat.", check: "self" },
      RESTART, checkLine(checkId)];
    case "account.two_factor": return [
      { title: "Install an authenticator app", detail: "On your phone: any authenticator app works (for example the one already on your phone). It is free.", check: "self" },
      { title: "Turn on two-factor sign-in", detail: "In Settings → Account: scan the code with an authenticator app on your phone, then type the 6 digits it shows.", check: "two_factor.on", open: "account" }];
    case "models.available": return [
      { title: "Connect an AI model", detail: "In Settings → Models: your Claude or ChatGPT subscription, or a key from a provider. Type the key there, never in the chat.", check: "models.available", open: "models" },
      { title: "Check that the model answers", detail: "« Vérifier » sends a tiny test message to your main bot's model (or looks at its engine's warm-up).", check: "model.answers" }];
    case "backup.recent": return [
      { title: "Set up automatic backups", detail: "In Settings → Account → Backups: choose where they go and switch them on.", check: "backup.ready", open: "account" }, checkLine(checkId)];
    case "disk.free": return [{ title: "Free some disk space", detail: "Delete old files you no longer need, or empty the bots' trash in Settings.", check: "self", open: "team" }, checkLine(checkId)];
    default: return [
      remediation ? { title: "Do what the Docteur says", detail: "Type this on the machine that runs Sklubot:", command: remediation, check: "self" } : { title: "Do what the Docteur says", detail: "Follow the steps in order; « Vérifier » tells you when it is fixed.", check: "self" },
      ...(/^(fs\.|auth\.|net\.|exec\.|data\.)/.test(checkId) ? [RESTART] : []), checkLine(checkId)];
  }
}

/** The « pas à pas » card for a Docteur line of this account; null: no such line (unknown, or not this person's to see). */
export function doctorGuide(user: UserRecord, checkId: string): StepGuideCard | null {
  if (!DOCTOR_ID.test(checkId)) return null;
  const loc = user.locale;
  const findings = doctorFindings(doctorFacts(user));
  const f = checkId === "models.available" ? { title: "doctor.models", remediation: undefined } : findings.find((x) => x.checkId === checkId);
  if (!f) return null;
  const title = f.title.replace(/\.ok$/, "");
  return { type: "stepguide", guideId: `doctor:${checkId}`, title: gt(loc, "Fix it step by step"), intro: gt(loc, "Follow the steps in order; « Vérifier » tells you when it is fixed."), doctorKey: title, status: "pending", steps: doctorSteps(checkId, f.remediation).map((s, i) => step(loc, i, s)) };
}

/** L145: what remains to set up for this account, the items already fine counted in `ready`. */
export async function setupGuide(user: UserRecord): Promise<StepGuideCard> {
  const loc = user.locale;
  const todo: StepIn[] = [];
  let ready = 0;
  const owner = isOperator(user.id);
  if (modelsAvailable(user.id)) ready++;
  else todo.push(doctorSteps("models.available")[0]);
  const main = mainAgent(user.id);
  const answers = main && (isEngineRef(botModelRef(main)) ? warmupOf(main.id).state === "ready" : cachedHealth(user.id, botModelRef(main))?.status === "ok");
  if (answers) ready++; else todo.push(doctorSteps("models.available")[1]);
  if (owner && computerKind() === "linux") {
    if ((await linuxReady()).ok) ready++;
    else todo.push({ title: "Prepare the bots' computers", detail: "On the machine that runs Sklubot, in the Sklubot folder, type this command once (it is free; it takes a few minutes).", command: "npm run computer:build", check: "computer.ready" });
  }
  if (twoFactorOn(user.id)) ready++; else todo.push(doctorSteps("account.two_factor")[1]);
  if (owner) { const b = backupView(); if (b.configured && b.enabled) ready++; else todo.push(doctorSteps("backup.recent")[0]); }
  return {
    type: "stepguide", guideId: "setup", title: gt(loc, "What remains to set up"), ready, status: todo.length ? "pending" : "done",
    intro: gt(loc, todo.length ? "Let's finish setting up, together. Each step has a « Vérifier » button that confirms it worked. Nothing here costs money, and keys or passwords are typed in Settings, never in this chat." : "Everything is set up: nothing remains to install."),
    steps: todo.map((s, i) => step(loc, i, s)),
  };
}

export class GuideRefused extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

/** The owner's « Vérifier » / « C'est fait » / « Fermer » on a card. Existence is checked before the input. */
export async function answerGuide(bot: BotRecord, user: UserRecord, seq: number, action: unknown, stepId: unknown): Promise<StepGuideCard> {
  const loc = user.locale;
  const row = Number.isInteger(seq) ? rows.get(bot.id, bot.generation, seq) : null;
  if (row?.body.kind !== "card" || row.body.card.type !== "stepguide") throw new GuideRefused(404, gt(loc, "There is no such card here."));
  const card = row.body.card;
  if (card.status === "dismissed") throw new GuideRefused(409, gt(loc, "This card is closed."));
  let next: StepGuideCard;
  if (action === "dismiss") next = { ...card, status: "dismissed" };
  else if (action === "check" || action === "self") {
    const s = card.steps.find((x) => x.id === stepId);
    if (!s) throw new GuideRefused(400, gt(loc, "Unknown step."));
    let changed: GuideStep;
    if (action === "self") {
      if (s.check !== "self") throw new GuideRefused(400, gt(loc, "This step is checked by the server: press « Vérifier »."));
      changed = { ...s, state: "ok", checkedAt: Date.now(), hint: undefined };
    } else {
      const r = s.check === "self" ? null : await runCheck(user, s.check);
      changed = r ? { ...s, state: r.ok ? "ok" : "notyet", hint: r.hint, checkedAt: Date.now() } : s;
    }
    const steps = card.steps.map((x) => (x.id === s.id ? changed : x));
    next = { ...card, steps, status: steps.every((x) => x.state === "ok") ? "done" : "pending" };
  } else throw new GuideRefused(400, gt(loc, "Unknown action."));
  rows.updateCard(bot, row.generation, seq, () => next);
  return next;
}

/** Puts a guide card in a bot's chat; returns its seq. */
const post = (bot: BotRecord, card: StepGuideCard, thread?: number): number => rows.append(bot, { kind: "card", card }, thread).seq;

// ── The bot's tools: read what remains, show a guide ────────────────────────────
const lines = (card: StepGuideCard) => card.steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}${s.command ? ` (command: ${s.command})` : ""}${s.check === "self" ? " [the owner confirms]" : ` [checked by the server: ${s.check}]`}`).join("\n");

export const guideTools: BuiltinTool[] = [
  {
    spec: {
      name: "setup_status",
      description: "Reads what remains to install or set up on this Sklubot account (a model, a model that answers, the bots' computers, two-factor sign-in, backups). Read-only. Use it when the owner asks what is left to set up, or on a fresh account, before guide_show.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    activity: "reading", label: "Looking at what remains to set up", parallel: true,
    run: async (_a, c) => {
      const card = await setupGuide(c.user);
      if (!card.steps.length) return { content: `Everything is set up (${card.ready} items fine). Nothing remains to install.` };
      return { content: `${card.steps.length} thing(s) remain (${card.ready} already fine):\n${lines(card)}\nShow them to the owner with guide_show {"guide":"setup"}: the card has the buttons and the checks. Never ask for a key, a password or a code in the chat — those are typed in Settings. Nothing here is paid.` };
    },
  },
  {
    spec: {
      name: "guide_show",
      description: "Shows the owner a step-by-step card (« pas à pas ») in this chat: each step says what to do and has a « Vérifier » button that confirms it worked (the server checks; you never tick a step). guide: \"setup\" (what remains to install on this account) or \"doctor:<checkId>\" (a Docteur line to fix, e.g. doctor:account.two_factor). After it, end your turn and wait; help the owner with the step they are on.",
      inputSchema: { type: "object", properties: { guide: { type: "string", description: "\"setup\" or \"doctor:<checkId>\"" } }, required: ["guide"] },
    },
    activity: "planning", label: "Showing a step-by-step guide", detail: (a) => String(a.guide ?? ""),
    run: async (a, c) => {
      const id = String(a.guide ?? "").trim();
      const card = id === "setup" ? await setupGuide(c.user) : id.startsWith("doctor:") ? doctorGuide(c.user, id.slice(7)) : null;
      if (!card) return { content: "There is no such guide. Use \"setup\", or \"doctor:<checkId>\" of a Docteur line that needs fixing.", isError: true };
      post(c.bot, card, c.thread);
      return { content: card.steps.length ? `The card with ${card.steps.length} step(s) is in front of the owner:\n${lines(card)}\nEnd your turn now; when they come back, help with the step they are on. Never ask for a key or a password in the chat.` : "The card says everything is set up: tell the owner in one line." };
    },
  },
];

export function registerStepGuideRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  api.post("/doctor/guides/:checkId", (c) => {
    const user = c.get("user");
    const card = doctorGuide(user, c.req.param("checkId") ?? "");
    if (!card) return c.json({ error: gt(user.locale, "This guide does not exist.") }, 404);
    const main = mainAgent(user.id);
    if (!main) return c.json({ error: gt(user.locale, "You have no main bot to show the guide.") }, 409);
    const seq = post(main, card);
    audit(user.id, "account", `Docteur: step-by-step guide for ${card.guideId} shown`, main.id);
    return c.json({ botId: main.id, seq });
  });
  api.post("/bots/:id/setup-guide", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") return c.json({ error: "That bot does not exist." }, 404);
    return c.json({ seq: post(bot, await setupGuide(user)) });
  });
  api.post("/bots/:id/rows/:seq/stepguide", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") return c.json({ error: "That bot does not exist." }, 404);
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    try { return c.json({ card: await answerGuide(bot, user, Number(c.req.param("seq")), b.action, b.step) }); }
    catch (e) { if (e instanceof GuideRefused) return c.json({ error: e.message }, e.status); throw e; }
  });
}
