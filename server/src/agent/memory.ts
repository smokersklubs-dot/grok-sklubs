import { emit, getLive } from "../bus.js";
import { memoryKeep } from "./memorykeep.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { defaultModelRef, listProviders, resolveModel, type ChatMessage } from "../llm/index.js";
import { ModelOutputLimit } from "../llm/types.js";
import { engineAsk, isEngineRef } from "./engine.js";
import type { Locale, Memory, MemoryBookkeeping, SensitiveCategory } from "../shared.js";
import { bots, clip, history, laneKey, memories, now, paused, rows, settings, users, type BotRecord } from "../store.js";
import { memoryPrefs, summaries } from "./memoryprefs.js";
import { findQuote, typedByUser } from "./grounding.js";
import { looksSecret, memoryVerdict, sensitiveCategory } from "./sensitive.js";
import { fold, stem, tokenize } from "./recall.js";
import { noteHistory } from "./memorybook.js";
import { record } from "../usage.js";
import { hostedHoldsBot, inQueue, isBusy, isPaused } from "./loop.js";
import { capHolds } from "../usagecaps.js";
import { isHostedStop } from "../hosted.js";
import { betweenTurnsChars, userWordsBlock } from "./compactlines.js";
import { cleanDay, saysChangeOfMind, setMarks, updateInPlace } from "./memorymarks.js";
import { tidySweep } from "./memorytidy.js";
import { restSummarySweep, writeSummary } from "./compactplus.js";
import { threadLane } from "./lanes.js";
import { cleanInvisible, focusPrompt, nearbyNotes } from "./memorysave.js"; import { summaryAsker } from "./sidemodel.js";

/** A short side request to the model (summaries, fact extraction): no tools, low effort. */
export async function ask(bot: BotRecord, system: string, prompt: string, selectedBot = false): Promise<string> {
  // A bot on a subscription does its side work there too, unless the server has its own model for it.
  if (isEngineRef(bot.model) && (selectedBot || (!config.auxModel && !listProviders().some((p) => p.available())))) return engineAsk(bot, system, prompt, selectedBot);
  let res;
  try {
    const { provider, model } = resolveModel((selectedBot ? bot.model : config.auxModel || bot.model) || defaultModelRef(), bot.userId);
    if (selectedBot && (provider.id === "demo" || (bot.model && ![model, provider.id+":"+model].includes(bot.model)))) throw Error("Connecte un modèle au bot relecteur.");
    res = await provider.runTurn({ model, system, tools: [], effort: "low", maxTokens: 8000, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], signal: AbortSignal.timeout(180_000) });
  } catch (err) {
    // Hosted mode: the plan does not let the service's keys pay for this side request; a bot on its own subscription
    // does it there instead (never for a suspended account).
    if (isHostedStop(err) && err.reason !== "suspended" && isEngineRef(bot.model)) return engineAsk(bot, system, prompt);
    throw err;
  }
  record(bot.userId, bot.id, res.model, res.usage);
  if (selectedBot && res.stopReason === "max_tokens") throw new ModelOutputLimit("Le modèle a atteint sa limite de sortie.");
  if (selectedBot && res.stopReason === "refusal") throw Error("Le modèle sélectionné a refusé cette demande.");
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
  return lines.join("\n"); // L80: a long conversation is summarised in parts (compactplus.ts), never cut here
}

const SUMMARY_MARK = "[Automatic summary of the earlier conversation — treat it as your own notes]";
const cooldown = new Map<string, number>();

/**
 * L80: the summary is written in fixed sections (one prompt), so nothing of a kind is forgotten, and it is checked before
 * it replaces anything: every section is there, it says something, it is shorter than what it replaces and holds no
 * secret. A summary that fails is asked again once with what was wrong; if it still fails, nothing is replaced (the
 * conversation stays whole) and the next try waits, as after a model error.
 */
