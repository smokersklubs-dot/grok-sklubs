import { bots, rows, redactSecrets, type BotRecord } from "./store.js";
import { fileDiff, fileAt, searchSnapshot, listedPathOk } from "./snapshots.js";
import type { Card, Row, Locale } from "./shared.js";
import { screen } from "./pastedsecrets.js";
import { ask } from "./agent/memory.js";
import { hostedHoldsBot, isPaused, isBusy } from "./agent/loop.js";
import { capHolds } from "./usagecaps.js";
import { whyExcluded, packBatches, isSecretPath, isGeneratedPath, FILE_CHARS, type BatchFile } from "./reviewselect.js";
import { anchorFindings, type Located } from "./reviewanchor.js";
import { reviewerSystem, FILTER_SYSTEM, lenientJson, REVIEW_TOOL_ROUNDS, REVIEW_TOOLS_PER_ROUND } from "./reviewprompt.js";
import type { PeerReviewResult, ReviewCategory, ReviewCoverage, ReviewSeverity } from "./peerreviewtypes.js";

/**
 * L77 « Relecture entre bots ». The change is split into lots (no more « 12 files then stop »), every file ends
 * « relu » or « sauté + raison », the reviewer gets the user's request of the turn and read-only look-ups on the
 * turn's snapshot (whole file, exact-text search), its findings follow a grid (bug, risk, load, missing test) and are
 * anchored to lines, then a separate fact-checking pass removes the findings the diff proves wrong. Prompts, selection
 * and anchoring are adapted from alibaba/open-code-review (Apache-2.0): see reviewprompt.ts, reviewselect.ts,
 * reviewanchor.ts and THIRD_PARTY_NOTICES.md.
 */
type Files = Extract<Card, { type: "files" }>;
const reviewing = new Set<string>();
const UNUSABLE = "Le relecteur n’a pas rendu de verdict exploitable.";
/** The status poll calls a review interrupted after 12 minutes: stop starting new lots well before. */
const REVIEW_DEADLINE_MS = 9 * 60_000;
const MAX_FILE_READS_FOR_ANCHORS = 8;
const CATEGORIES: ReviewCategory[] = ["bug", "risk", "load", "test", "other"];
const SEVERITIES: ReviewSeverity[] = ["critical", "high", "medium", "low"];

export function parseReview(answer: string, partial: boolean) {
  const r = lenientJson(answer);
  const reason = typeof r?.reason === "string" ? r.reason : typeof r?.summary === "string" ? r.summary : "";
  if (!r || !["approved", "changes", "inconclusive"].includes(r.verdict) || !reason.trim()) throw Error(UNUSABLE);
  const verdict: "approved" | "changes" | "inconclusive" = partial && r.verdict === "approved" ? "inconclusive" : r.verdict;
  return { verdict, reason: reason.trim().slice(0, 3500) };
}

/** Tests can replace how the reviewer is asked (default: the reviewer bot's own model, no tools). */
export const reviewAsk = { run: (reviewer: BotRecord, system: string, prompt: string) => ask(reviewer, system, prompt, true) };

