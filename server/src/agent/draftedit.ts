import { q } from "../db.js";
import type { ToolUseBlock } from "../llm/index.js";
import { approvals, audit, bots, clip, paused, rows } from "../store.js";
import { withoutQuote } from "./authorize.js";
import { actionHash } from "./executions.js";
import { describeArgs } from "./loop.js";

/**
 * L83 — the draft is editable inside the approval card (backlog A-FAIRE L83; behaviour from the Rakazo and Hermes audits,
 * our own code).
 *
 * An approval card for sending an email or a message (Gmail / Outlook mail_send, mail_draft, mail_draft_update, Slack
 * slack_post, the bot's own bot_email_send) shows its subject and text in fields the owner can correct before saying yes.
 * Only the words change — never the recipients, the account, the tool or anything else. On "Allow" with an edited text:
 * - the waiting call's arguments are replaced by the edited words (they ARE the approved action);
 * - its fingerprint (executions.ts actionHash) is recomputed and the approval re-bound to it, so the single-use, exact-
 *   action check (approvals.consume) still holds — for the edited text and nothing else;
 * - L29 (native/mailproof.ts) keeps working unchanged: it compares the message built for the wire with these (edited)
 *   arguments, so what leaves is exactly the text the owner approved.
 * Editing is offered only while the turn waits on the card on disk (a paused turn); a subscription turn waiting live
 * cannot take an edit, and its card shows the text read-only.
 */
const EDITABLE: { match: RegExp; fields: string[] }[] = [
  { match: /__(mail_send|mail_draft|mail_draft_update)$/, fields: ["subject", "body"] },
  { match: /__slack_post$/, fields: ["text"] },
  { match: /^bot_email_send$/, fields: ["subject", "body"] },
];
export const MAX_DRAFT = 50_000;

/** The words of this call the owner may edit on its card ({} when none). */
export function draftOf(call: Pick<ToolUseBlock, "name" | "input">): Record<string, string> {
  const rule = EDITABLE.find((r) => r.match.test(call.name));
  if (!rule) return {};
  const out: Record<string, string> = {};
  for (const f of rule.fields) if (typeof call.input[f] === "string") out[f] = String(call.input[f]);
  return out;
}
/** The card's extra field (spread into the approval card): nothing for a call without editable words. */
export const draftField = (call: Pick<ToolUseBlock, "name" | "input">) => { const d = draftOf(call); return Object.keys(d).length ? { draft: d } : {}; };

interface Waiting { pending: ToolUseBlock[]; approvalId: string }

/**
 * Applies the owner's edited words to the call that waits on this approval, before it is allowed. Returns null when done
 * (or nothing changed), else why it cannot (the route answers 409 with it).
 */
export function applyDraftEdit(userId: string, approvalId: string, edited: unknown): string | null {
  if (!edited || typeof edited !== "object") return null;
  const a = approvals.byId(approvalId);
  if (!a || a.userId !== userId || a.status !== "pending") return "This request no longer waits for an answer.";
  const bot = bots.byId(a.botId);
  const lane = bot ? paused.lanes<Waiting>(bot.id).find((l) => l.state.approvalId === approvalId) : undefined;
  const call = lane?.state.pending[0];
  if (!bot || !lane || !call) return "This text cannot be edited here: refuse it and tell the bot what to change.";
  const allowed = draftOf(call);
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(edited as Record<string, unknown>)) {
    if (!(k in allowed) || typeof v !== "string") return `Only the words can be edited (${Object.keys(allowed).join(", ") || "nothing here"}).`;
    if (v.length > MAX_DRAFT) return "That text is too long.";
    if (v !== allowed[k]) changes[k] = v;
  }
  if (!Object.keys(changes).length) return null;
  if ("body" in changes && !changes.body.trim()) return "The text cannot be empty.";
  call.input = { ...call.input, ...changes };
  const hash = actionHash(call.name, call.input);
  q.tx(() => {
    paused.set(lane.key, lane.state);
    q.run("UPDATE approvals SET action_hash = ? WHERE id = ? AND status = 'pending'", hash, approvalId);
  });
  rows.updateCard(bot, a.generation, a.seq, (c) => (c.type === "approval" ? { ...c, draft: { ...(c.draft ?? {}), ...changes }, edited: true, detail: clip(describeArgs(withoutQuote(call.input)), 9000) } : c));
  audit(userId, "approval", `${bot.name}: ${a.tool} — text edited on the card before approving`, bot.id);
  return null;
}
