/*
 * Portions adapted from milind-soni/OpenMausBot (https://github.com/milind-soni/OpenMausBot, commit
 * 6ef53dd808eecd0669edd5e639f151fca87b246c, files server/room-holds.ts and server/room-turn-timeout.ts),
 * Copyright 2026 Milind Soni and OpenMausBot contributors, Apache-2.0 (NOTICE kept in THIRD_PARTY_NOTICES.md);
 * modified for Sklubot: French stop / resume words, holds stored in SQLite per group (kept after a restart), a typed
 * « reprends @Bot » releases, quoted text never counts, the per-member time limit is a watchdog over Sklubot's live
 * state (bus.ts) instead of engine events, and every line the group shows is in the owner's language.
 */
import { getLive } from "../bus.js";
import { q } from "../db.js";
import type { Locale } from "../shared.js";
import { laneKey, now, rows, users, type BotRecord } from "../store.js";
import { interrupt } from "./loop.js";

/**
 * L155 — leading a group of bots (backlog A-FAIRE L155; OMB and Nightly audits).
 *
 *  - « stop @Léa » (or « arrête @Léa », « pause @Léa ») in a group puts that member on hold there: its turn for the group
 *    stops now, it is woken by no message of the group (mention, routing, « everyone ») until « reprends @Léa » (or a
 *    message that calls it by its @name without a stop word, or « reprends » / « @everyone » for all). The hold is a row of
 *    room_holds, so it survives a restart. A stop word far from the mention (« @Léa, le stop de bus est où ? ») changes
 *    nothing; quoted text and code never count.
 *  - A time limit per member (1 to 240 minutes, none by default): a member whose turn for the group runs longer is
 *    stopped, and the group says so. What it did stays.
 */
q.run("CREATE TABLE IF NOT EXISTS room_holds (room_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (room_id, bot_id))");
q.run("CREATE TABLE IF NOT EXISTS room_member_limits (room_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, minutes INTEGER NOT NULL, PRIMARY KEY (room_id, bot_id))");

