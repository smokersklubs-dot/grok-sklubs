import { emit, getLive } from "../bus.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { defaultModelRef, listProviders, resolveModel, type ChatMessage } from "../llm/index.js";
import { engineAsk, isEngineRef } from "./engine.js";
import type { Memory, MemoryBookkeeping, SensitiveCategory } from "../shared.js";
import { bots, clip, history, memories, now, paused, rows, settings, type BotRecord } from "../store.js";
import { findQuote, typedByUser } from "./grounding.js";
import { looksSecret, memoryVerdict, sensitiveCategory } from "./sensitive.js";
import { record } from "../usage.js";
import { hostedHoldsBot, isBusy } from "./loop.js";
import { isHostedStop } from "../hosted.js";

/** A short side request to the model (summaries, fact extraction): no tools, low effort. */
export async function ask(bot: BotRecord, system: string, prompt: string): Promise<string> {
  // A bot on a subscription does its side work there too, unless the server has its own model for it.
  if (isEngineRef(bot.model) && !config.auxModel && !listProviders().some((p) => p.available())) return engineAsk(bot, system, prompt);
  let res;
  try {
    const { provider, model } = resolveModel(config.auxModel || bot.model || defaultModelRef(), bot.userId);
    res = await provider.runTurn({ model, system, tools: [], effort: "low", maxTokens: 8000, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], signal: AbortSignal.timeout(180_000) });
  } catch (err) {
    // Hosted mode: the plan does not let the service's keys pay for this side request; a bot on its own subscription
    // does it there instead (never for a suspended account).
    if (isHostedStop(err) && err.reason !== "suspended" && isEngineRef(bot.model)) return engineAsk(bot, system, prompt);
    throw err;
  }
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

