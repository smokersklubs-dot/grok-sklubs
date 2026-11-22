import { createHash } from "node:crypto";
import { db, q } from "../db.js";
import { hostedMode } from "../hosted.js";
import { listProviders, userProvidersOf, type LlmProvider } from "../llm/index.js";
import type { Memory } from "../shared.js";
import { memories, type BotRecord } from "../store.js";
import { record } from "../usage.js";
import { memoryPrefs } from "./memoryprefs.js";
import { fuseRankings, rankNotes, RECALL_POOL, SEARCH_LIMIT, SEMANTIC_MIN_SIMILARITY, searchNotes, UNCERTAIN_MARK } from "./recall.js";

/**
 * L71 « Mémoire par le sens » — an OPTION, off by default (owner decision still open: local model or provider).
 *
 * When the owner switches it on (Settings → Memory), the bot's notes and the words of a memory_search are turned into
 * vectors ("embeddings") by the embeddings API of an AI provider the account ALREADY has a key for — never a new paid
 * service: the account's own API providers first (Settings → Models), then, outside hosted mode only, the server's own
 * OpenAI key. Only OpenAI and Mistral are known to offer it (official docs cited in llm/openai-compat.ts `embed`). The
 * notes' text is sent to that provider: the setting says so. Without a provider, or on any error, the keyword search
 * (recall.ts) answers alone, as before. Vectors are kept per note and recomputed when its text changes.
 */

/** Known embeddings endpoints, by host, and the model each offers (docs: llm/openai-compat.ts `embed`). */
export const EMBEDDING_MODELS: Record<string, string> = { "api.openai.com": "text-embedding-3-small", "api.mistral.ai": "mistral-embed" };
/** Texts sent per request, and notes embedded at most per search (the newest first). */
export const EMBED_BATCH = 64;
export const EMBED_MAX_NOTES = 500;

db.exec(`CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE, model TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL, at INTEGER NOT NULL
)`);

type Embedder = LlmProvider & { baseUrl: string; embed(model: string, input: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; inputTokens: number }> };
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const canEmbed = (p: LlmProvider): p is Embedder => typeof (p as Partial<Embedder>).embed === "function" && typeof (p as Partial<Embedder>).baseUrl === "string" && !!EMBEDDING_MODELS[hostOf((p as Embedder).baseUrl)] && p.available();

/** The provider and model that would turn this account's notes into vectors, or null (then only keywords are used). */
export function embedderFor(userId: string): { provider: Embedder; model: string; label: string } | null {
  const own = userProvidersOf(userId).filter(canEmbed);
  const server = hostedMode() ? [] : listProviders().filter(canEmbed);
  const p = own[0] ?? server[0];
  return p ? { provider: p, model: EMBEDDING_MODELS[hostOf(p.baseUrl)], label: p.label } : null;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const toBlob = (v: number[]) => Buffer.from(new Float32Array(v).buffer);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Vectors of these notes, computing (and keeping) the missing or outdated ones. */
async function vectorsOf(bot: BotRecord, e: NonNullable<ReturnType<typeof embedderFor>>, notes: Memory[]): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  const todo: Memory[] = [];
  for (const m of notes) {
    const row = q.get<{ model: string; hash: string; vec: Uint8Array }>("SELECT model, hash, vec FROM memory_embeddings WHERE memory_id = ?", m.id);
    if (row && row.model === e.model && row.hash === hash(m.text)) out.set(m.id, fromBlob(row.vec));
    else todo.push(m);
  }
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const part = todo.slice(i, i + EMBED_BATCH);
    const r = await e.provider.embed(e.model, part.map((m) => m.text));
    record(bot.userId, bot.id, e.model, { inputTokens: r.inputTokens, outputTokens: 0, cachedTokens: 0 });
    part.forEach((m, j) => {
      db.prepare("INSERT INTO memory_embeddings (memory_id, model, hash, vec, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET model = excluded.model, hash = excluded.hash, vec = excluded.vec, at = excluded.at",
        ).run(m.id, e.model, hash(m.text), toBlob(r.vectors[j]), Date.now());
      out.set(m.id, new Float32Array(r.vectors[j]));
    });
  }
  return out;
}

/** Notes closest in meaning to the query (cosine ≥ SEMANTIC_MIN_SIMILARITY), best first; [] when the option is off or unusable. */
export async function semanticRank(bot: BotRecord, query: string, notes: Memory[]): Promise<{ id: string; similarity: number }[]> {
  if (!memoryPrefs.semantic(bot.userId) || !query.trim() || !notes.length) return [];
  const e = embedderFor(bot.userId);
  if (!e) return [];
  const pool = notes.slice(0, EMBED_MAX_NOTES);
  const vecs = await vectorsOf(bot, e, pool);
  const qv = await e.provider.embed(e.model, [query.slice(0, 2000)]);
  record(bot.userId, bot.id, e.model, { inputTokens: qv.inputTokens, outputTokens: 0, cachedTokens: 0 });
  return pool.map((m) => ({ id: m.id, similarity: vecs.has(m.id) ? cosine(qv.vectors[0], vecs.get(m.id)!) : 0 }))
    .filter((x) => x.similarity >= SEMANTIC_MIN_SIMILARITY).sort((a, b) => b.similarity - a.similarity);
}

/**
 * memory_search with the option: keyword ranking fused with the meaning-based one (recall.ts fuseRankings). Without the
 * option, without a provider, or when the provider fails: exactly the keyword search (searchNotes).
 */
export async function searchNotesSmart(bot: BotRecord, query: string, limit = SEARCH_LIMIT): Promise<{ content: string; count: number; ids: string[]; semantic: boolean }> {
  const plain = () => ({ ...searchNotes(bot.id, query, limit), semantic: false });
  if (!memoryPrefs.semantic(bot.userId)) return plain();
  const all = memories.usable(bot.id, RECALL_POOL);
  let close: { id: string; similarity: number }[] = [];
  try { close = await semanticRank(bot, query, all); } catch (err) { console.error("[semantic]", (err as Error).message); return plain(); }
  if (!close.length) return plain();
  const keyword = rankNotes(all, query, { limit: limit * 2 }).map((r) => r.note.id);
  const ids = fuseRankings(keyword, close.map((c) => c.id), limit);
  const byId = new Map(all.map((m) => [m.id, m] as const));
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  const lines = ids.map((id) => byId.get(id)!).filter(Boolean).map((m) => `- ${m.status === "contested" ? UNCERTAIN_MARK : m.confidence === "confirmed" ? "(confirmed) " : ""}${m.text} (${day(m.createdAt)}${keyword.includes(m.id) ? "" : "; found by meaning"})`);
  return { content: lines.join("\n"), count: lines.length, ids, semantic: true };
}
