import { emit, getLive } from "../bus.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { defaultModelRef, resolveModel, type ChatMessage } from "../llm/index.js";
import type { MemoryStatus } from "../shared.js";
import { bots, clip, history, memories, now, paused, rows, type BotRecord } from "../store.js";
import { record } from "../usage.js";
import { isBusy } from "./loop.js";

/** A short side request to the model (summaries, fact extraction): no tools, low effort. */
async function ask(bot: BotRecord, system: string, prompt: string): Promise<string> {
  const { provider, model } = resolveModel(config.auxModel || bot.model || defaultModelRef());
  const res = await provider.runTurn({ model, system, tools: [], effort: "low", maxTokens: 8000, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], signal: AbortSignal.timeout(180_000) });
  record(bot.userId, bot.id, res.model, res.usage);
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}

// ── Conversation compaction ──────────────────────────────────────────────────
/** Rough size of the model-facing history. Image data is not counted byte for byte. */
export function historyChars(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages)
    for (const b of m.content) {
      if (b.type === "text") n += b.text.length;
      else if (b.type === "tool_use") n += JSON.stringify(b.input).length + 40;
      else if (b.type === "tool_result") for (const c of b.content) n += c.type === "text" ? c.text.length : 30;
      else if (b.type === "image") n += 6000;
    }
  return n;
}

function render(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages)
    for (const b of m.content) {
      if (b.type === "text") lines.push(`${m.role === "user" ? "USER" : "BOT"}: ${b.text}`);
      else if (b.type === "tool_use") lines.push(`BOT used ${b.name}: ${clip(JSON.stringify(b.input), 400)}`);
      else if (b.type === "tool_result") lines.push(`RESULT${b.isError ? " (failed)" : ""}: ${clip(b.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" "), 600)}`);
    }
  const all = lines.join("\n");
  return all.length > 200_000 ? "[earlier part cut]\n" + all.slice(-200_000) : all;
}

const SUMMARY_MARK = "[Automatic summary of the earlier conversation — treat it as your own notes]";
const cooldown = new Map<string, number>();

/**
 * When the conversation outgrows its budget, everything except the last few exchanges is replaced by
 * a dense summary. Runs only between turns, never while tool calls are open. The visible chat is untouched.
 */
export async function compactIfNeeded(bot: BotRecord, force = false): Promise<{ before: number; after: number; changed: boolean }> {
  const all = history.load(bot.id, bot.generation);
  const same = { before: all.length, after: all.length, changed: false };
  if (paused.get(bot.id)) return same;
  if (!force && (historyChars(all) < config.compactChars || (cooldown.get(bot.id) ?? 0) > now())) return same;

  // Cut only at the start of a user turn, so no tool call is separated from its result.
  const turnStarts = all.map((m, i) => (m.role === "user" && !m.content.some((b) => b.type === "tool_result") ? i : -1)).filter((i) => i > 0);
  let keep = Math.min(config.compactKeepTurns, turnStarts.length);
  let cut = keep > 0 ? turnStarts[turnStarts.length - keep] : all.length;
  // If the recent turns alone are still too big, keep fewer of them.
  while (keep > 0 && historyChars(all.slice(cut)) > config.compactChars * 0.35) {
    keep--;
    cut = keep > 0 ? turnStarts[turnStarts.length - keep] : all.length;
  }
  const last = all[all.length - 1];
  if (cut >= all.length && last?.role === "assistant" && last.content.some((b) => b.type === "tool_use")) return same;
  const older = all.slice(0, cut);
  if (older.length < 2) return same;

  let summary: string;
  try {
    summary = await ask(bot,
      "You compress a long working conversation between a user and their AI teammate into notes the teammate will rely on afterwards. Be dense and factual. Never include passwords, keys or other secrets.",
      `Write the notes in the teammate's own voice ("I…"), under about 1,500 words. Cover: who the user is; their goals, preferences and standing instructions; decisions made; concrete facts, names, numbers, links, file paths and ids; what was done with which tools and how it turned out, including failures and what should not be retried; and everything still open or promised.\n\nConversation:\n${render(older)}`);
  } catch (err) {
    cooldown.set(bot.id, now() + 10 * 60_000);
    throw err;
  }
  if (!summary) return same;
  // Only commit if nothing was appended while the summary was being written.
  if (history.count(bot.id, bot.generation) !== all.length) return same;
  const next: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: `${SUMMARY_MARK}\n${summary}` }] }, ...all.slice(cut)];
  history.replace(bot.id, bot.generation, next);
  q.run("INSERT INTO compactions (bot_id, generation, at, before_items, after_items) VALUES (?, ?, ?, ?, ?)", bot.id, bot.generation, now(), all.length, next.length);
  return { before: all.length, after: next.length, changed: true };
}