export const SUMMARY_SECTIONS = ["Who the user is", "Goals, preferences and standing instructions", "Decisions made", "Facts, names, numbers, links and ids", "What was done and how it turned out", "Still open or promised"] as const;
/** A summary shorter than this says nothing (each heading alone is about 200 characters). */
export const SUMMARY_MIN_CHARS = 280;
export const SUMMARY_PROMPT =
  `Write the notes in the teammate's own voice ("I…"), under about 1,500 words, in exactly these sections, in this order, each starting with its heading on its own line ("## " then the name), and "none" under a section with nothing to say:\n` +
  SUMMARY_SECTIONS.map((h) => `## ${h}`).join("\n") +
  `\nKeep concrete facts, names, numbers, links, file paths and ids exactly as written; in "What was done" say which tools were used, how it turned out, failures, and what should not be retried. Never include passwords, keys or other secrets. Only what the conversation shows: never invent.`;

/** What is wrong with a summary (empty: it may replace the older messages). `sourceChars`: the size of what it replaces. */
export function summaryProblems(summary: string, sourceChars: number): string[] {
  const problems: string[] = [];
  const text = summary.trim();
  const headings = new Set(text.split(/\r?\n/).filter((l) => /^#{1,3}\s/.test(l.trim())).map((l) => l.trim().replace(/^#{1,3}\s*/, "").replace(/[:\s]+$/, "").toLowerCase()));
  const missing = SUMMARY_SECTIONS.filter((h) => !headings.has(h.toLowerCase()));
  if (missing.length) problems.push(`missing sections: ${missing.join("; ")}`);
  if (text.length < SUMMARY_MIN_CHARS) problems.push("too short to keep anything");
  if (sourceChars > 0 && text.length >= sourceChars) problems.push("not shorter than the conversation it replaces");
  if (looksSecret(text)) problems.push("it contains something that looks like a password or a key");
  return problems;
}

/** The visible line in the chat after a summary (L80): the owner sees it happened and where to read it. */
const summaryLine = (locale: string | undefined, n: number) => locale === "fr"
  ? `J'ai résumé le début de notre conversation (${n} messages) pour garder l'essentiel sans m'encombrer. Rien n'est perdu : le résumé se lit dans mes réglages, onglet Mémoire, « Voir le résumé ».`
  : `I summarised the start of our conversation (${n} messages) to keep the gist without the bulk. Nothing is lost: read the summary in my settings, Memory tab, "See the summary".`;

/**
 * When the conversation outgrows its budget, everything except the last few exchanges is replaced by
 * a dense summary. Runs only between turns, never while tool calls are open. The visible chat is untouched, but for
 * one short line saying it happened. Before summarising, a quiet learning pass notes what matters from the user's own
 * words (L80, « note ce qui compte » — the same rules as the learning: never from the bot's replies or outside content).
 */
export async function compactIfNeeded(bot: BotRecord, force = false, opts: { thread?: number; instruction?: string } = {}): Promise<{ before: number; after: number; changed: boolean }> {
  const thread = opts.thread ?? 0; // L80: threads are summarised too, and `/compact <consigne>` (compactplus.ts)
  const all = history.load(bot.id, bot.generation, thread);
  const same = { before: all.length, after: all.length, changed: false };
  if (paused.get(bot.id) || (thread && paused.get(laneKey(bot.id, thread)))) return same;
  // Audit DS-Bot #72: the line follows the bot's model (capped), never above COMPACT_CHARS (compactlines.ts).
  const line = betweenTurnsChars(bot.userId, bot.model || defaultModelRef());
  if (!force && (historyChars(all) < line || (cooldown.get(`${bot.id}~${thread}`) ?? 0) > now())) return same;

  // Cut only at the start of a user turn, so no tool call is separated from its result.
  const turnStarts = all.map((m, i) => (m.role === "user" && !m.content.some((b) => b.type === "tool_result") ? i : -1)).filter((i) => i > 0);
  let keep = Math.min(config.compactKeepTurns, turnStarts.length);
  let cut = keep > 0 ? turnStarts[turnStarts.length - keep] : all.length;
  // If the recent turns alone are still too big, keep fewer of them.
  while (keep > 0 && historyChars(all.slice(cut)) > line * 0.35) {
    keep--;
    cut = keep > 0 ? turnStarts[turnStarts.length - keep] : all.length;
  }
  const last = all[all.length - 1];
  if (cut >= all.length && last?.role === "assistant" && last.content.some((b) => b.type === "tool_use")) return same;
  const older = all.slice(0, cut);
  if (older.length < 2) return same;

  // « Note ce qui compte » first: what the user said that is worth weeks is kept as notes before the details go.
  let flushed = false;
  try { await consolidate(bot); flushed = true; } catch (err) { console.error("[compaction] learning pass:", (err as Error)?.message ?? err); }

  const source = render(older);
  const system = "You compress a long working conversation between a user and their AI teammate into notes the teammate will rely on afterwards. Be dense and factual. Never include passwords, keys or other secrets.";
  let summary: string;
  try {
    const small = summaryAsker(bot); // L69: a small model for this side pass when the bot's mode asks for thrift (sidemodel.ts); the bot's usual model if it fails
    summary = await (small ? writeSummary(small, system, SUMMARY_PROMPT, source, summaryProblems, opts.instruction) : Promise.reject(null)).catch(() => writeSummary((sys, prompt) => ask(bot, sys, prompt), system, SUMMARY_PROMPT, source, summaryProblems, opts.instruction));
  } catch (err) {
    cooldown.set(`${bot.id}~${thread}`, now() + 10 * 60_000);
    throw err;
  }
  // Only commit if nothing was appended while the summary was being written.
  if (history.count(bot.id, bot.generation, thread) !== all.length) return same;
  // Audit DS-Bot #74: the user's own messages of the condensed part travel word for word next to the summary.
  const next: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: `${SUMMARY_MARK}\n${summary}${userWordsBlock(bot, all.slice(cut), thread)}` }] }, ...all.slice(cut)];
  history.replace(bot.id, bot.generation, next, thread);
  q.run("INSERT INTO compactions (bot_id, generation, at, before_items, after_items) VALUES (?, ?, ?, ?, ?)", bot.id, bot.generation, now(), all.length, next.length);
  summaries.add(bot.id, bot.generation, all.length, next.length, summary, flushed);
  rows.append(bot, { kind: "notice", tone: "info", text: summaryLine(users.localeOf(bot.userId), older.length) }, thread);
  return { before: all.length, after: next.length, changed: true };
}

