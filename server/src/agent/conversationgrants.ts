import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { ToolUseBlock } from "../llm/index.js";
import { assumeAlways } from "../policyassume.js";
import { CONVERSATION_GRANT_IDLE_MS, type ConversationGrantEnd, type ConversationGrantInfo } from "../conversationgranttypes.js";
import { audit, bots, clip, newId, now, rows, users, type ApprovalRecord } from "../store.js";
import { actionName, withoutQuote, type Ask, type Decision } from "./authorize.js";
import { actionHash } from "./executions.js";
import { actionFacts, floorReason, normalize, typedByUser, userWordsFor } from "./grounding.js";
import type { Turn } from "./loop.js";

/**
 * « Autoriser pour cette conversation »: the third answer on an approval card, between "once" and "always".
 *
 * A grant is the owner's click on a card, and nothing else creates one: no tool, no model output, no route a bot can
 * reach. It is bound to
 *
 *     account · bot · conversation (the bot's chat generation + thread) · tool · place
 *
 * where "place" is the very permission key an "always" rule would be saved under (`Gmail: mail_send`, `click: <host>`,
 * `web: <host>`, `vault: <login>`, `shell_run`…), so it is never wider than "always" — it is narrower: one tool, one
 * conversation, for a while.
 *
 * How it is applied (conversationGate, called by authorize.ts on a card that would otherwise be shown):
 *  - never on a card that does not offer "Always" either (`once`: the deterministic floor — payments, deletions, an
 *    unnamed recipient after outside content… —, strict gates, anything irreversible), and the floor is checked again
 *    here on its own;
 *  - only in a turn the owner started by writing in that conversation (never a routine, another bot, a system or
 *    resumed-by-itself turn, a workspace member, the Bot API, a helper);
 *  - only when a standing "always" on that key WOULD lift the ask: the decision is taken again under that assumption
 *    (policyassume.ts), with every other check running as usual. So where "always" is not honoured (a built-in app
 *    write after outside content, a command on the server itself, "ask first"…), neither is the grant;
 *  - after outside content (a tainted turn), only for the recipients the owner granted it on — or, when the action
 *    names no recipient, for that exact action.
 *
 * It ends when the conversation is cleared (its generation changes) or the bot is deleted, when the owner has written
 * nothing in that conversation for CONVERSATION_GRANT_IDLE_MS (the bot cannot keep it alive by using it), or when the
 * owner revokes it (Settings → Permissions). Kept in the database, so a restart neither loses nor widens anything.
 * Each use is written to the journal (decision "conversation", with the grant's id) and to the audit log.
 *
 * Additive table, created here (no numbered migration): `state` is "offered" (the card on screen could be answered
 * "for this conversation"), "active" or "ended".
 */
q.run(`CREATE TABLE IF NOT EXISTS conversation_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0,
  tool TEXT NOT NULL, place TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  targets TEXT NOT NULL DEFAULT '[]', hashes TEXT NOT NULL DEFAULT '[]', offer_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'offered', created_at INTEGER NOT NULL, granted_at INTEGER, last_used_at INTEGER,
  uses INTEGER NOT NULL DEFAULT 0, ended_at INTEGER, ended_reason TEXT)`);
q.run("CREATE INDEX IF NOT EXISTS conversation_grants_scope ON conversation_grants (bot_id, generation, thread, tool, place, state)");
q.run("CREATE INDEX IF NOT EXISTS conversation_grants_user ON conversation_grants (user_id, state)");

/** An offer nobody answered is forgotten after a day; an ended grant's line after a month (the audit log keeps the story). */
const OFFER_TTL_MS = 24 * 60 * 60_000;
const ENDED_TTL_MS = 30 * 24 * 60 * 60_000;
/** Recipients and exact actions remembered per grant (after outside content, only those pass). */
const MAX_REMEMBERED = 50;

interface GrantRow { id: string; userId: string; botId: string; generation: number; thread: number; tool: string; place: string; label: string; targets: string[]; hashes: string[]; state: "offered" | "active" | "ended"; grantedAt: number; lastUsedAt: number | null; uses: number }
const list = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const toRow = (r: any): GrantRow => ({ id: r.id, userId: r.user_id, botId: r.bot_id, generation: r.generation, thread: r.thread, tool: r.tool, place: r.place, label: r.label, targets: list(r.targets), hashes: list(r.hashes), state: r.state, grantedAt: r.granted_at ?? r.created_at, lastUsedAt: r.last_used_at ?? null, uses: r.uses });
const merged = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(-MAX_REMEMBERED);

