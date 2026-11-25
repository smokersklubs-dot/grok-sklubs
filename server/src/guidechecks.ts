/**
 * L153 « pas à pas » / L145 « ce qui reste à installer »: the checks a step of a guide can name (guidetypes.ts). Each one
 * only LOOKS (read-only, nothing is changed, nothing is sent outside but the model check's tiny test message, the same
 * one modelhealth.ts sends at start-up) and answers ok or not, with a short line saying what it saw, in the owner's
 * language. A check never returns a path, an address or a secret.
 *
 *  models.available   one of the account's bots has a model it can use (the default one when there is no bot yet)
 *  model.answers      the main bot's model answers (modelhealth.ts), or, for a subscription engine, it is warmed up
 *  bot.exists         the account has at least one bot
 *  two_factor.on      two-factor sign-in is on
 *  backup.ready       automatic backups are set up and on                (installation owner only)
 *  backup.recent      a backup worked in the last 3 days                  (installation owner only)
 *  computer.ready     the bots' computers can start (Docker and the image) (installation owner only)
 *  doctor:<checkId>   that line of the Docteur (doctor.ts) is fine now
 *  self               nothing to look at: the owner says « C'est fait » (never run here)
 */
import { backupView } from "./autobackup.js";
import { computerKind } from "./computer.js";
import { doctorFindings } from "./doctor.js";
import { doctorFacts } from "./doctorroutes.js";
import { isEngineRef } from "./agent/engine.js";
import { warmupOf } from "./enginewarmup.js";
import { gt } from "./guidei18n.js";
import { isOperator } from "./hosted.js";
import { linuxReady } from "./linux.js";
import { defaultModelRef, modelAvailable } from "./llm/index.js";
import { botHealth, botModelRef } from "./modelhealth.js";
import { bots, type UserRecord } from "./store.js";
import { twoFactorOn } from "./twofactor.js";

export interface CheckResult { ok: boolean; hint: string }
type Check = (user: UserRecord) => CheckResult | Promise<CheckResult>;
const DAY = 86_400_000;
const say = (user: UserRecord, ok: boolean, yes: string, no: string, vars: Record<string, string | number> = {}): CheckResult => ({ ok, hint: gt(user.locale, ok ? yes : no, vars) });
const ownerOnly = (fn: Check): Check => (user) => (isOperator(user.id) ? fn(user) : { ok: false, hint: gt(user.locale, "Only the owner of this installation can check this.") });

const agents = (userId: string) => bots.list(userId).filter((b) => b.kind === "agent");
/** The bot the setup list talks about: the main bot, else the first agent. */
export const mainAgent = (userId: string) => { const list = agents(userId); return list.find((b) => b.primary) ?? list[0] ?? null; };

/** For the setup list: whether one of the bots (or the default model) can run. Exported for stepguide.ts. */
export function modelsAvailable(userId: string): boolean {
  const list = agents(userId);
  const refs = list.length ? list.map(botModelRef) : [defaultModelRef()];
  return refs.some((r) => isEngineRef(r) || modelAvailable(r, userId));
}

const CHECKS: Record<string, Check> = {
  "models.available": (u) => say(u, modelsAvailable(u.id), "Your bots have a model they can use.", "No model answers yet for your bots."),
  "bot.exists": (u) => say(u, agents(u.id).length > 0, "You have at least one bot.", "You have no bot yet."),
  "model.answers": async (u) => {
    const bot = mainAgent(u.id);
    if (!bot) return say(u, false, "", "You have no bot yet.");
    if (isEngineRef(botModelRef(bot))) {
      const w = warmupOf(bot.id);
      return w.state === "ready" ? say(u, true, "The model answered.", "") : say(u, false, "", "The engine is not warmed up yet: {state}.", { state: w.reason ?? w.state });
    }
    const h = await botHealth(bot, u, true);
    return h.status === "ok" ? say(u, true, "The model answered.", "") : say(u, false, "", "The model does not answer yet: {reason}", { reason: h.reason ?? h.status });
  },
  "two_factor.on": (u) => say(u, twoFactorOn(u.id), "Two-factor sign-in is on.", "Two-factor sign-in is still off."),
  "backup.ready": ownerOnly((u) => { const b = backupView(); return say(u, b.configured && b.enabled, "Automatic backups are set up and on.", "Automatic backups are not set up or are switched off."); }),
  "backup.recent": ownerOnly((u) => { const b = backupView(); const at = b.lastOk?.startedAt ?? 0; return say(u, !!at && Date.now() - at < 3 * DAY, "A backup worked in the last 3 days.", "No backup worked in the last 3 days."); }),
  "computer.ready": ownerOnly(async (u) => {
    if (computerKind() !== "linux") return { ok: true, hint: gt(u.locale, "This installation does not use bot computers: nothing to do.") };
    const r = await linuxReady();
    return say(u, r.ok, "The bots' computers are ready.", "The bots' computers are not ready: {reason}.", { reason: r.ok ? "" : r.reason.replace(/\(run: [^)]*\)/, "").trim() });
  }),
};

const DOCTOR = /^doctor:([a-z0-9_.]{2,80})$/;
/** Whether a step may name this check ("self" included). */
export const knownCheck = (key: string) => key === "self" || key in CHECKS || DOCTOR.test(key);

/** Runs one check now. Unknown → not ok (never thrown). */
export async function runCheck(user: UserRecord, key: string): Promise<CheckResult> {
  if (key in CHECKS) return CHECKS[key](user);
  const m = DOCTOR.exec(key);
  if (m) {
    // The models line is not in doctor.ts's facts (the web adds it): the same question as models.available.
    if (m[1] === "models.available") return CHECKS["models.available"](user);
    const bad = doctorFindings(doctorFacts(user)).filter((f) => f.checkId === m[1] && f.severity !== "ok");
    return say(user, bad.length === 0, "The Docteur line is fine now.", "The Docteur still says: to fix.");
  }
  return { ok: false, hint: gt(user.locale, "Unknown check.") };
}
