/**
 * L85 — a receipt under the reply, made WITHOUT a model: what the bot's final words claim is compared with the tools that
 * actually ran in the turn. Two gaps are shown in one small line under the reply, only when there is one:
 * « dit mais pas fait » (the reply says something was sent / deleted / paid… and no such tool went through) and
 * « fait mais pas dit » (such a tool went through and the reply does not mention it). Plain word lists, French and English.
 * The idea comes from noah-agent (PolyForm Noncommercial): idea only, our own code.
 * Audit DS-Bot #63: the same line also carries the claim marks of claims.ts (code adapted from DS-Bot, Apache-2.0):
 * a Markdown link to a file that is not on the bot's computer, and work announced while nothing runs.
 */
import { rows, type BotRecord, type UserRecord } from "../store.js";
import type { ToolUseBlock } from "../llm/index.js";
import type { ToolOutput } from "./tools.js";
import { lt } from "./looptext.js";
import { announcesWork, fileRefs, missingFileRefs, type Claims } from "./claims.js";
import { computerKind, workspaceOf } from "../computer.js";
import { diskScript } from "../linux.js";
import { jobs } from "../jobs.js";
import { bgTasks } from "./bgtasks.js";
import { existsSync } from "node:fs";
import path from "node:path";

export type ActKind = "sent" | "deleted" | "paid" | "published" | "scheduled" | "saved" | "created";

/** Tool names → the kind of action they take (first match wins). Reading, looking and planning tools are none. */
const TOOL_KINDS: [ActKind, RegExp][] = [
  ["paid", /card_fill|(^|_)pay(ment)?($|_)/],
  ["published", /publish/],
  ["deleted", /delete|trash|(^|_)remove($|_)/],
  ["scheduled", /routine_create|event_create|calendar_create|wait_later|reminder/],
  ["sent", /(^|_)(send|reply|forward)($|_)|bot_message|room_post|mail_send|__send|__reply/],
  ["saved", /file_save|memory_save|_write$|upload/],
  ["created", /_create$|image_generate|video_generate/],
];
const NOT_ACTIONS = /^(message_react|progress_update|stay_quiet|ask_user|task_update|goal_update)$/;