export function memoryStatus(bot: BotRecord): MemoryStatus {
  const mark = q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", bot.id)?.mark ?? 0;
  const last = q.get<{ at: number }>("SELECT at FROM compactions WHERE bot_id = ? ORDER BY id DESC LIMIT 1", bot.id);
  return { lastConsolidatedAt: mark || null, historyChars: historyChars(history.load(bot.id, bot.generation)), compactAt: config.compactChars, lastCompactedAt: last?.at ?? null };
}

// ── Learning from conversations ──────────────────────────────────────────────
const STOP = new Set("the a an and or but of to in on at for with from by is are was were be been it its this that these those as he she they them his her their you your i me my we our not no do does did has have had will would can could should likes like prefers prefer wants want uses use".split(" "));
const wordSet = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w)));

/** Two notes say the same thing when most of their meaningful words coincide. */
export function similar(a: string, b: string): boolean {
  const x = wordSet(a), y = wordSet(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  const small = Math.min(x.size, y.size);
  return shared / (x.size + y.size - shared) >= 0.7 || (small >= 3 && shared / small >= 0.9);
}

const consolidating = new Set<string>();
const setMark = (botId: string, mark: number) => q.run("INSERT INTO consolidation (bot_id, mark) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET mark = excluded.mark", botId, mark);

/** Reads the recent chat and keeps the few facts worth remembering for weeks. */
export async function consolidate(bot: BotRecord): Promise<{ added: string[]; considered: number }> {
  if (consolidating.has(bot.id)) return { added: [], considered: 0 };
  consolidating.add(bot.id);
  try {
    const mark = q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", bot.id)?.mark ?? 0;
    const recent = rows.messagesAfter(bot.id, bot.generation, mark, 60).filter((r) => r.body.kind === "message" && r.body.text.trim() && !r.body.streaming);
    if (!recent.length) return { added: [], considered: 0 };
    const newest = recent[recent.length - 1].createdAt;
    const typedByUser = recent.some((r) => r.body.kind === "message" && r.body.role === "user" && (!r.body.origin || r.body.origin.kind === "voice"));
    if (!typedByUser) { setMark(bot.id, newest); return { added: [], considered: recent.length }; }

    const transcript = recent.map((r) => {
      if (r.body.kind !== "message") return "";
      const who = r.body.role === "assistant" ? bot.name : r.body.origin && r.body.origin.kind !== "voice" ? r.body.origin.name : "User";
      return `${who}: ${clip(r.body.text, 2000)}`;
    }).join("\n").slice(-24_000);
    const existing = memories.list(bot.id, 200);
    const answer = await ask(bot,
      "You maintain the long-term memory of an AI teammate. From a conversation you pick out only what will still matter in weeks.",
      `Keep: facts about the user (role, company, team, location, timezone, key people, accounts and tools), their preferences and standing instructions, lasting facts about ongoing projects.\n` +
      `Skip: one-off requests, small talk, passing states, things the teammate said about itself, secrets of any kind, and anything the existing memories already cover even in other words.\n` +
      `Write each fact as one short stand-alone sentence in the third person, under 200 characters. At most 8. If nothing qualifies, return an empty list.\n` +
      `Answer with JSON only, in the form {"facts": ["…"]}.\n\nExisting memories:\n${existing.map((m) => `- ${m.text}`).join("\n") || "(none)"}\n\nConversation:\n${transcript}`);
    let facts: string[] = [];
    try {
      const parsed = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
      if (Array.isArray(parsed.facts)) facts = parsed.facts.filter((f: unknown): f is string => typeof f === "string");
    } catch { /* unusable answer: learn nothing this time */ }
    const added: string[] = [];
    for (const fact of facts.slice(0, 8)) {
      const t = clip(fact.trim(), 300);
      if (!t || existing.some((m) => similar(m.text, t)) || added.some((a) => similar(a, t))) continue;
      memories.add(bot.id, t, "learned");
      added.push(t);
    }
    setMark(bot.id, newest);
    if (added.length) emit(bot.userId, { type: "memories", botId: bot.id });
    return { added, considered: recent.length };
  } finally {
    consolidating.delete(bot.id);
  }
}

/** Periodic pass: bots that have been quiet for a while get their recent chat distilled into memories. */
export async function consolidationSweep() {
  const quietBefore = now() - config.consolidateIdleMin * 60_000;
  const due = q.all<{ id: string }>(
    `SELECT b.id FROM bots b WHERE b.kind = 'agent' AND b.hidden = 0 AND EXISTS (
       SELECT 1 FROM rows r WHERE r.bot_id = b.id AND r.generation = b.generation AND r.kind = 'message'
       GROUP BY r.bot_id HAVING MAX(r.created_at) <= ? AND MAX(r.created_at) > COALESCE((SELECT mark FROM consolidation c WHERE c.bot_id = b.id), 0))`, quietBefore);
  for (const { id } of due) {
    const bot = bots.byId(id);
    if (!bot || isBusy(id) || getLive(id).running || paused.get(id)) continue;
    await consolidate(bot).catch((err) => console.error("[consolidation]", err?.message ?? err));
  }
}
