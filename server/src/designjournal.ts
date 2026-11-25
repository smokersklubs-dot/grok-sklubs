import { randomBytes } from "node:crypto";
import { q } from "./db.js";
import type { BuiltinTool } from "./agent/tools.js";
import type { ToolSpec } from "./llm/types.js";
import { now } from "./store.js";

/**
 * L157 « journal de design par compte » (backlog A-FAIRE): the design decisions of an account — colours, fonts, layout,
 * anything else ("tutoiement", "photos plutôt qu'illustrations") — kept in one place and reused by every bot of the
 * account for its next pages. A bot writes one down when the user chooses or approves something (design_journal add);
 * every page_publish / artifact_create of a NEW page gets the journal back in its result, with a warning when the page
 * uses none of the journal's colours. The owner reads, adds and removes decisions in Réglages → Pages.
 *
 * One account's journal is never shown to another account (every query is by user_id).
 */
export const DESIGN_TOPICS = ["colors", "fonts", "layout", "other"] as const;
export type DesignTopic = (typeof DESIGN_TOPICS)[number];
export interface DesignDecision { id: string; topic: DesignTopic; decision: string; why: string; by: "user" | "bot"; botId: string | null; createdAt: number }
export const DESIGN_MAX = 60;

q.run("CREATE TABLE IF NOT EXISTS design_journal (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic TEXT NOT NULL, decision TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', by_kind TEXT NOT NULL, bot_id TEXT, created_at INTEGER NOT NULL)");
q.run("CREATE INDEX IF NOT EXISTS design_journal_user ON design_journal (user_id, created_at)");

export class DesignJournalError extends Error {}
const row = (r: { id: string; topic: string; decision: string; why: string; by_kind: string; bot_id: string | null; created_at: number }): DesignDecision =>
  ({ id: r.id, topic: (DESIGN_TOPICS as readonly string[]).includes(r.topic) ? (r.topic as DesignTopic) : "other", decision: r.decision, why: r.why, by: r.by_kind === "bot" ? "bot" : "user", botId: r.bot_id, createdAt: r.created_at });

