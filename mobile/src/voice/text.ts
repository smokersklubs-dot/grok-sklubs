/** Text helpers of calls (same rules as web/src/lib/speech.ts and web/src/lib/call.ts). Pure: unit-tested. */
import type { Bot } from "../api/types";
import { t, type Locale } from "../i18n";
import { LOCALE_INTL } from "../../../server/src/clientshared/locales";

/** What can be read aloud: no code, links, markdown marks. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ` ${t("speech.codeOmitted")} `)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, t("speech.link"))
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The language to recognise: the bot's voice language, else the app's (the web follows the interface language). */
export function recognitionLang(voice: Bot["voice"] | undefined, locale: Locale): string {
  if (voice?.lang && voice.lang !== "auto") return voice.lang;
  return locale === "en" ? "en-US" : LOCALE_INTL[locale];
}

export interface CallLine { id: number; role: "user" | "assistant"; text: string; final: boolean; cut?: boolean }

let lineId = 0;
/** A partial user line replaces the previous partial one. */
export function withPartial(lines: CallLine[], text: string): CallLine[] {
  const finals = lines.filter((l) => l.final);
  return text ? [...finals, { id: ++lineId, role: "user", text, final: false }] : finals;
}
export function withFinal(lines: CallLine[], role: "user" | "assistant", text: string): CallLine[] {
  return [...lines.filter((l) => l.final), { id: ++lineId, role, text, final: true }];
}
/** Sentences of the same reply join one caption line (the server sends a reply sentence by sentence). */
export function withAssistantSentence(lines: CallLine[], text: string): CallLine[] {
  const finals = lines.filter((l) => l.final);
  const last = finals[finals.length - 1];
  if (last?.role === "assistant" && !last.cut) return [...finals.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
  return [...finals, { id: ++lineId, role: "assistant", text, final: true }];
}
/** Barge-in: the reply being read is marked as cut. */
export function cutLast(lines: CallLine[]): CallLine[] {
  return lines.map((l, i) => (i === lines.length - 1 && l.role === "assistant" ? { ...l, cut: true } : l));
}
/** What the server keeps as the call's transcript: final lines only, the last 200. */
export function transcriptOf(lines: CallLine[]): { role: "user" | "assistant"; text: string }[] {
  return lines.filter((l) => l.final && l.text.trim()).slice(-200).map((l) => ({ role: l.role, text: l.text }));
}

/** The HTTP status in a refused WebSocket handshake ("Expected HTTP 101 response but was '409 Conflict'", OkHttp). */
export function handshakeStatus(message: string | undefined | null): number | null {
  const m = /\b([1-5]\d\d)\b(?!\s*response)/.exec(message ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n === 101 ? null : n;
}

/** Reconnection delays of a dropped server call: 1, 2, 4, 8, 15 s, then give up. */
export function reconnectDelay(attempt: number): number | null {
  const steps = [1000, 2000, 4000, 8000, 15000];
  return attempt < steps.length ? steps[attempt] : null;
}