export function memoryStatus(bot: BotRecord): MemoryBookkeeping {
  const mark = q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", bot.id)?.mark ?? 0;
  const last = q.get<{ at: number }>("SELECT at FROM compactions WHERE bot_id = ? ORDER BY id DESC LIMIT 1", bot.id);
  return { lastConsolidatedAt: mark || null, historyChars: historyChars(history.load(bot.id, bot.generation)), compactAt: betweenTurnsChars(bot.userId, bot.model || defaultModelRef()), lastCompactedAt: last?.at ?? null };
}

// ── Learning from conversations ──────────────────────────────────────────────
/** Verbs every note of a preference uses: they say nothing about which fact it is. */
const STOP = new Set(["like", "likes", "prefer", "prefers", "want", "wants", "use", "uses", "aime", "prefere", "veut", "utilise", "adore"].map(stem));
/** Days and months (French and English, accents folded): one word that tells two facts apart. */
const CALENDAR = new Set(("lundi mardi mercredi jeudi vendredi samedi dimanche janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre " +
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december").split(" ").map(stem));
const wordSet = (s: string) => new Set(tokenize(s).filter((w) => !STOP.has(w)));
/**
 * The words that name WHICH fact a note is about: numbers, days and months, and proper names (a capitalised word that is
 * not a common word: "Dupont", "Lisbonne", "Acme"). Stemmed like the rest, so accents and plurals do not count.
 */
function keyWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const [w] = tokenize(raw);
    if (!w) continue;
    if (/\d/.test(w) || CALENDAR.has(w) || /^\p{Lu}/u.test(raw)) out.add(w);
  }
  return out;
}

/**
 * Two notes say the same thing when most of their meaningful words coincide (accents, elisions and plurals folded, as in
 * recall.ts) — unless each of them holds a name, a number, a day or a month the other lacks: "le client Dupont paie à
 * 30 jours" and "le client Durand paie à 30 jours" are two facts, so are "rapport le lundi" and "rapport le vendredi"
 * (audit mem0, « Écarts » n° 8).
 */