export const designJournal = {
  list: (userId: string): DesignDecision[] => q.all<Parameters<typeof row>[0]>("SELECT * FROM design_journal WHERE user_id = ? ORDER BY created_at DESC, rowid DESC", userId).map(row),
  add(userId: string, input: { topic?: unknown; decision?: unknown; why?: unknown }, by: { kind: "user" | "bot"; botId?: string }): DesignDecision {
    const topic = (DESIGN_TOPICS as readonly unknown[]).includes(input.topic) ? (input.topic as DesignTopic) : null;
    if (!topic) throw new DesignJournalError("topic must be colors, fonts, layout or other.");
    const decision = String(input.decision ?? "").replace(/\s+/g, " ").trim();
    if (decision.length < 2) throw new DesignJournalError("Write the decision (a few words at least).");
    if (decision.length > 300) throw new DesignJournalError("A decision is 300 characters at most.");
    const why = String(input.why ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const same = q.get<{ id: string }>("SELECT id FROM design_journal WHERE user_id = ? AND topic = ? AND decision = ?", userId, topic, decision);
    if (same) return designJournal.list(userId).find((d) => d.id === same.id)!;
    if ((q.get<{ n: number }>("SELECT COUNT(*) AS n FROM design_journal WHERE user_id = ?", userId)?.n ?? 0) >= DESIGN_MAX) throw new DesignJournalError("The design journal is full (60 decisions): remove an old one first.");
    const id = `dj_${randomBytes(8).toString("hex")}`;
    q.run("INSERT INTO design_journal (id, user_id, topic, decision, why, by_kind, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, userId, topic, decision, why, by.kind, by.botId ?? null, now());
    return designJournal.list(userId).find((d) => d.id === id)!;
  },
  /** Removes one of the account's decisions; false when the account has no such decision. */
  remove: (userId: string, id: string): boolean => q.run("DELETE FROM design_journal WHERE user_id = ? AND id = ?", userId, id).changes > 0,
};

const TOPIC_WORD: Record<DesignTopic, string> = { colors: "Colours", fonts: "Fonts", layout: "Layout", other: "Other" };
/** The journal in a few lines, by topic (what a bot reads). */
export function journalText(list: DesignDecision[]): string {
  if (!list.length) return "";
  return DESIGN_TOPICS.map((t) => {
    const items = list.filter((d) => d.topic === t);
    return items.length ? `${TOPIC_WORD[t]}: ${items.map((d) => `${d.decision}${d.why ? ` (${d.why})` : ""} [${d.id}]`).join("; ")}` : "";
  }).filter(Boolean).join("\n");
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const norm = (h: string) => { const x = h.toLowerCase(); return x.length === 4 ? `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}` : x; };
/** The journal's colour codes the page does not use, when it uses none of them (else []). */
export function journalColoursMissing(list: DesignDecision[], pageText: string): string[] {
  const wanted = [...new Set(list.filter((d) => d.topic === "colors").flatMap((d) => d.decision.match(HEX) ?? []).map(norm))];
  if (!wanted.length) return [];
  const used = new Set((pageText.match(HEX) ?? []).map(norm));
  return wanted.some((h) => used.has(h)) ? [] : wanted;
}

/** What a NEW page's publish result adds: the journal to keep to, and a warning when none of its colours is used. */
export function journalNoteForNewPage(userId: string, pageText: string): string {
  const list = designJournal.list(userId);
  if (!list.length) return "";
  const missing = journalColoursMissing(list, pageText);
  return `\n\nDesign journal of this account (decisions the user made for earlier pages; keep to them unless the user asks otherwise):\n${journalText(list)}${missing.length ? `\nThis page uses none of the journal's colours (${missing.join(", ")}): use them, with page_edit, unless the user asked for different ones.` : ""}`;
}

// ── The bot's tool ──
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
export const designJournalTools: BuiltinTool[] = [{
  spec: {
    name: "design_journal",
    description: "The account's design journal: the decisions the user made on colours, fonts and layout for earlier pages, shared by all their bots. Read it before you make a new page, slides or a mini-site, and follow it. Add a decision when the user chooses or approves a colour, a font, a layout or a style rule (e.g. topic colors, decision \"Bleu nuit #1e3a5f pour les titres, fond crème #faf7f0\"). Remove one only when the user says it no longer holds.",
    inputSchema: obj({
      action: { type: "string", enum: ["read", "add", "remove"], description: "read (default), add or remove" },
      topic: { type: "string", enum: [...DESIGN_TOPICS], description: "For add: colors, fonts, layout or other" },
      decision: { type: "string", description: "For add: the decision in a few words, with exact values (colour codes, font names, sizes)" },
      why: { type: "string", description: "For add: optional, why (the user's words)" },
      id: { type: "string", description: "For remove: the decision's id, as read shows it ([dj_…])" },
    }),
  },
  activity: "reading", label: "Design journal", group: "pages", detail: (a) => String(a.action ?? "read"),
  run: async (a, c) => {
    const action = a.action === "add" || a.action === "remove" ? a.action : "read";
    try {
      if (action === "add") { const d = designJournal.add(c.user.id, a, { kind: "bot", botId: c.bot.id }); return { content: `Noted in the design journal (${d.topic}): ${d.decision} [${d.id}]. Every bot of this account will keep to it for its next pages.`, summary: d.topic }; }
      if (action === "remove") return designJournal.remove(c.user.id, String(a.id ?? "")) ? { content: "Removed from the design journal.", summary: "removed" } : { content: "There is no such decision in the journal (read it to see the ids).", isError: true };
    } catch (e) { if (e instanceof DesignJournalError) return { content: e.message, isError: true }; throw e; }
    const list = designJournal.list(c.user.id);
    return { content: list.length ? `Design journal of this account (${list.length} decision${list.length > 1 ? "s" : ""}):\n${journalText(list)}` : "The design journal is empty: no colour, font or layout decision yet. Ask the user, or propose one and note it once they approve.", summary: `${list.length}` };
  },
}];