/** Who or where an action goes to, as compared between the granted action and a later one. */
const targetsOf = (args: Record<string, unknown>) => actionFacts("", args).targets.map((t) => normalize(t)).filter(Boolean);

/** When the owner last wrote in that conversation (their own typed or spoken words only), or 0. */
function ownerLastWrote(g: Pick<GrantRow, "botId" | "generation" | "thread">): number {
  return rows.recentMessages(g.botId, g.generation, 40, g.thread).filter(typedByUser).reduce((m, r) => Math.max(m, r.createdAt), 0);
}
const expiryOf = (g: GrantRow) => Math.max(g.grantedAt, ownerLastWrote(g)) + CONVERSATION_GRANT_IDLE_MS;

function end(g: GrantRow, reason: ConversationGrantEnd) {
  if (!Number(q.run("UPDATE conversation_grants SET state = 'ended', ended_at = ?, ended_reason = ? WHERE id = ? AND state = 'active'", now(), reason, g.id).changes)) return;
  const bot = bots.byId(g.botId);
  const loc = users.localeOf(g.userId);
  const why = reason === "revoked" ? "revoked by you" : reason === "idle" ? "ended after {hours} h without a message from you" : reason === "cleared" ? "ended: the conversation was cleared" : "ended: the bot is gone";
  audit(g.userId, "approval", `${bot?.name ?? "—"} : ${g.place} — ${tr(loc, "permission for this conversation")} ${tr(loc, why, { hours: String(CONVERSATION_GRANT_IDLE_MS / 3_600_000) })} (${g.id})`, bot ? bot.id : null);
}

/** Whether an active grant still holds right now; ends it (and says why in the audit log) when it does not. */
function alive(g: GrantRow, at = now()): boolean {
  const bot = bots.byId(g.botId);
  if (!bot || bot.userId !== g.userId) { end(g, "bot_gone"); return false; }
  if (bot.generation !== g.generation) { end(g, "cleared"); return false; }
  if (at >= expiryOf(g)) { end(g, "idle"); return false; }
  return true;
}

export const conversationGrants = {
  /** The owner's active grants (the ones that lapsed meanwhile are ended first), newest first. */
  list(userId: string): ConversationGrantInfo[] {
    q.run("DELETE FROM conversation_grants WHERE (state = 'offered' AND created_at < ?) OR (state = 'ended' AND ended_at < ?)", now() - OFFER_TTL_MS, now() - ENDED_TTL_MS);
    return q.all("SELECT * FROM conversation_grants WHERE user_id = ? AND state = 'active' ORDER BY granted_at DESC, id", userId).map(toRow).filter((g) => alive(g))
      .map((g) => ({ id: g.id, botId: g.botId, botName: bots.byId(g.botId)?.name ?? "—", thread: g.thread, label: g.label, place: g.place, grantedAt: g.grantedAt, uses: g.uses, lastUsedAt: g.lastUsedAt, expiresAt: expiryOf(g) }));
  },
  /** "Retirer": only the caller's own grant; false for anyone else's or an unknown id (the route answers 404). */
  revoke(userId: string, id: string): boolean {
    const r = q.get("SELECT * FROM conversation_grants WHERE id = ? AND user_id = ? AND state = 'active'", id, userId);
    if (!r) return false;
    end(toRow(r), "revoked");
    return true;
  },
  /** The grant that covers this tool at this place in this conversation, if it still holds. */
  find(scope: { userId: string; botId: string; generation: number; thread: number }, tool: string, place: string): GrantRow | null {
    const r = q.get("SELECT * FROM conversation_grants WHERE user_id = ? AND bot_id = ? AND generation = ? AND thread = ? AND tool = ? AND place = ? AND state = 'active' ORDER BY granted_at DESC LIMIT 1", scope.userId, scope.botId, scope.generation, scope.thread, tool, place);
    const g = r ? toRow(r) : null;
    return g && alive(g) ? g : null;
  },
  /**
   * The owner answered this approval "for this conversation" (loop.ts decideApproval already took it as a yes for the
   * action itself). Turns the offer written when the card was shown into a grant; null when that card never offered it
   * (it then stays a plain "once"). Called by the approval route only, for the account's owner in person.
   */
  fromApproval(approval: ApprovalRecord): string | null {
    if (!approval.actionHash) return null;
    const bot = bots.byId(approval.botId);
    if (!bot || bot.userId !== approval.userId || bot.generation !== approval.generation) return null;
    const r = q.get("SELECT * FROM conversation_grants WHERE user_id = ? AND bot_id = ? AND generation = ? AND place = ? AND offer_hash = ? AND state = 'offered' AND created_at > ? ORDER BY created_at DESC LIMIT 1",
      approval.userId, bot.id, approval.generation, approval.tool, approval.actionHash, now() - OFFER_TTL_MS);
    if (!r) return null;
    const offer = toRow(r);
    const loc = users.localeOf(approval.userId);
    // The same tool at the same place in the same conversation, granted again (another recipient after outside
    // content): one grant, which now also covers what this card showed.
    const same = conversationGrants.find(offer, offer.tool, offer.place);
    let id = offer.id;
    if (same) {
      id = same.id;
      q.run("UPDATE conversation_grants SET targets = ?, hashes = ?, granted_at = ? WHERE id = ?", JSON.stringify(merged(same.targets, offer.targets)), JSON.stringify(merged(same.hashes, offer.hashes)), now(), same.id);
      q.run("DELETE FROM conversation_grants WHERE id = ?", offer.id);
    } else q.run("UPDATE conversation_grants SET state = 'active', granted_at = ? WHERE id = ? AND state = 'offered'", now(), offer.id);
    audit(approval.userId, "approval", `${bot.name} : ${offer.place} — ${tr(loc, "allowed for this conversation")} (${id})`, bot.id);
    rows.updateCard(bot, approval.generation, approval.seq, (c) => (c.type === "approval" ? { ...c, grantedFor: "conversation" as const } : c));
    return id;
  },
};