export function memoryStatus(bot: BotRecord): MemoryBookkeeping {
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

/**
 * Reads the recent chat and keeps the few facts worth remembering for weeks — learned only from the user's own messages
 * (spec 07 A8): never from the bot's replies, other bots, routines, webhooks, pages, mails or tool results. Each fact
 * must come with an excerpt, word for word, of the user message it is based on, and the server checks that the excerpt
 * is really there. Sensitive topics and anything that looks like a secret are left out (sensitive.ts).
 */
export async function consolidate(bot: BotRecord): Promise<{ added: string[]; considered: number }> {
  if (consolidating.has(bot.id)) return { added: [], considered: 0 };
  consolidating.add(bot.id);
  try {
    const mark = q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", bot.id)?.mark ?? 0;
    const recent = rows.messagesAfter(bot.id, bot.generation, mark, 60).filter((r) => r.body.kind === "message" && r.body.text.trim() && !r.body.streaming);
    if (!recent.length) return { added: [], considered: 0 };
    const newest = recent[recent.length - 1].createdAt;
    // Only what the user typed (or said on a call) can teach anything; long pastes are skipped.
    const own = recent.filter((r) => typedByUser(r) && r.body.kind === "message" && r.body.text.length <= 4000);
    if (!own.length || !settings.memory(bot.userId).autoCapture) { setMark(bot.id, newest); return { added: [], considered: recent.length }; }

    // Confidence that grows by itself (wave 5b): a note the user states again, word for word, in a later message of their
    // own becomes "confirmed". Only the user's messages count; never the bot's text or outside content.
    const before = memories.list(bot.id, 200);
    let confirmed = 0;
    for (const m of before) {
      if (m.confidence === "confirmed" || m.status === "archived" || !m.quote.trim()) continue;
      const later = own.filter((r) => r.createdAt > m.createdAt).map((r) => ({ seq: r.seq, text: r.body.kind === "message" ? r.body.text : "", at: r.createdAt }));
      if (later.length && findQuote(m.quote, later)) { memories.confirm(m.id); confirmed++; }
    }

    const transcript = own.map((r) => `- ${r.body.kind === "message" ? clip(r.body.text, 2000) : ""}`).join("\n").slice(-24_000);
    const existing = memories.list(bot.id, 200);
    const answer = await ask(bot,
      "You maintain the long-term memory of an AI teammate. You read only the user's own messages and pick out what will still matter in weeks.",
      `Keep: facts about the user (role, company, team, timezone, key people, accounts and tools), their preferences and standing instructions, lasting facts about ongoing projects.\n` +
      `Skip: one-off requests, small talk, passing states, secrets of any kind, health, religion, politics, sexuality, origin, precise addresses, account or card numbers, and anything the existing memories already cover even in other words.\n` +
      `Write each fact as one short stand-alone sentence in the third person, under 200 characters, and give with it an excerpt copied word for word from the user message it comes from. At most 8. If nothing qualifies, return an empty list.\n` +
      `When the user restates a fact an existing memory already holds, list it again with its new excerpt (it confirms it). When the user says something that contradicts an existing memory, add the new fact with "contradicts" set to that memory, word for word.\n` +
      `Answer with JSON only, in the form {"facts": [{"text": "…", "quote": "…", "contradicts": "…(optional)"}]}.\n\nExisting memories:\n${existing.map((m) => `- ${m.text}`).join("\n") || "(none)"}\n\nThe user's messages:\n${transcript}`);
    let facts: { text: string; quote: string; contradicts?: string }[] = [];
    try {
      const parsed = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
      if (Array.isArray(parsed.facts)) facts = parsed.facts.map((f: unknown) => (typeof f === "string" ? { text: f, quote: "" } : f && typeof f === "object" ? { text: String((f as any).text ?? ""), quote: String((f as any).quote ?? ""), contradicts: typeof (f as any).contradicts === "string" ? (f as any).contradicts : undefined } : { text: "", quote: "" }));
    } catch { /* unusable answer: learn nothing this time */ }
    const words = own.map((r) => ({ seq: r.seq, text: r.body.kind === "message" ? r.body.text : "", at: r.createdAt }));
    const added: string[] = [];
    for (const fact of facts.slice(0, 8)) {
      const t = clip(fact.text.trim(), 300);
      if (!t) continue;
      // A contradiction of an existing note, in the user's own later words: the note is contested and the user is asked.
      const old = fact.contradicts ? existing.find((m) => m.status !== "archived" && (m.text === fact.contradicts || similar(m.text, fact.contradicts!))) : undefined;
      if (old) {
        const src = findQuote(fact.quote, words);
        if (src && src.at > old.createdAt && memoryVerdict(bot.userId, `${t}\n${fact.quote}`, false).ok) askWhichIsRight(bot, old, t, fact.quote);
        continue;
      }
      // The same fact again, in a later message of the user's: confirmed.
      const same = existing.find((m) => similar(m.text, t));
      if (same) {
        const src = findQuote(fact.quote, words);
        if (src && src.at > same.createdAt && same.confidence !== "confirmed") { memories.confirm(same.id); confirmed++; }
        continue;
      }
      if (added.some((a) => similar(a, t))) continue;
      // The excerpt must really be in one of the user's messages: otherwise the fact may come from somewhere else.
      const source = findQuote(fact.quote, words);
      if (!source) continue;
      // Sensitive topics are learned only when the user allowed them; secrets never (an explicit "remember" goes through memory_save).
      const v = memoryVerdict(bot.userId, `${t}\n${fact.quote}`, false);
      if (!v.ok) continue;
      memories.add(bot.id, t, "learned", { quote: clip(fact.quote, 300), category: v.category });
      added.push(t);
    }
    setMark(bot.id, newest);
    if (added.length || confirmed) emit(bot.userId, { type: "memories", botId: bot.id });
    return { added, considered: recent.length };
  } finally {
    consolidating.delete(bot.id);
  }
}

/** The user contradicted a note: it becomes "contested" and a small card asks which is right (once per note). */
export function askWhichIsRight(bot: BotRecord, old: Memory, newText: string, quote: string) {
  const open = rows.list(bot.id, bot.generation, 200).some((r) => r.body.kind === "card" && r.body.card.type === "memory" && r.body.card.memoryId === old.id && r.body.card.status === "pending");
  if (open) return;
  memories.setStatus(old.id, "contested");
  rows.append(bot, { kind: "card", card: { type: "memory", memoryId: old.id, oldText: old.text, newText: clip(newText, 300), quote: clip(quote, 300), status: "pending" } }, 0);
  bots.bumpUnread(bot.id);
}

// ── Import and export ────────────────────────────────────────────────────────
export interface ImportCandidate { text: string; skip: "duplicate" | "secret" | "sensitive" | "empty" | null; category: SensitiveCategory | null }

/** Lines of a memory export (ours in JSON or Markdown, or a list pasted from another assistant), checked one by one. */
export function importCandidates(bot: BotRecord, raw: string): ImportCandidate[] {
  let texts: string[] = [];
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.memories) ? parsed.memories : [];
    texts = list.map((m: unknown) => (typeof m === "string" ? m : m && typeof m === "object" ? String((m as any).text ?? "") : ""));
  } catch {
    texts = trimmed.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/^\[[ x]\]\s*/i, "").trim()).filter((l) => l && !/^#{1,6}\s/.test(l));
  }
  const existing = memories.list(bot.id, 2000).map((m) => m.text);
  const seen: string[] = [];
  return texts.slice(0, 300).map((t) => {
    const text = clip(t.replace(/\s+/g, " ").trim(), 500);
    if (!text) return { text, skip: "empty" as const, category: null };
    if (looksSecret(text)) return { text, skip: "secret" as const, category: null };
    if ([...existing, ...seen].some((e) => similar(e, text))) return { text, skip: "duplicate" as const, category: null };
    seen.push(text);
    const v = memoryVerdict(bot.userId, text, false);
    return v.ok ? { text, skip: null, category: v.category } : { text, skip: "sensitive" as const, category: sensitiveCategory(text) };
  });
}

