import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { ToolUseBlock } from "../llm/types.js";
import { approvals, bots, clip, now, rows, users, type ApprovalRecord, type BotRecord } from "../store.js";
import { withoutQuote } from "./authorize.js";
import type { Trigger } from "./turn-request.js";

/**
 * An approval card that waits for its owner — for as long as it takes.
 *
 * 1. A message typed while a card waits no longer cancels the card (it used to: the card "expired" and its action was
 *    skipped, even when the message was "oui"). The card stays valid and is answered with its buttons only: typed words
 *    are never an approval and never a refusal. The message is kept and handled right after the decision; the user is
 *    told so once per card (noteMessageBehindApproval). Loop.ts does the queueing: for a bot on an API model the message
 *    waits in the bot's queue behind the parked turn (deferred, on disk); for a bot on a subscription tool it waits with
 *    the words typed during the turn.
 *
 * 2. Approvals asked inside a subscription turn (Claude Code, Codex) used to live in memory only: they lapsed after
 *    APPROVAL_EXPIRE_MIN (25 min) and vanished at a restart. The tool's call cannot block for days — its process, and the
 *    time limit we give its tool calls (engine.ts TOOL_TIMEOUT_MS), end sooner — but the request can outlive the call:
 *    it is "parked". The exact call is kept here (parked_approvals, on disk), the card stays pending with a line saying
 *    the bot stopped waiting, and the tool is told to end its turn and wait. When the owner answers:
 *      - yes: the approval is recorded as allowed, still bound to the exact action (its hash) and single-use, and the
 *        bot gets a new turn in the same conversation asking it to make that same call again; the call then finds its
 *        approval (parkedGrant) and runs without a second card. Anything different asks again, as always.
 *      - no: the bot is told the action was refused.
 *    A card that truly cannot be picked up again (a request from a program through the credential relay, a turn started
 *    through the Bot API or by a workspace member, a conversation that was reset since) lapses as before; the card then
 *    says so and offers "Relancer" (web Cards.tsx).
 *
 * An approval that holds a paused turn of an API model was already on disk (store.ts paused) with no clock: nothing here
 * changes it.
 */

q.run("CREATE TABLE IF NOT EXISTS parked_approvals (approval_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, generation INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0, tool TEXT NOT NULL, input TEXT NOT NULL, origin TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, parked_at INTEGER)");
// Calls nobody came back for: forgotten after 30 days (the approvals themselves are kept, as before).
q.run("DELETE FROM parked_approvals WHERE created_at < ?", now() - 30 * 86_400_000);

interface ParkedCall { approval_id: string; bot_id: string; generation: number; thread: number; tool: string; input: string; origin: string; parked_at: number | null }
const callOf = (approvalId: string) => q.get<ParkedCall>("SELECT * FROM parked_approvals WHERE approval_id = ?", approvalId) ?? null;

/** What the turn that asks must look like for its request to be picked up again later: the owner's own conversation. */
interface AskingTurn { bot: BotRecord; generation: number; thread: number; origin?: string; engineCaller?: string }