export function similar(a: string, b: string): boolean {
  const x = wordSet(a), y = wordSet(b);
  if (!x.size || !y.size) return fold(a.trim()) === fold(b.trim());
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  const small = Math.min(x.size, y.size);
  if (!(shared / (x.size + y.size - shared) >= 0.7 || (small >= 3 && shared / small >= 0.9))) return false;
  const ka = keyWords(a), kb = keyWords(b);
  const onlyA = [...ka].some((w) => !kb.has(w) && !y.has(w)), onlyB = [...kb].some((w) => !ka.has(w) && !x.has(w));
  return !(onlyA && onlyB);
}

const consolidating = new Set<string>();
const setMark = (botId: string, mark: number) => q.run("INSERT INTO consolidation (bot_id, mark) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET mark = excluded.mark", botId, mark);
/** Messages read per batch, and batches per pass: a long conversation is read in order, from the oldest message on. */
export const LEARN_BATCH = 60;
export const LEARN_BATCHES_PER_PASS = 5;
/** An unreadable answer keeps the messages for the next pass; after this many in a row the batch is let go (cost). */
export const LEARN_UNREADABLE_LIMIT = 3;
const unreadable = new Map<string, number>();
const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * Reads the chat written since the last pass and keeps the few facts worth remembering for weeks — learned only from the
 * user's own messages (spec 07 A8): never from the bot's replies, other bots, routines, webhooks, pages, mails or tool
 * results. Each fact must come with an excerpt, word for word, of the user message it is based on, and the server checks
 * that the excerpt is really there. Sensitive topics and anything that looks like a secret are left out (sensitive.ts).
 *
 * Nothing is skipped in a long conversation: messages are read oldest first, LEARN_BATCH at a time, and the mark only
 * moves past a batch the model really answered (an unreadable answer is tried again on the next pass). Each message goes
 * to the model with its date, and relative dates ("la semaine prochaine") are written as real dates.
 */
export async function consolidate(bot: BotRecord): Promise<{ added: string[]; considered: number }> {
  if (consolidating.has(bot.id)) return { added: [], considered: 0 };
  consolidating.add(bot.id);
  const added: string[] = [];
  let considered = 0, confirmed = 0;
  try {
    for (let pass = 0; pass < LEARN_BATCHES_PER_PASS; pass++) {
      const r = await learnBatch(bot);
      if (!r) break;
      added.push(...r.added);
      considered += r.considered;
      confirmed += r.confirmed;
      if (!r.more) break;
    }
    if (added.length || confirmed) emit(bot.userId, { type: "memories", botId: bot.id });
    return { added, considered };
  } finally {
    consolidating.delete(bot.id);
  }
}

