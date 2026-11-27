import { tr } from "./i18n.js"; import type { Locale } from "./shared.js"; import { intlOf } from "./lang/index.js";
import { bots, rows, users, type BotRecord } from "./store.js";

/**
 * L161 « file annoncée pour un ordinateur partagé » (OpenMausBot audit n° 37, DS-Bot n° 118; ideas only, our own code).
 * When the bots of an account share a computer (sharedcomputers.ts) and it is taken, a bot that has to wait says so in
 * its own chat, once, with who drives it and its place in line ("number 3, behind Léa and Max"), and goes on by itself
 * when its turn comes: the same line then says how long it waited. If the wait runs out, the line says that too.
 *
 * The line appears only after ANNOUNCE_AFTER_MS of waiting, so the short hand-overs between two clicks stay silent.
 * It is written in the thread of the turn that waits (rows.append follows the turn's lane).
 */
export const queueTiming = { announceAfterMs: 2_000 };

const name = (id: string, locale: Locale) => bots.byId(id)?.name ?? tr(locale, "another bot");
const list = (names: string[], locale: Locale) => names.length <= 1 ? names.join("") : new Intl.ListFormat(intlOf(locale), { type: "conjunction" }).format(names);
export const waitText = (ms: number, locale: Locale) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
};

export function queueLine(locale: Locale, holders: string[], ahead: string[]): string {
  const h = list(holders.map((id) => name(id, locale)), locale) || tr(locale, "another bot");
  if (!ahead.length) return tr(locale, "The shared computer is being used by {holders}. I am waiting for my turn (next in line). I will go on by myself as soon as it is free.", { holders: h });
  return tr(locale, "The shared computer is being used by {holders}. I am waiting for my turn: number {position} in line, behind {ahead}. I will go on by myself as soon as it is free.", { holders: h, position: ahead.length + 1, ahead: list(ahead.map((id) => name(id, locale)), locale) });
}

/** One wait of one bot: the line in its chat, written when the wait gets long, kept up to date, closed at the end. */
export class QueueNotice {
  private seq: number | null = null;
  private generation = 0;
  private last = "";
  private readonly bot: BotRecord | null;
  private readonly locale: Locale;
  constructor(botId: string, private readonly startedAt = Date.now()) {
    this.bot = bots.byId(botId);
    this.locale = this.bot ? users.localeOf(this.bot.userId) : "en";
  }
  /** Called at each look while the bot waits. */
  waiting(holders: string[], ahead: string[], t = Date.now()) {
    if (!this.bot || t - this.startedAt < queueTiming.announceAfterMs) return;
    const text = queueLine(this.locale, holders, ahead);
    if (text === this.last) return;
    this.last = text;
    try {
      if (this.seq === null) { const row = rows.append(this.bot, { kind: "notice", tone: "info", text }); this.seq = row.seq; this.generation = row.generation; }
      else rows.rewrite(this.bot, this.generation, this.seq, { kind: "notice", tone: "info", text });
    } catch { /* the bot was deleted while it waited */ }
  }
  private close(text: string, tone: "info" | "warn") {
    if (!this.bot || this.seq === null) return;
    try { rows.rewrite(this.bot, this.generation, this.seq, { kind: "notice", tone, text }); } catch { /* gone */ }
  }
  got(t = Date.now()) { this.close(tr(this.locale, "I waited {time} for the shared computer; it is my turn now, I am going on.", { time: waitText(t - this.startedAt, this.locale) }), "info"); }
  gaveUp(t = Date.now()) { this.close(tr(this.locale, "The shared computer was still in use after {time}: I stopped waiting. Ask me again in a moment, or add a shared computer (Settings → Computers).", { time: waitText(t - this.startedAt, this.locale) }), "warn"); }
  get announced() { return this.seq !== null; }
}
