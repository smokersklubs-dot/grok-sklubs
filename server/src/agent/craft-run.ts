import { tr } from "../i18n.js";
import type { Locale } from "../shared.js";
import { findQuote, normalize, targetNamed, type UserWords } from "./grounding.js";

/**
 * Craft Anything in the bot's computer (L23). The CLI itself is pinned and checked by docker/desktop/install-craft.sh,
 * which also installs a guard in front of it: clean-room mode is forced (`--clean-room` on every run), `--deep` and
 * `deep_mode` are refused, and the output of each `rebuild` is kept in CRAFT_RUN_DIR. This file holds the server side:
 *  - craftCommandRefusal: `shell_run` refuses the same things before the command reaches the computer (and any direct call
 *    of the real binary behind the guard);
 *  - craftRounds: check rounds (Craft's "[Check N] X% alike" comparison) only when the owner said, in their own words,
 *    that the reference is THEIR site — comparing again and again means capturing someone else's site again and again;
 *  - parseCraftRun / craftRunNotice: `--unattended` answers the builder's questions with their first choice and refuses
 *    its approvals ("? <title> → <choice> (unattended)", "? <title> → refused (unattended)", craft-anything-cli 0.6.1
 *    apps/craft-anything-cli/src/rebuild_cmd.rs auto_answer); those lines and the resemblance score are read back from the
 *    kept output and shown to the owner, so nothing is decided in their place without them seeing it.
 */

/** Where the guard keeps each rebuild's output (install-craft.sh CRAFT_LOG_DIR default). */
export const CRAFT_RUN_DIR = "/root/.sklubot/craft-runs";
/** Where the official binary sits behind the guard (install-craft.sh CRAFT_LIB_DIR default). */
export const CRAFT_REAL_DIR = "/usr/local/lib/craft-anything";

/** Why shell_run refuses a command (English, for the model), or null when it may run. */
export function craftCommandRefusal(command: string): string | null {
  if (command.includes(CRAFT_REAL_DIR)) return "Refused: run Craft Anything as craft-anything-cli (it keeps clean-room mode), never the program behind it.";
  if (!/craft-anything/i.test(command)) return null;
  if (/(^|[\s'"=])--deep(\b|=)/.test(command) || /deep[_-]mode/i.test(command)) return "Refused: Craft Anything runs in clean-room mode only (--deep and deep_mode are not allowed). Nothing inside the original is read.";
  return null;
}

/** The host of an http(s) address, lower case, without "www."; null for anything else. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch { return null; }
}

/**
 * How many check rounds a rebuild of `reference` may run: 2 when `quote` is found in the owner's own recent messages
 * (grounding.ts findQuote: never a page, a mail or the bot's text) and names the reference's site; 0 otherwise.
 */
export function craftRounds(reference: string | undefined, quote: string | undefined, words: UserWords[]): { rounds: 0 | 2; host: string | null; why: string } {
  const host = reference ? hostOf(reference) : null;
  if (!host) return { rounds: 0, host: null, why: "no web reference" };
  if (!quote?.trim()) return { rounds: 0, host, why: "the owner did not say it is their site" };
  if (!findQuote(quote, words)) return { rounds: 0, host, why: "those words are not in the owner's own messages" };
  const said = normalize(quote);
  const base = host.split(".").slice(0, -1).join(".") || host;
  if (!targetNamed(host, said) && !targetNamed(base, said)) return { rounds: 0, host, why: `the owner's words do not name ${host}` };
  return { rounds: 2, host, why: "the owner's own site" };
}

export interface CraftRun {
  /** Questions the builder answered on its own (first choice). */
  answered: { question: string; answer: string }[];
  /** Approvals it refused on its own. */
  refused: string[];
  /** Check rounds: resemblance in percent when given. */
  checks: { round: number; similarity: number | null; note: string }[];
  /** The last "Done. …" / "Stopped: …" line. */
  end: string;
}

/** Reads a rebuild's kept output (see above). Unknown lines are ignored. */
export function parseCraftRun(text: string): CraftRun {
  const run: CraftRun = { answered: [], refused: [], checks: [], end: "" };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m = /^\? (.+?) → refused \(unattended\)$/.exec(line);
    if (m) { run.refused.push(m[1]); continue; }
    m = /^\? (.+?) → (.+?) \(unattended\)$/.exec(line);
    if (m) { run.answered.push({ question: m[1], answer: m[2] }); continue; }
    m = /^\[Check (\d+)\] (?:(\d+(?:\.\d+)?)% alike — )?(.*)$/.exec(line);
    if (m) { run.checks.push({ round: Number(m[1]), similarity: m[2] !== undefined ? Number(m[2]) : null, note: m[3] }); continue; }
    if (/^(Done\.|Stopped:)/.test(line)) run.end = line;
  }
  return run;
}

const cut = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The chat notice for the owner: what was decided in their place, and how alike the result is. Empty: nothing to say. */
export function craftRunNotice(run: CraftRun, locale: Locale): string {
  const parts: string[] = [];
  if (run.answered.length) {
    parts.push(tr(locale, "Craft Anything answered these questions on its own (first choice):"));
    for (const a of run.answered.slice(0, 20)) parts.push(`• ${cut(a.question)} → ${cut(a.answer, 80)}`);
  }
  if (run.refused.length) {
    parts.push(tr(locale, "It refused these requests on its own (nothing outside the project was done):"));
    for (const r of run.refused.slice(0, 20)) parts.push(`• ${cut(r)}`);
  }
  const scored = run.checks.filter((c) => c.similarity !== null);
  if (scored.length) {
    const last = scored[scored.length - 1];
    parts.push(tr(locale, "Resemblance with your site after check {n}: {pct} %.", { n: String(last.round), pct: String(Math.round(last.similarity!)) }));
  }
  if (!parts.length) return "";
  parts.push(tr(locale, "Tell me if you want another choice: I will redo that part."));
  return parts.join("\n");
}