/** One batch: the oldest LEARN_BATCH messages after the mark. Null when there is nothing (left) to read or the answer was unreadable. */
async function learnBatch(bot: BotRecord): Promise<{ added: string[]; considered: number; confirmed: number; more: boolean } | null> {
  const mark = q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", bot.id)?.mark ?? 0;
  let batch = rows.messagesAfter(bot.id, bot.generation, mark, LEARN_BATCH);
  if (!batch.length) return null;
  const more = batch.length === LEARN_BATCH;
  // The mark is a time: messages of the same millisecond as the last one of a full batch wait for the next batch together.
  if (more) { const last = batch[batch.length - 1].createdAt; const cut = batch.filter((r) => r.createdAt < last); if (cut.length) batch = cut; }
  const newest = batch[batch.length - 1].createdAt;
  const recent = batch.filter((r) => r.body.kind === "message" && r.body.text.trim() && !r.body.streaming);
  // Only what the user typed (or said on a call) can teach anything; long pastes are skipped.
  const skipped = memoryKeep.skippedSeqs(bot.id, bot.generation); // L66 « Ne pas retenir ce message » (memorykeep.ts)
  const own = recent.filter((r) => typedByUser(r) && r.body.kind === "message" && r.body.text.length <= 4000 && !skipped.has(r.seq));
  // L88 « Ne rien retenir »: nothing is learned from this bot's conversation while it is on (the mark still moves on).
  if (!own.length || !settings.memory(bot.userId).autoCapture || memoryPrefs.noLearn(bot.id)) { setMark(bot.id, newest); return { added: [], considered: recent.length, confirmed: 0, more }; }

  // Confidence that grows by itself (wave 5b): a note the user states again, word for word, in a later message of their
  // own becomes "confirmed". Only the user's messages count; never the bot's text or outside content.
  const before = memories.list(bot.id, 200);
  let confirmed = 0;
  for (const m of before) {
    if (m.confidence === "confirmed" || m.status === "archived" || !m.quote.trim()) continue;
    const later = own.filter((r) => r.createdAt > m.createdAt).map((r) => ({ seq: r.seq, text: r.body.kind === "message" ? r.body.text : "", at: r.createdAt }));
    if (later.length && findQuote(m.quote, later)) { memories.confirm(m.id); confirmed++; }
  }

  const transcript = own.map((r) => `- [${isoDay(r.createdAt)}] ${r.body.kind === "message" ? clip(r.body.text, 2000) : ""}`).join("\n").slice(-24_000);
  // L67: the model sees the notes closest to what it reads (memorysave.ts); the checks below use every note.
  const existing = nearbyNotes(bot.id, transcript), all = memories.list(bot.id, 5000).filter((m) => m.status !== "archived");
  const answer = await ask(bot,
    "You maintain the long-term memory of an AI teammate. You read only the user's own messages and pick out what will still matter in weeks.",
    `Keep: facts about the user (role, company, team, timezone, key people, accounts and tools), their preferences and standing instructions, lasting facts about ongoing projects.\n` +
    `Skip: one-off requests, small talk, passing states, secrets of any kind, health, religion, politics, sexuality, origin, precise addresses, account or card numbers, and anything the existing memories already cover even in other words.\n` +
    `Write each fact as one short stand-alone sentence in the third person, under 200 characters, and give with it an excerpt copied word for word from the user message it comes from. At most 8. If nothing qualifies, return an empty list.\n` +
    `Each message starts with the day it was written, in brackets. Today is ${isoDay(now())}. Never keep a relative date or time in a fact ("tomorrow", "next week", "lundi prochain", "dans 3 jours", "cet été"): turn it into a real date counted from the day of the message it comes from (for example "on 2026-11-24", "the week of 2026-11-30", "in summer 2027"). The excerpt stays word for word, without the day in brackets.\n` +
    `When the user restates a fact an existing memory already holds, list it again with its new excerpt (it confirms it). When the user says something that contradicts an existing memory, add the new fact with "contradicts" set to that memory, word for word.\n` +
    `When the user says a fact holds only until a date ("jusqu'à fin mars", "until Friday"), give that last day as "until" (YYYY-MM-DD, counted from the day of the message).\n${focusPrompt(bot.id)}` +
    `Answer with JSON only, in the form {"facts": [{"text": "…", "quote": "…", "contradicts": "…(optional)", "until": "YYYY-MM-DD (optional)"}]}.\n\nExisting memories:\n${existing.map((m) => `- ${m.text}`).join("\n") || "(none)"}\n\nThe user's messages:\n${transcript}`);
  const facts = parseFacts(answer);
  if (!facts) {
    // An unreadable answer: these messages are read again on the next pass, so nothing they said is lost — unless the
    // model keeps failing on them, then they are let go (each pass costs a model call).
    const n = (unreadable.get(bot.id) ?? 0) + 1;
    if (n < LEARN_UNREADABLE_LIMIT) { unreadable.set(bot.id, n); return null; }
    console.error(`[consolidation] ${bot.id}: ${n} unreadable answers in a row; these messages are skipped`);
  }
  unreadable.delete(bot.id);
  const words = own.map((r) => ({ seq: r.seq, text: r.body.kind === "message" ? r.body.text : "", at: r.createdAt }));
  const added: string[] = [];
  for (const fact of (facts ?? []).slice(0, 8)) {
    const t = clip(cleanInvisible(fact.text), 300);
    if (!t) continue;
    // A contradiction of an existing note, in the user's own later words: the note is contested and the user is asked.
    const old = fact.contradicts ? all.find((m) => m.status !== "archived" && (m.text === fact.contradicts || similar(m.text, fact.contradicts!))) : undefined;
    if (old) {
      const src = findQuote(fact.quote, words);
      // Audit DS-Bot F5: the user clearly changed their mind ("finalement…", "from now on…"): the note is updated in place
      // (memorymarks.ts, with « Annuler »), never duplicated; a pinned or sensitive note still gets the card.
      if (src && src.at > old.createdAt && memoryVerdict(bot.userId, `${t}\n${fact.quote}`, false).ok && !(saysChangeOfMind(fact.quote) && updateInPlace(bot, old, t, fact.quote))) askWhichIsRight(bot, old, t, fact.quote);
      continue;
    }
    // The same fact again, in a later message of the user's: confirmed.
    const same = all.find((m) => similar(m.text, t));
    if (same) {
      const src = findQuote(fact.quote, words);
      if (src && src.at > same.createdAt && same.confidence !== "confirmed") { memories.confirm(same.id); confirmed++; }
      continue;
    }
    if (added.some((a) => similar(a, t)) || memoryKeep.buried(bot.id, t)) continue; // L66: a fact the owner removed is never learned again by itself
    // The excerpt must really be in one of the user's messages: otherwise the fact may come from somewhere else.
    const source = findQuote(fact.quote, words);
    if (!source) continue;
    // Sensitive topics are learned only when the user allowed them; secrets never (an explicit "remember" goes through memory_save).
    const v = memoryVerdict(bot.userId, `${t}\n${fact.quote}`, false);
    if (!v.ok) continue;
    const note = memories.add(bot.id, t, "learned", { quote: clip(fact.quote, 300), category: v.category });
    const until = cleanDay(fact.until);
    if (until) setMarks(bot.userId, note, { until }, "bot"); // audit DS-Bot #82: a dated note leaves the prompt after its day
    added.push(t);
  }
  setMark(bot.id, newest);
  return { added, considered: recent.length, confirmed, more };
}