/** A subscription turn asks for an approval: the exact call is kept, so the request can outlive the call that waits. */
export function rememberCall(approvalId: string, turn: AskingTurn, call: ToolUseBlock) {
  // A Bot API or workspace-member conversation has its own session, which a later system turn cannot reach: not parked.
  if (turn.engineCaller || turn.origin === "api" || turn.origin === "member") return;
  q.run("INSERT OR REPLACE INTO parked_approvals (approval_id, bot_id, generation, thread, tool, input, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    approvalId, turn.bot.id, turn.generation, turn.thread, call.name, JSON.stringify(call.input), turn.origin ?? "", now());
}
/** The request was settled while its call still waited (or lapsed for good): nothing to keep. */
export const forgetCall = (approvalId: string) => { q.run("DELETE FROM parked_approvals WHERE approval_id = ?", approvalId); };

/**
 * The call stopped waiting (no answer in time, or the server restarted): the request stays open on its card. False when
 * this approval cannot be parked (nothing kept for it, or it is no longer pending): the caller lets it lapse.
 */
export function parkApproval(approvalId: string): boolean {
  const a = approvals.byId(approvalId);
  const kept = callOf(approvalId);
  if (!a || a.status !== "pending" || !kept) return false;
  q.run("UPDATE parked_approvals SET parked_at = COALESCE(parked_at, ?) WHERE approval_id = ?", now(), approvalId);
  const bot = bots.byId(a.botId);
  if (bot) rows.updateCard(bot, a.generation, a.seq, (c) => (c.type === "approval" ? { ...c, parked: true } : c));
  return true;
}
/** Whether an answer to this approval can still be acted on although no call waits for it: parked, same conversation. */
export function isParked(a: ApprovalRecord, bot: BotRecord): boolean {
  const kept = callOf(a.id);
  return !!kept && kept.parked_at !== null && kept.generation === bot.generation;
}

const describe = (kept: ParkedCall) => {
  let input: Record<string, unknown> = {};
  try { input = JSON.parse(kept.input) as Record<string, unknown>; } catch { /* unreadable: the tool's name alone */ }
  return { input, shown: clip(JSON.stringify(withoutQuote(input)), 1500) };
};

/**
 * The owner answered a parked approval (`status`: "allowed", "always" or "denied"): the work the bot gets for it — a turn
 * in the conversation the request came from, with the origin of the work it continues. Null when nothing was parked.
 */
export function parkedResume(approvalId: string, status: string): Trigger | null {
  const kept = callOf(approvalId);
  if (!kept || kept.parked_at === null) return null;
  const { input, shown } = describe(kept);
  const base = { kind: "system" as const, thread: kept.thread || undefined, resumeOf: "steps" as const, origin: kept.origin || "resume", tainted: true };
  if (status !== "allowed" && status !== "always") {
    forgetCall(approvalId);
    return { ...base, text: `Your owner has now answered the request that was waiting on its card: they REFUSED the action ${kept.tool} (${shown}). Do not try it again or look for a way around it — carry on with the work another way, or tell the user what could not be done.` };
  }
  return { ...base, text: `Your owner has now answered the request that was waiting on its card: they ALLOWED the action ${kept.tool}. Do it now — call ${kept.tool} once, with exactly these arguments and nothing else changed (the approval covers this exact call, a single time): ${clip(JSON.stringify(input), 6000)}\nThen carry on with the work it was part of, and tell the user what was done.` };
}

/**
 * The parked approval, already allowed by the owner and not used yet, that covers exactly this action of this bot (its
 * hash); null when there is none. The caller still has to consume it (store.ts approvals.consume: single use, same hash).
 */
export function parkedGrant(botId: string, actionHash: string): string | null {
  return q.get<{ id: string }>(
    "SELECT a.id FROM approvals a JOIN parked_approvals p ON p.approval_id = a.id WHERE a.bot_id = ? AND a.status IN ('allowed', 'always') AND a.consumed_at IS NULL AND a.action_hash = ? AND p.parked_at IS NOT NULL ORDER BY a.resolved_at DESC LIMIT 1",
    botId, actionHash)?.id ?? null;
}

/** The parked requests of a bot (it is being deleted, or its task cancelled: the caller lets them lapse). */
export const parkedOf = (botId: string): string[] => q.all<{ approval_id: string }>("SELECT approval_id FROM parked_approvals WHERE bot_id = ? AND parked_at IS NOT NULL", botId).map((r) => r.approval_id);

/** What the subscription tool is told when its call stops waiting for an answer that has not come yet. */
export const PARKED = "The user has not answered this request yet. It stays open on its card: nothing was refused and nothing was done. Do NOT try this action again and do not look for a way around it. Finish what you can without it, then end your turn and tell the user you are waiting for their answer on the card. You will be told as soon as they decide.";

// ── A message typed while a card waits ───────────────────────────────────────
/** Cards whose owner was already told that their message waits behind it (one line per card, not one per message). */
const told = new Set<string>();

/**
 * The owner wrote to a bot that waits on an approval: the card stays open, the message is kept for after the decision,
 * and the chat says so — once per card. `pending`: the approvals this bot's turn is waiting on now (not parked ones:
 * nothing waits behind those, a message is answered at once).
 */
export function noteMessageBehindApproval(bot: BotRecord, thread: number, pending: string[]) {
  const fresh = pending.filter((id) => !told.has(id));
  if (!pending.length || !fresh.length) return;
  for (const id of pending) told.add(id);
  if (told.size > 5000) told.clear();
  rows.append(bot, { kind: "notice", tone: "info", text: tr(users.localeOf(bot.userId), "Your message is kept: I will read it as soon as you have answered the request above with its buttons. Typed words never count as a yes or a no.") }, thread || undefined);
}