/** A turn the owner started by writing to their own bot: the only kind a grant is offered in, or applies to. */
const ownersTurn = (turn: Turn) => turn.origin === "user" && turn.user.id === turn.bot.userId && turn.bot.kind === "agent" && !turn.bot.parentId && !turn.engineCaller;

function labelOf(turn: Turn, name: string): string {
  const b = turn.builtin.get(name);
  const r = turn.remote.get(name);
  return clip(b ? tr(turn.user.locale, b.label) : r ? `${r.connectorName}: ${r.remoteName.replace(/_/g, " ")}` : name, 120);
}

/**
 * The last word on a card authorize.ts is about to show (`ask`). Either a grant of this conversation covers the action
 * (it runs, journalled with the grant), or the card is shown — offering "for this conversation" when that answer would
 * actually spare the next card. `probe`: takes the decision again (authorize.ts decide), here under the assumption of
 * an "always" rule on the card's key.
 */
export async function conversationGate(turn: Turn, call: ToolUseBlock, ask: Ask, probe: () => Promise<Decision>): Promise<Decision> {
  if (ask.once || ask.irreversible || !ownersTurn(turn)) return ask;
  const { user, bot } = turn;
  if (bots.byId(bot.id)?.generation !== turn.generation) return ask;
  const args = withoutQuote(call.input);
  // The deterministic floor, once more and on its own: nothing below may ever lift it.
  if (floorReason(actionName(turn, call.name, call.input), args, turn.tainted, userWordsFor(bot, turn.thread, Date.now(), { narrow: true }))) return ask;
  let lifted: Decision;
  try { lifted = await assumeAlways(user.id, ask.policyKey, probe); } catch { return ask; }
  if (lifted.kind !== "allow") return ask;
  const hash = actionHash(call.name, call.input);
  const targets = targetsOf(args);
  const scope = { userId: user.id, botId: bot.id, generation: turn.generation, thread: turn.thread };
  const g = conversationGrants.find(scope, call.name, ask.policyKey);
  // After outside content, what the bot read may be steering it: only what the owner saw on the card they granted.
  const covered = !!g && (!turn.tainted || (targets.length ? targets.every((t) => g.targets.includes(t)) : g.hashes.includes(hash)));
  if (g && covered) {
    q.run("UPDATE conversation_grants SET uses = uses + 1, last_used_at = ? WHERE id = ?", now(), g.id);
    return { kind: "allow", grant: { by: "conversation", grantId: g.id, reason: tr(user.locale, "you allowed it for this conversation ({place}, {id})", { place: g.place, id: g.id }) } };
  }
  // The card is shown. It may be answered "for this conversation": remembered here, so that only a card the server
  // itself offered it on can become a grant, for exactly what that card showed.
  q.run("DELETE FROM conversation_grants WHERE state = 'offered' AND bot_id = ? AND (offer_hash = ? OR created_at < ?)", bot.id, hash, now() - OFFER_TTL_MS);
  q.run("INSERT INTO conversation_grants (id, user_id, bot_id, generation, thread, tool, place, label, targets, hashes, offer_hash, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?)",
    newId("cgr"), user.id, bot.id, turn.generation, turn.thread, call.name, ask.policyKey, labelOf(turn, call.name), JSON.stringify(targets.slice(0, MAX_REMEMBERED)), JSON.stringify([hash]), hash, now());
  return { ...ask, conversation: true };
}
