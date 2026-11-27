import { anonymise } from "./agent/anonymise.js";
import { searchMessages } from "./convsearch.js";
import type { SearchHit } from "./shared.js";
import { clip } from "./store.js";

/**
 * L131 — « compétences proposées depuis plusieurs conversations, avec preuves » (Hermes and ECC audits: a skill is worth
 * keeping when the same task came back several times). When a bot proposes a skill (skill_propose), the owner's earlier
 * requests that look like the same task are searched in their conversations (convsearch.ts: the full-text index, this
 * account only, never a hidden bot), and the card shows them as evidence: in how many different conversations, when, and a
 * short anonymised quote of each. Fixed rules, no model call; the owner still decides whether to keep the skill.
 *
 * A "conversation" is one bot's chat between two resets (bot + generation) and one thread in it; only the owner's own
 * messages count (what they asked), and at most one per conversation, newest first.
 */
export interface SkillEvidence { at: number; where: string; quote: string }
export const MAX_EVIDENCE = 4;

/** The distinct conversations among the hits, one owner message each, newest first. */
export function distinctAsks(hits: SearchHit[], max = MAX_EVIDENCE): SearchHit[] {
  const seen = new Set<string>(), out: SearchHit[] = [];
  for (const h of [...hits].sort((a, b) => b.at - a.at)) {
    if (h.role !== "user") continue;
    const key = `${h.botId}:${h.generation}:${h.thread ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** The evidence for a proposed skill: earlier requests of the owner that match its name and "when", anonymised. */
export function proposalEvidence(userId: string, name: string, when: string, known: string[]): SkillEvidence[] {
  const query = `${name} ${when}`.trim();
  if (!query) return [];
  let hits: SearchHit[] = [];
  try { hits = searchMessages(userId, query, { limit: 40 }); } catch { return []; }
  return distinctAsks(hits).map((h) => ({ at: h.at, where: h.botName, quote: clip(anonymise(h.snippet, known), 200) }));
}

/** What the card carries (nothing when no earlier request was found) and what the bot is told. */
export function evidenceFields(evidence: SkillEvidence[]): { evidence?: SkillEvidence[] } {
  return evidence.length ? { evidence } : {};
}
export const evidenceNote = (evidence: SkillEvidence[]) =>
  evidence.length >= 2 ? ` The card shows ${evidence.length} earlier conversations where the user asked for this, as evidence.` : "";
