import type { Hono } from "hono";
import { q } from "./db.js";
import type { Card } from "./shared.js";
import { bots, type UserRecord } from "./store.js";

/**
 * L139 — the « À toi » inbox (backlog A-FAIRE L139; behaviour from the Noah, Plannotator, OMB, Timon T60 audits, our own
 * code): every card that waits for the owner, across all their bots and group chats — approvals, questions, plans, screen
 * take-overs, app connections, secrets… — newest first, with the card's countdown when it has one. Answering stays where
 * it always was (the same routes as in the chat: approvals, cards/:seq/answer…), so nothing about who may answer changes.
 */
export interface InboxItem { botId: string; botName: string; seq: number; thread: number; createdAt: number; card: Card; kind: "approval" | "question" | "other" }

export const INBOX_MAX = 200;

/** The owner's waiting cards (current conversation of each bot). */
export function inboxOf(userId: string): InboxItem[] {
  const out: InboxItem[] = [];
  for (const b of bots.list(userId)) {
    const found = q.all<{ seq: number; thread: number; body: string; created_at: number }>("SELECT seq, thread, body, created_at FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'card' AND body LIKE '%\"status\":\"pending\"%' ORDER BY seq DESC LIMIT 50", b.id, b.generation);
    for (const r of found) {
      let card: Card | undefined;
      try { card = (JSON.parse(r.body) as { card?: Card }).card; } catch { continue; }
      if (!card || !("status" in card) || card.status !== "pending") continue;
      out.push({ botId: b.id, botName: b.name, seq: r.seq, thread: r.thread ?? 0, createdAt: r.created_at, card, kind: card.type === "approval" ? "approval" : card.type === "question" ? "question" : "other" });
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, INBOX_MAX);
}

export function registerInbox<E extends { Variables: { user: UserRecord } }>(api: Hono<E>) {
  api.get("/inbox", (c) => {
    const items = inboxOf(c.get("user").id);
    return c.json({ items, counts: { all: items.length, approval: items.filter((i) => i.kind === "approval").length, question: items.filter((i) => i.kind === "question").length, other: items.filter((i) => i.kind === "other").length } });
  });
}