/** What a reply claims, per kind (French and English past tenses). */
const CLAIMS: Record<ActKind, RegExp> = {
  sent: /\b(j['’]ai (bien )?(envoyé|répondu|transmis|transféré)|c['’]est envoyé|message envoyé|mail envoyé|e-?mail envoyé|i(['’]ve| have)? (sent|replied|emailed|forwarded)|has been sent|was sent)/i,
  deleted: /\b(j['’]ai (bien )?(supprimé|effacé|retiré)|c['’]est supprimé|i(['’]ve| have)? (deleted|removed|erased)|has been deleted|was deleted)/i,
  paid: /\b(j['’]ai (bien )?payé|paiement (effectué|fait|validé)|i(['’]ve| have)? paid|payment (is )?(done|made|complete))/i,
  published: /\b(j['’]ai (bien )?publié|c['’]est publié|i(['’]ve| have)? published|is (now )?(live|published))/i,
  scheduled: /\b(j['’]ai (bien )?(programmé|planifié|créé la routine|mis un rappel)|i(['’]ve| have)? (scheduled|set (up )?a (routine|reminder)))/i,
  saved: /\b(j['’]ai (bien )?(enregistré|sauvegardé|noté dans ma mémoire)|i(['’]ve| have)? saved)/i,
  created: /\b(j['’]ai (bien )?créé|i(['’]ve| have)? created)/i,
};
/** Words that show the reply speaks of an action of that kind at all (for « fait mais pas dit »). */
const MENTIONS: Record<ActKind, RegExp> = {
  sent: /envoy|répond|transf|transmi|sent|send|repl|forward|email|mail|message|post/i,
  deleted: /suppr|effac|retir|delet|remov|eras|corbeille|trash/i,
  paid: /pay|paie|achat|commande|order|purchas/i,
  published: /publi|en ligne|live/i,
  scheduled: /programm|planifi|routine|rappel|remind|schedul|agenda|calend/i,
  saved: /enregistr|sauvegard|mémoire|memoire|fichier|saved|memory|file/i,
  created: /cré|creat|image|vidéo|video/i,
};
/** Kinds worth a « fait mais pas dit » line (a saved note or a created picture the reply skips is not worth one). */
const MUST_SAY: ActKind[] = ["sent", "deleted", "paid", "published", "scheduled"];

export function kindOfTool(name: string): ActKind | null {
  if (NOT_ACTIONS.test(name)) return null;
  for (const [k, re] of TOOL_KINDS) if (re.test(name)) return k;
  return null;
}

export interface Receipt { saidNotDone: ActKind[]; doneNotSaid: { kind: ActKind; tools: string[] }[] }

/** The gaps between a reply and the tools that ran (ok: went through). Empty lists: nothing to show. */
export function compareReceipt(reply: string, ran: { name: string; ok: boolean }[]): Receipt {
  const done = new Map<ActKind, string[]>();
  for (const t of ran) { const k = t.ok ? kindOfTool(t.name) : null; if (k) done.set(k, [...(done.get(k) ?? []), t.name]); }
  const saidNotDone = (Object.keys(CLAIMS) as ActKind[]).filter((k) => CLAIMS[k].test(reply) && !done.has(k));
  const doneNotSaid = MUST_SAY.filter((k) => done.has(k) && !MENTIONS[k].test(reply)).map((k) => ({ kind: k, tools: [...new Set(done.get(k))] }));
  return { saidNotDone, doneNotSaid };
}

const ranIn = new WeakMap<object, { name: string; ok: boolean }[]>();

/** Called once per tool that ran in a turn (loop.ts afterTool). */
export function noteToolForReceipt(turn: object, call: ToolUseBlock, out: ToolOutput): void {
  const list = ranIn.get(turn) ?? [];
  list.push({ name: call.name, ok: !out.isError });
  ranIn.set(turn, list);
}

/** The receipt line, in the user's language, or "" when the reply and the tools agree (and no claim is marked: claims.ts). */
export function receiptText(locale: UserRecord["locale"], r: Receipt, claims?: Claims): string {
  const parts: string[] = [];
  if (claims?.missingFiles?.length) parts.push(lt(locale, "links a file that is not there: {list}", { list: claims.missingFiles.join(", ") }));
  if (claims?.inProgress) parts.push(lt(locale, "says work is under way, but nothing is running"));
  if (r.saidNotDone.length) parts.push(lt(locale, "said but not done: {list}", { list: r.saidNotDone.map((k) => lt(locale, k)).join(", ") }));
  if (r.doneNotSaid.length) parts.push(lt(locale, "done but not said: {list}", { list: r.doneNotSaid.map((d) => `${lt(locale, d.kind)} (${d.tools.join(", ")})`).join(", ") }));
  return parts.length ? `${lt(locale, "Receipt")} — ${parts.join(" · ")}` : "";
}

/**
 * Which of these absolute paths exist on the bot's computer (its own Linux computer, without waking it: diskScript; or
 * its folder on the server for the other computer kinds, where /root stands for that folder). Unknown counts as there.
 */
let existsOnComputer = async (bot: BotRecord, paths: string[]): Promise<boolean[]> => {
  if (computerKind() === "linux") {
    const r = await diskScript(bot.id, workspaceOf(bot.id), 'for p in "$@"; do if [ -e "$p" ]; then echo 1; else echo 0; fi; done', paths, 20_000).catch(() => null);
    const lines = r && r.code === 0 ? r.stdout.toString().trim().split(/\s+/) : [];
    return paths.map((_, i) => lines[i] !== "0");
  }
  const ws = workspaceOf(bot.id);
  return paths.map((p) => { const rel = p.startsWith("/root/") ? p.slice(6) : p === "/root" ? "" : null; return rel === null ? true : existsSync(path.join(ws, rel)); });
};
/** For the tests. */
export const setExistsOnComputer = (f: typeof existsOnComputer) => { existsOnComputer = f; };

/** Work still running for the bot when its turn ended: background jobs and background tasks. */
const stillRunning = (botId: string) => { try { return jobs.countRunning(botId) + bgTasks.active(botId); } catch { return 0; } };

/**
 * At the end of a turn that replied: one small line under the reply when its words and its actions differ, or when a
 * claim does not hold (claims.ts: a linked file that is not there, work announced while nothing runs). Returns the line
 * written now; with file links the line waits for the computer's answer (receiptDone(turn) resolves when it is written).
 */
const pendingReceipts = new WeakMap<object, Promise<string>>();
export const receiptDone = (turn: object) => pendingReceipts.get(turn) ?? Promise.resolve("");
export function postReceipt(turn: { bot: BotRecord; user: UserRecord; lastText: string; thread: number }): string {
  const ran = ranIn.get(turn) ?? [];
  if (!turn.lastText) return "";
  const r = compareReceipt(turn.lastText, ran);
  const inProgress = !ran.length && !stillRunning(turn.bot.id) && announcesWork(turn.lastText);
  const write = (claims?: Claims) => {
    const text = receiptText(turn.user.locale, r, claims);
    if (text) rows.append(turn.bot, { kind: "notice", tone: "info", text }, turn.thread);
    return text;
  };
  if (!fileRefs(turn.lastText).length) return write(inProgress ? { inProgress: true } : undefined);
  const done = missingFileRefs(turn.lastText, (p) => existsOnComputer(turn.bot, p)).catch(() => [] as string[])
    .then((missing) => write({ ...(missing.length ? { missingFiles: missing } : {}), ...(inProgress ? { inProgress: true as const } : {}) }));
  pendingReceipts.set(turn, done);
  return "";
}
