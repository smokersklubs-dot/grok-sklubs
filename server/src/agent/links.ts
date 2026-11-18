import net from "node:net";
import { isPrivateAddress } from "../net.js";
import type { Trigger, Turn } from "./loop.js";

/**
 * Links the user typed (never links found in outside content: emails, pages, tool results). The bot has its own
 * computer to look at them, so a turn whose user message carries a public http(s) address gets a one-line hint to open
 * it there first (browser_open), where the user watches it live in the Computer panel.
 */

/** Public http(s) addresses in a piece of text, in order, without duplicates (at most `max`). */
export function publicLinksIn(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) {
    const raw = m[0].replace(/[.,;:!?…»]+$/u, "");
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (!isPublicHost(url.hostname)) continue;
    if (!out.includes(url.toString())) out.push(url.toString());
    if (out.length >= max) break;
  }
  return out;
}

/** A host that may be a public site: no local names, no private or reserved address literals, a dotted name. */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return false;
  if (net.isIP(h)) return !isPrivateAddress(h);
  if (!h.includes(".")) return false; // "localhost", "router", a bare machine name
  return !/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa|test|invalid|example)$/.test(h);
}

/**
 * The per-turn hint for a message the user typed, when the bot has a browser of its own (`hasBrowser`): empty when
 * there is no public link in it. Videos get one more line: their page is read (title, description, transcript), and,
 * with `canWatch` (the bot's Linux computer has video_frames and listen_screen, media.ts), they can also be watched.
 */
export function linkHint(userText: string, hasBrowser: boolean, canWatch = false): string {
  if (!hasBrowser) return "";
  const links = publicLinksIn(userText);
  if (!links.length) return "";
  const video = links.some((u) => /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|twitch\.tv)$/i.test(new URL(u).hostname));
  return `[The user's message contains ${links.length > 1 ? "links" : "a link"} (${links.join(", ")}): open ${links.length > 1 ? "them" : "it"} in your own computer's browser with browser_open first, so the user can watch on your screen, then read the page with page_read (element_snapshot for its controls).` +
    (video ? (canWatch
      ? " For a video, read its title, description and chapters and open its transcript when there is one; to see what it shows, play it and use video_frames (and listen_screen for its sound when there is no transcript)."
      : " For a video, read its title, description and chapters and open its transcript when there is one; you cannot watch the pictures, say so plainly.") : "") +
    " Use web_fetch or your own web tools only if the page cannot be opened.]";
}

/**
 * The per-turn link hint for a turn: only for words a person typed to this bot (not the Bot API, a teammate, a routine
 * or a system notice, whose links are outside content), and only when the turn has a browser of its own to open them in.
 */
export function userLinkHint(turn: Pick<Turn, "builtin">, trigger: Exclude<Trigger, { kind: "resume" }>): string {
  if (trigger.kind !== "user" || trigger.api) return "";
  return linkHint(trigger.text, turn.builtin.has("browser_open"), turn.builtin.has("video_frames"));
}