/** The model's facts, or null when its answer is not the JSON asked for (an empty list is a real answer). */
export function parseFacts(answer: string): { text: string; quote: string; contradicts?: string; until?: string }[] | null {
  try {
    const parsed = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.facts)) return null;
    return parsed.facts.map((f: unknown) => (typeof f === "string" ? { text: f, quote: "" } : f && typeof f === "object" ? { text: String((f as any).text ?? ""), quote: String((f as any).quote ?? ""), contradicts: typeof (f as any).contradicts === "string" ? (f as any).contradicts : undefined, ...(typeof (f as any).until === "string" ? { until: (f as any).until } : {}) } : { text: "", quote: "" }));
  } catch { return null; }
}

/** The user contradicted a note: it becomes "contested" and a small card asks which is right (once per note). */
export function askWhichIsRight(bot: BotRecord, old: Memory, newText: string, quote: string) {
  const open = rows.list(bot.id, bot.generation, 200).some((r) => r.body.kind === "card" && r.body.card.type === "memory" && r.body.card.memoryId === old.id && r.body.card.status === "pending");
  if (open) return;
  memories.setStatus(old.id, "contested");
  noteHistory(old.id, bot.id, "status", old.status, "contested", "bot");
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

export function exportMemories(bot: BotRecord, format: "md" | "json", locale: Locale): string {
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

// ── When to learn (L67) ──────────────────────────────────────────────────────
/**
 * Words with which the user corrects the bot or gives it a standing instruction (accents folded): "non, je t'ai dit…",
 * "je te l'ai déjà dit", "c'est faux", "à partir de maintenant", "no, I told you", "from now on"… Such a message is learned
 * from at the next pass (within a minute), not only after CONSOLIDATE_IDLE_MIN of quiet. Only the user's own messages
 * count (typedByUser): never the bot's replies, a routine's, a webhook's or another bot's words.
 */
export const CORRECTION_WORDS = /\b(?:non,?\s+(?:je\s+t'?ai|je\s+vous\s+ai)\s+(?:deja\s+)?dit|je\s+(?:te|vous)\s+l'?ai\s+(?:deja\s+)?dit|je\s+t'?ai\s+deja\s+dit|c'?est\s+faux|ce\s+n'?est\s+pas\s+(?:ca|ce\s+que\s+j'?ai\s+dit)|tu\s+te\s+trompes|retiens\s+(?:bien|que|ca)|souviens[- ]toi|n'?oublie\s+(?:pas|jamais)|a\s+partir\s+de\s+maintenant|dorenavant|desormais|plus\s+jamais|no,?\s+i\s+(?:already\s+)?told\s+you|i\s+(?:already\s+)?told\s+you|that'?s\s+(?:wrong|not\s+what\s+i\s+said)|you'?re\s+wrong|remember\s+that|don'?t\s+forget|from\s+now\s+on|never\s+again)\b/;
export const isCorrection = (text: string) => CORRECTION_WORDS.test(fold(text).replace(/[’ʼ]/g, "'"));
/** The user's own messages since the last pass that make a pass due without waiting for quiet. */
export const LEARN_EVERY_TURNS = 20;
export type LearnReason = "quiet" | "correction" | "turns";

/**
 * Which bots should learn now, and why: quiet for CONSOLIDATE_IDLE_MIN since their last message (as before), or — even
 * mid-conversation — a correction among the user's messages since the last pass, or LEARN_EVERY_TURNS of them.
 */
export function learningDue(quietBefore = now() - config.consolidateIdleMin * 60_000): { id: string; reason: LearnReason }[] {
  const pending = q.all<{ id: string; generation: number; last: number; mark: number }>(
    `SELECT b.id, b.generation, MAX(r.created_at) AS last, COALESCE(c.mark, 0) AS mark FROM bots b
       JOIN rows r ON r.bot_id = b.id AND r.generation = b.generation AND r.kind = 'message' LEFT JOIN consolidation c ON c.bot_id = b.id
     WHERE b.kind = 'agent' AND b.hidden = 0 GROUP BY b.id HAVING MAX(r.created_at) > COALESCE(c.mark, 0)`);
  const out: { id: string; reason: LearnReason }[] = [];
  for (const p of pending) {
    if (p.last <= quietBefore) { out.push({ id: p.id, reason: "quiet" }); continue; }
    const own = rows.messagesAfter(p.id, p.generation, p.mark, LEARN_BATCH).filter((r) => typedByUser(r) && r.body.kind === "message");
    if (own.length >= LEARN_EVERY_TURNS) out.push({ id: p.id, reason: "turns" });
    else if (own.some((r) => r.body.kind === "message" && isCorrection(r.body.text))) out.push({ id: p.id, reason: "correction" });
  }
  return out;
}

/** Periodic pass (every minute): bots due to learn (learningDue) get their recent chat distilled into memories. */
export async function consolidationSweep() {
  for (const { id } of learningDue()) {
    const bot = bots.byId(id);
    if (!bot || isBusy(id) || getLive(id).running || paused.get(id) || hostedHoldsBot(bot) || isPaused(bot) || capHolds(bot)) continue;
    await consolidate(bot).catch((err) => console.error("[consolidation]", err?.message ?? err));
  }
  // Audit DS-Bot #84: then at most one daily tidy (memorytidy.ts), never for a bot that is working or held.
  await tidySweep((b) => !!(isBusy(b.id) || getLive(b.id).running || hostedHoldsBot(b) || isPaused(b) || capHolds(b)));
  // L80 « résumé à chaud »: one long conversation (main chat or thread) summarised while the owner is away (compactplus.ts).
  await restSummarySweep((b) => !!(isBusy(b.id) || getLive(b.id).running || hostedHoldsBot(b) || isPaused(b) || capHolds(b)), (b, thread) => inQueue(b.id, () => compactIfNeeded(bots.byId(b.id) ?? b, false, { thread }), threadLane(b.id, thread)));
}