export async function reviewChanges(source: BotRecord, reviewer: BotRecord, row: Row, card: Files, locale: Locale): Promise<PeerReviewResult> {
  if (reviewer.id === source.id || reviewer.userId !== source.userId || reviewer.hidden || reviewer.kind !== "agent")
    throw Error("Choisis un autre bot de ton compte.");
  if (card.status !== "available" || isPaused(reviewer) || isBusy(reviewer.id) || hostedHoldsBot(reviewer) || capHolds(reviewer))
    throw Error("Cette modification ou ce relecteur est indisponible.");
  if (reviewing.has(reviewer.id)) throw Error("Ce bot fait déjà une relecture.");
  reviewing.add(reviewer.id);
  const started = Date.now();
  const mask = (s: string) => screen(redactSecrets(source.userId, s), locale).text;
  try {
    const coverage = new Map<string, ReviewCoverage>();
    let partial = card.more > 0;
    const files: BatchFile[] = [];
    for (const item of card.files) {
      const why = whyExcluded(item, listedPathOk);
      if (why) { coverage.set(item.path, { path: mask(item.path), status: "skipped", reason: why }); if (why === "unavailable") partial = true; continue; }
      const d = await fileDiff(source, card, item.path);
      if (!d) { coverage.set(item.path, { path: mask(item.path), status: "skipped", reason: "unavailable" }); partial = true; continue; }
      const truncated = d.truncated || d.diff.length > FILE_CHARS;
      partial ||= truncated;
      files.push({ path: item.path, diff: mask(d.diff.slice(0, FILE_CHARS)), truncated });
    }
    if (!files.length) throw Error("Aucune modification textuelle disponible dans cet instantané.");
    const { batches, over } = packBatches(files);
    for (const f of over) coverage.set(f.path, { path: mask(f.path), status: "skipped", reason: "budget" });
    partial ||= over.length > 0;

    // The turn that made the change: its recorded test steps, and the user's request (the reviewer's « objectif »).
    const evidence = [];
    let goal = "";
    const recent = rows.list(source.id, row.generation, 100, row.seq, row.thread ?? 0).reverse();
    for (const r of recent) {
      const b = r.body;
      if (b.kind === "message" && b.role === "user") { goal = mask(b.text).slice(0, 4000); break; }
      if (b.kind === "card" && b.card.type === "files") break;
      if (b.kind === "step" && b.status !== "running" && evidence.length < 6 && /\b(test|pytest|vitest|jest|typecheck|build|check)\b/i.test(JSON.stringify(b.args)))
        evidence.push({ tool: b.tool, status: b.status, summary: mask(b.summary ?? "").slice(0, 1000) });
    }

    const system = reviewerSystem(locale);
    const allPaths = card.files.map((f) => mask(f.path));
    let lookups = 0, dropped = 0, answered = 0;
    const summaries: string[] = [];
    const verdicts: string[] = [];
    const located: Located[] = [];
    const diffs = new Map(files.map((f) => [f.path, f.diff]));

    const runLookup = async (l: any) => {
      lookups++;
      if (l?.tool === "read_file" && typeof l.path === "string") {
        const path = l.path;
        if (!listedPathOk(path) || isSecretPath(path) || isGeneratedPath(path)) return { tool: "read_file", path, error: "not readable" };
        const text = await fileAt(source, l.side === "old" ? card.baseId : card.snapId, path);
        if (text === null) return { tool: "read_file", path, error: "absent from this version" };
        const numbered = mask(text).split("\n").map((t, i) => `${i + 1}| ${t}`).join("\n");
        return { tool: "read_file", path, side: l.side === "old" ? "old" : "new", content: numbered.slice(0, 12_000), truncated: numbered.length > 12_000 };
      }
      if (l?.tool === "search" && typeof l.query === "string" && l.query.trim().length >= 2 && l.query.length <= 200 && !/[\n\r]/.test(l.query)) {
        const hits = (await searchSnapshot(source, card.snapId, l.query.trim())).filter((h) => !isSecretPath(h.path)).slice(0, 40);
        return { tool: "search", query: l.query, hits: hits.map((h) => ({ path: mask(h.path), line: h.line, text: mask(h.text) })) };
      }
      return { tool: String(l?.tool ?? "").slice(0, 40), error: "unknown look-up" };
    };

    for (const batch of batches) {
      if (Date.now() - started > REVIEW_DEADLINE_MS) {
        for (const f of batch) coverage.set(f.path, { path: mask(f.path), status: "skipped", reason: "budget" });
        partial = true;
        continue;
      }
      const results: unknown[] = [];
      let final: any = null, retried = false;
      for (let round = 0; round <= REVIEW_TOOL_ROUNDS + 1 && !final; round++) {
        const input = {
          review_files: batch.map((f) => ({ path: mask(f.path), diff: f.diff, truncated: f.truncated })),
          other_files_in_change: allPaths.filter((p) => !batch.some((f) => mask(f.path) === p)),
          user_request: goal || undefined,
          recordedSteps: evidence,
          partial,
          lookup_results: results.length ? results : undefined,
          lookups_left: round < REVIEW_TOOL_ROUNDS ? REVIEW_TOOL_ROUNDS - round : 0,
          previous_answer_invalid: retried || undefined,
        };
        const answer = mask(await reviewAsk.run(reviewer, system, JSON.stringify(input)));
        const parsed = lenientJson(answer);
        if (parsed && Array.isArray(parsed.lookups) && !parsed.verdict && round < REVIEW_TOOL_ROUNDS) {
          for (const l of parsed.lookups.slice(0, REVIEW_TOOLS_PER_ROUND)) results.push(await runLookup(l));
          continue;
        }
        if (parsed && ["approved", "changes", "inconclusive"].includes(parsed.verdict)) final = parsed;
        else if (!retried) retried = true;
        else break;
      }
      if (!final) {
        for (const f of batch) coverage.set(f.path, { path: mask(f.path), status: "skipped", reason: "reviewer" });
        partial = true;
        continue;
      }
      answered++;
      verdicts.push(final.verdict);
      const summary = typeof final.summary === "string" ? final.summary : typeof final.reason === "string" ? final.reason : "";
      if (summary.trim()) summaries.push(summary.trim());
      const said = new Map<string, any>((Array.isArray(final.files) ? final.files : []).filter((x: any) => x && typeof x.path === "string").map((x: any) => [x.path, x]));
      for (const f of batch) {
        const s = said.get(mask(f.path));
        if (s?.status === "skipped") { coverage.set(f.path, { path: mask(f.path), status: "skipped", reason: "reviewer" }); partial = true; }
        else coverage.set(f.path, { path: mask(f.path), status: "reviewed" });
      }
      // Findings: only on files of this lot (open-code-review's strict focus), normalised to the grid.
      let items: Located[] = (Array.isArray(final.findings) ? final.findings : []).flatMap((x: any) => {
        const own = x && typeof x.path === "string" ? batch.find((f) => mask(f.path) === x.path) : undefined;
        if (!own || typeof x.text !== "string" || !x.text.trim()) return [];
        return [{
          code: typeof x.code === "string" ? x.code.slice(0, 2000) : "",
          finding: {
            path: own.path, line: 0, endLine: 0, side: "new" as const,
            category: CATEGORIES.includes(x.category) ? x.category : "other",
            severity: SEVERITIES.includes(x.severity) ? x.severity : "medium",
            text: x.text.trim().slice(0, 800),
          },
        }];
      }).slice(0, 30);
      // The separate fact-checking pass: removes only what the diff proves wrong; security findings are never removed.
      if (items.length && Date.now() - started < REVIEW_DEADLINE_MS) {
        try {
          const verdict = lenientJson(mask(await reviewAsk.run(reviewer, FILTER_SYSTEM, JSON.stringify({
            review_files: batch.map((f) => ({ path: mask(f.path), diff: f.diff })),
            comments: items.map((it, index) => ({ index, path: mask(it.finding.path), category: it.finding.category, severity: it.finding.severity, code: it.code, comment: it.finding.text })),
          }))));
          const remove = new Set<number>(Array.isArray(verdict?.remove) ? verdict.remove.filter((n: unknown) => Number.isInteger(n)) : []);
          const kept = items.filter((it, i) => !remove.has(i) || it.finding.category === "risk");
          dropped += items.length - kept.length;
          items = kept;
        } catch {
          /* the check is a filter: when it fails, every finding is kept */
        }
      }
      located.push(...items);
    }
    if (!answered) throw Error(UNUSABLE);

    let reads = 0;
    const readNew = async (path: string) => {
      if (reads >= MAX_FILE_READS_FOR_ANCHORS || isSecretPath(path)) return null;
      reads++;
      const t = await fileAt(source, card.snapId, path);
      return t === null ? null : mask(t);
    };
    const findings = (await anchorFindings(located, diffs, readNew))
      .map((f) => ({ ...f, path: mask(f.path), text: mask(f.text) }))
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
    const serious = findings.some((f) => f.severity !== "low");
    let verdict: PeerReviewResult["verdict"] = verdicts.includes("changes") || serious ? "changes" : verdicts.every((v) => v === "approved") ? "approved" : "inconclusive";
    if (partial && verdict === "approved") verdict = "inconclusive";
    const reason = mask(summaries.join("\n")).slice(0, 3500) || (verdict === "approved" ? "Rien à signaler." : "Voir les points relevés.");
    const result: PeerReviewResult = {
      reviewer: reviewer.name, verdict, reason, partial, at: Date.now(), findings,
      coverage: card.files.map((f) => coverage.get(f.path) ?? { path: mask(f.path), status: "skipped", reason: "unavailable" }),
      dropped, goal: !!goal, batches: batches.length, lookups,
    };
    const fresh = rows.get(source.id, row.generation, row.seq);
    if (bots.byId(source.id)?.generation !== row.generation || fresh?.body.kind !== "card" || fresh.body.card.type !== "files" || fresh.body.card.status !== "available")
      throw Error("Cette modification a changé.");
    return result;
  } finally {
    reviewing.delete(reviewer.id);
  }
}