// ── Reading the message (adapted from OMB room-holds.ts) ─────────────────────
const STOP_WINDOW = 2;
const STOP_WORDS = new Set(["stop", "halt", "pause", "arrete", "arretez", "stoppe", "stopper", "attends", "attendez"]);
const RESUME_WORDS = new Set(["reprends", "reprenez", "reprend", "resume", "continue", "continuez", "relance"]);
const RESUME_TAIL = new Set(["all", "everyone", "please", "tous", "tout", "le", "monde", "stp", "svp", "s'il", "te", "plait", "vous"]);
const OBJECT_STARTERS = new Set(["this", "that", "the", "a", "an", "my", "le", "la", "les", "un", "une", "ce", "cette", "ton", "ta", "tes", "mon", "ma", "de", "du", "des"]);

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Quoted text, inline code and code blocks keep only their @mentions (a quote of « stop @Léa » is not a stop). */
export function maskQuotedAndCode(value: string): string {
  const mentionsOnly = (span: string): string => (span.match(/@[\p{L}\p{N}._-]+/gu) ?? []).join(" ") || "quoted";
  const kept: string[] = [];
  let fence = "";
  for (const line of value.split("\n")) {
    if (fence) { const closing = line.trim().startsWith(fence); kept.push(closing ? "" : mentionsOnly(line)); if (closing) fence = ""; continue; }
    const opened = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opened) { fence = opened[1]!; continue; }
    if (/^\s*>/.test(line)) { kept.push(mentionsOnly(line)); continue; }
    kept.push(line.replace(/`[^`\n]*`/g, mentionsOnly).replace(/["“”«»][^"“”«»\n]*["“”«»]/g, mentionsOnly));
  }
  return kept.join("\n");
}

/** Tokens: @mentions keep their name (lower case, accents folded); words are folded too. */
const tokens = (text: string) => fold(maskQuotedAndCode(text)).match(/@[\p{L}\p{N}._-]+|[\p{L}\p{N}'_-]+/gu) ?? [];

function wordNear(text: string, words: Set<string>): "adjacent" | "distant" | null {
  const t = tokens(text);
  const mentions: number[] = [];
  const hits: number[] = [];
  t.forEach((tok, i) => {
    if (tok.startsWith("@")) mentions.push(i);
    // « stop the music @Léa »: the stop word takes an object of its own, it is not about the bot.
    else if (words.has(tok) && !(OBJECT_STARTERS.has(t[i + 1] ?? "") && t[i + 2] && !t[i + 2].startsWith("@"))) hits.push(i);
  });
  if (hits.some((h) => mentions.some((m) => Math.abs(h - m) <= STOP_WINDOW))) return "adjacent";
  return hits.length ? "distant" : null;
}

export interface HoldDirective { hold: string[]; holdAll: boolean; release: string[]; releaseAll: boolean }

const everyone = (text: string) => /(^|\s)@(everyone|all|tous|tout-le-monde)\b/i.test(maskQuotedAndCode(text));
function bareResume(text: string): boolean {
  const w = tokens(text).filter((x) => !x.startsWith("@"));
  return w.length > 0 && RESUME_WORDS.has(w[0]) && w.slice(1).every((x) => RESUME_TAIL.has(x));
}

/**
 * What the message does to holds. `mentioned`: the ids of the members it names with @. A stop word next to a mention
 * holds them (@everyone: all); a message naming a member without any stop word releases it; a bare « reprends » (or
 * « reprends @everyone ») releases every member; a stop word far from every mention changes nothing.
 */
export function classifyHoldDirective(text: string, mentioned: readonly string[]): HoldDirective {
  const all = everyone(text);
  const stop = wordNear(text, STOP_WORDS);
  if (stop === "adjacent") return { hold: [...mentioned], holdAll: all, release: [], releaseAll: false };
  return { hold: [], holdAll: false, release: stop === "distant" ? [] : [...mentioned], releaseAll: stop === null && (bareResume(text) || (all && wordNear(text, RESUME_WORDS) !== null)) };
}

/** The message is only a stop / resume order (nothing else to answer): nobody is woken by it. */
export function onlyHoldOrder(text: string): boolean {
  const w = tokens(text).filter((x) => !x.startsWith("@"));
  return w.length > 0 && w.every((x) => STOP_WORDS.has(x) || RESUME_WORDS.has(x) || RESUME_TAIL.has(x) || ["toi", "vous", "now", "maintenant", "merci"].includes(x));
}

// ── Storage ──────────────────────────────────────────────────────────────────
export const roomHolds = {
  list: (roomId: string): string[] => q.all<{ bot_id: string }>("SELECT bot_id FROM room_holds WHERE room_id = ? ORDER BY at", roomId).map((r) => r.bot_id),
  held: (roomId: string, botId: string) => !!q.get("SELECT 1 FROM room_holds WHERE room_id = ? AND bot_id = ?", roomId, botId),
  hold: (roomId: string, botId: string) => Number(q.run("INSERT OR IGNORE INTO room_holds (room_id, bot_id, at) VALUES (?, ?, ?)", roomId, botId, now()).changes) > 0,
  release: (roomId: string, botId: string) => Number(q.run("DELETE FROM room_holds WHERE room_id = ? AND bot_id = ?", roomId, botId).changes) > 0,
};

const FR: Record<string, string> = {
  "{bots} is on hold in this group: write « reprends @{first} » to bring it back.": "{bots} est en attente dans ce groupe : écris « reprends @{first} » pour le relancer.",
  "{bots} are on hold in this group: write « reprends » to bring them back.": "{bots} sont en attente dans ce groupe : écris « reprends » pour les relancer.",
  "{bots} is back in the group.": "{bots} est de retour dans le groupe.",
  "{bots} are back in the group.": "{bots} sont de retour dans le groupe.",
  "{bot} went past its time limit in this group ({n} min): it was stopped. What it did stays.": "{bot} a dépassé sa limite de temps dans ce groupe ({n} min) : il a été arrêté. Ce qu'il a fait reste.",
};
const say = (loc: Locale, en: string, vars: Record<string, string>) => (loc === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

/**
 * Applies the message's stop / resume order to the room (team.ts dispatchToRoom, a human's message only). Writes the
 * notice, stops the turns of the members it puts on hold. Returns the members still awake and whether the message was
 * only that order (then nobody is woken by it).
 */
export function applyHolds(room: BotRecord, text: string, members: BotRecord[], mentionedIds: string[], thread: number): { awake: BotRecord[]; consumed: boolean } {
  const d = classifyHoldDirective(text, mentionedIds);
  const ids = members.map((m) => m.id);
  const held: BotRecord[] = [];
  const released: BotRecord[] = [];
  for (const m of members) {
    if ((d.holdAll || d.hold.includes(m.id)) && roomHolds.hold(room.id, m.id)) held.push(m);
    else if ((d.releaseAll || d.release.includes(m.id)) && roomHolds.release(room.id, m.id)) released.push(m);
  }
  const loc = users.localeOf(room.userId);
  if (held.length) {
    for (const m of held) interrupt(laneKey(m.id, 0));
    const names = held.map((m) => m.name).join(", ");
    rows.append(room, { kind: "notice", tone: "info", text: say(loc, held.length === 1 ? "{bots} is on hold in this group: write « reprends @{first} » to bring it back." : "{bots} are on hold in this group: write « reprends » to bring them back.", { bots: names, first: held[0].name }) }, thread);
  }
  if (released.length) rows.append(room, { kind: "notice", tone: "info", text: say(loc, released.length === 1 ? "{bots} is back in the group." : "{bots} are back in the group.", { bots: released.map((m) => m.name).join(", ") }) }, thread);
  const holds = new Set(roomHolds.list(room.id));
  const consumed = (held.length > 0 || released.length > 0 || d.hold.length > 0 || d.holdAll || d.releaseAll) && onlyHoldOrder(text);
  return { awake: members.filter((m) => ids.includes(m.id) && !holds.has(m.id)), consumed };
}

// ── Time limit per member (adapted from OMB room-turn-timeout.ts) ────────────
export const MIN_LIMIT_MINUTES = 1;
export const MAX_LIMIT_MINUTES = 240;

export const roomLimits = {
  all(roomId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of q.all<{ bot_id: string; minutes: number }>("SELECT bot_id, minutes FROM room_member_limits WHERE room_id = ?", roomId)) out[r.bot_id] = r.minutes;
    return out;
  },
  get: (roomId: string, botId: string): number | null => q.get<{ minutes: number }>("SELECT minutes FROM room_member_limits WHERE room_id = ? AND bot_id = ?", roomId, botId)?.minutes ?? null,
  set(roomId: string, botId: string, minutes: number | null) {
    if (minutes === null) q.run("DELETE FROM room_member_limits WHERE room_id = ? AND bot_id = ?", roomId, botId);
    else q.run("INSERT INTO room_member_limits (room_id, bot_id, minutes) VALUES (?, ?, ?) ON CONFLICT(room_id, bot_id) DO UPDATE SET minutes = excluded.minutes", roomId, botId, minutes);
  },
};

/** null (no limit) or a whole number of minutes in range; anything else is refused (undefined). */
export function parseLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_LIMIT_MINUTES && value <= MAX_LIMIT_MINUTES ? value : undefined;
}

/** How often the watchdog looks (ms); ROOM_LIMIT_POLL_MS shortens it in tests. */
const pollMs = () => Number(process.env.ROOM_LIMIT_POLL_MS) > 0 ? Number(process.env.ROOM_LIMIT_POLL_MS) : 5_000;
/** One minute of limit, in ms (ROOM_LIMIT_MINUTE_MS shortens it in tests). */
const minuteMs = () => Number(process.env.ROOM_LIMIT_MINUTE_MS) > 0 ? Number(process.env.ROOM_LIMIT_MINUTE_MS) : 60_000;
const watching = new Map<string, ReturnType<typeof setInterval>>();

/**
 * A member was woken by the group (team.ts wakeInRoom): when it has a limit there, its turn is watched. The clock starts
 * when its turn starts (live state), not while the message waits in its queue; the watch ends with the turn, or after
 * the limit plus 30 minutes if the turn never started.
 */
export function watchMemberTurn(room: BotRecord, member: BotRecord, thread: number) {
  const minutes = roomLimits.get(room.id, member.id);
  if (!minutes) return;
  const key = `${room.id}:${member.id}`;
  if (watching.has(key)) return;
  const limit = minutes * minuteMs();
  const since = Date.now();
  let startedAt = 0;
  const timer = setInterval(() => {
    const live = getLive(member.id);
    const t = Date.now();
    if (live.running) startedAt ||= live.startedAt ?? t;
    else if (startedAt || t - since > limit + 30 * minuteMs()) { clearInterval(timer); watching.delete(key); return; }
    if (startedAt && t - startedAt > limit) {
      clearInterval(timer);
      watching.delete(key);
      if (interrupt(laneKey(member.id, 0)))
        rows.append(room, { kind: "notice", tone: "warn", text: say(users.localeOf(room.userId), "{bot} went past its time limit in this group ({n} min): it was stopped. What it did stays.", { bot: member.name, n: String(minutes) }) }, thread);
    }
  }, pollMs());
  timer.unref?.();
  watching.set(key, timer);
}
