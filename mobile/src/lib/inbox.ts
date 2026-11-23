/**
 * « À toi » on the phone (web InboxView.tsx, server inboxroutes.ts, backlog L139): every card waiting for the owner across
 * all their bots. Pure helpers (tested): the tabs, the line shown for a card, and which approvals may be answered right
 * here with 👍 / 👎 — the same rule as on the web: a plain approval only (no editable draft, nothing irreversible);
 * anything richer opens the chat at that bot.
 */
import type { Card } from "../api/types";

export type InboxKind = "approval" | "question" | "other";
export interface InboxItem { botId: string; botName: string; seq: number; thread: number; createdAt: number; card: Card; kind: InboxKind }
export type InboxTab = "all" | InboxKind;
export const INBOX_TABS: InboxTab[] = ["all", "approval", "question", "other"];

export const inTab = (items: InboxItem[], tab: InboxTab) => items.filter((i) => tab === "all" || i.kind === tab);
export const countOf = (items: InboxItem[], tab: InboxTab) => inTab(items, tab).length;

/** The card's own words: its title, question, name or detail. */
export function inboxTitle(card: Card): string {
  if (card.type === "approval") return card.title;
  if (card.type === "question") return card.question;
  const c = card as Record<string, unknown>;
  for (const k of ["title", "name", "detail", "reason"]) if (typeof c[k] === "string" && (c[k] as string).trim()) return c[k] as string;
  return "";
}

/** 👍 / 👎 right in the list: a plain approval only (an editable draft or an irreversible action opens the chat). */
export function quickAnswer(card: Card): boolean {
  return card.type === "approval" && card.status === "pending" && !card.draft && !card.irreversible;
}

/** The request to answer an approval from the list (the same route as in the chat). */
export const decideRequest = (card: Card, decision: "allow" | "deny") =>
  card.type === "approval" ? { path: `/approvals/${encodeURIComponent(card.approvalId)}`, body: { decision } } : null;