/** Adds the chosen lines; sensitive ones only when the user ticked them (`allowSensitive`), secrets never. */
export function importMemories(bot: BotRecord, raw: string, chosen: string[] | null, allowSensitive: boolean): { imported: number; skipped: number } {
  const want = chosen ? new Set(chosen.map((c) => c.trim())) : null;
  let imported = 0, skipped = 0;
  for (const c of importCandidates(bot, raw)) {
    const picked = want ? want.has(c.text) : c.skip === null;
    const ok = picked && (c.skip === null || (c.skip === "sensitive" && allowSensitive && !!want));
    if (!ok) { if (c.skip !== "empty") skipped++; continue; }
    memories.add(bot.id, c.text, "import", { category: c.category ?? sensitiveCategory(c.text) });
    imported++;
  }
  if (imported) emit(bot.userId, { type: "memories", botId: bot.id });
  return { imported, skipped };
}

export function exportMemories(bot: BotRecord, format: "md" | "json", locale: "fr" | "en"): string {
  const list = memories.list(bot.id, 5000).reverse();
  if (format === "json") return JSON.stringify({ bot: bot.name, exportedAt: new Date().toISOString(), memories: list.map(({ botId: _b, ...m }) => m) }, null, 2);
  const head = locale === "fr" ? `# Mémoire de ${bot.name}` : `# ${bot.name}'s memory`;
  const groups: [string, string][] = locale === "fr" ? [["active", "Utilisées"], ["contested", "Contestées"], ["archived", "Archivées"]] : [["active", "Active"], ["contested", "Contested"], ["archived", "Archived"]];
  return [head, "", ...groups.flatMap(([st, title]) => { const l = list.filter((m) => m.status === st); return l.length ? [`## ${title}`, "", ...l.map((m) => `- ${m.text}`), ""] : []; })].join("\n");
}

// ── Writing style ─────────────────────────────────────────────────────────────
/** Marker the demo model looks for. */
export const STYLE_MARK = "You describe how a person writes, from samples of messages they sent.";

/** Strips quoted replies and signatures from a sent message, so only the user's own writing is kept. */
export function ownWriting(body: string): string {
  const lines: string[] = [];
  for (const l of body.split(/\r?\n/)) {
    if (/^\s*>/.test(l)) continue;
    if (/^(On .+ wrote:|Le .+ a écrit\s?:|-----Original Message-----|-----Message d'origine-----|From: .+)$/i.test(l.trim())) break;
    if (/^--\s*$/.test(l)) break;
    lines.push(l);
  }
  return lines.join("\n").trim();
}

/**
 * Learns the user's writing style (opt-in) from messages they sent: their sent mail when a Gmail or Outlook mailbox is
 * connected, else what they typed to their bots. The profile describes tone, length, greetings and sign-offs — never
 * quotes, names or facts — and replaces the previous one. Bots use it when they draft messages for the user.
 */
export async function learnStyle(userId: string, bot: BotRecord, sentMail: string[]): Promise<{ profile: string; source: "mail" | "chat"; samples: number }> {
  let samples = sentMail.map(ownWriting).filter((t) => t.length >= 20).slice(0, 20);
  let source: "mail" | "chat" = "mail";
  if (samples.length < 3) {
    source = "chat";
    samples = q.all<{ body: string }>(
      `SELECT r.body FROM rows r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ? AND r.kind = 'message' AND json_extract(r.body, '$.role') = 'user' AND json_extract(r.body, '$.origin') IS NULL ORDER BY r.created_at DESC LIMIT 60`, userId)
      .map((r) => String(JSON.parse(r.body).text ?? "")).filter((t) => t.length >= 20 && !looksSecret(t)).slice(0, 30);
  }
  if (!samples.length) throw new Error("There is nothing written by you to learn from yet.");
  const profile = await ask(bot, STYLE_MARK,
    `Describe this person's writing style in at most 8 short bullet points: tone and formality (tu/vous, first names), typical length, greetings and sign-offs they use, punctuation and emoji habits, language. ` +
    `Never quote them, never name anyone, never mention any fact, place, number or subject from the samples. Write the bullets in the language most samples use.\n\nSamples (one per block):\n${samples.map((t) => clip(t, 1200)).join("\n---\n")}`);
  const clean = clip(profile.replace(/^```\w*|```$/g, "").trim(), 2000);
  if (!clean) throw new Error("The model gave back nothing.");
  settings.saveMemory(userId, { style: { enabled: true, profile: clean, updatedAt: now(), source, samples: samples.length } });
  return { profile: clean, source, samples: samples.length };
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
    if (!bot || isBusy(id) || getLive(id).running || paused.get(id) || hostedHoldsBot(bot)) continue;
    await consolidate(bot).catch((err) => console.error("[consolidation]", err?.message ?? err));
  }
}
