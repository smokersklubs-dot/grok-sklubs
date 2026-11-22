import net from "node:net";
import { isPrivateAddress } from "../net.js";
import type { Trigger, Turn } from "./loop.js";

/**
 * Links the user typed (never links found in outside content: emails, pages, tool results). The bot has its own
 * computer to look at them, so a turn whose user message carries a public address (with or without http://) gets a
 * one-line hint to open it there first (browser_open), where the user watches it live in the Computer panel.
 */

/**
 * Top-level domains a bare name (no http://) must end with to be read as a link. A closed list on purpose: the common
 * generic ones and the countries people here write most. Endings that are also everyday file types or words are left out
 * (.md, .py, .sh, .rs, .zip, .mov, .pl, .ps, .so, .st, .to, .is, .it, .me, .no, .be…): "notes.md", "main.py" or "truc.it"
 * are not links. A name that starts with "www." is a link whatever its ending.
 */
const BARE_TLDS = new Set(("com org net fr io ai app dev co uk de es ch ca eu info biz tv gg xyz site online shop store tech blog news cloud fm ly " +
  "nl se dk fi pt ie at lu us au nz jp cn in br mx ar ru ua cz gr ro hu tr il za sg hk kr tw page link live studio design agency media life world today club art").split(" "));
/**
 * A bare domain name, with an optional path: not inside an e-mail address, a longer word, a file path or a full address,
 * and not a quoted value ("site": "portal.example.com" in a piece of JSON or code is a name, not something to open).
 */
const BARE_LINK = /(?<![@\w./:\\"'`-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})((?:[/?#][^\s<>"'`)\]]*)?)(?![\w@-])/gi;

/** Whether a bare name reads as a site: "www." in front, or a known ending. */
function bareHostOk(host: string): boolean {
  const labels = host.toLowerCase().split(".");
  const tld = labels[labels.length - 1];
  if (labels[0] === "www" && labels.length >= 3) return /^[a-z]{2,}$/.test(tld);
  // A known ending (so "e.g", "p.ex", "file.txt" or "U.S.A" never pass), and a name that is not just digits.
  return BARE_TLDS.has(tld) && labels.slice(0, -1).some((l) => /[a-z]/.test(l));
}

/**
 * Public addresses in a piece of text, in order, without duplicates (at most `max`): full http(s) addresses, and bare
 * domain names a person types without the scheme ("youtube.com/watch?v=…", "www.site.fr", "sklubs.fr"), read as https.
 * Bare names are recognised conservatively (bareHostOk): a file name, an abbreviation or a version number is not a link.
 */
export function publicLinksIn(text: string, max = 3): string[] {
  return linksIn(text, max).map((l) => l.url);
}
/** The same, saying for each whether it was typed as a bare name (`bare`) or as a full address. */
function linksIn(text: string, max: number): { url: string; bare: boolean }[] {
  const src = String(text ?? "");
  const found: { at: number; raw: string; bare?: boolean }[] = [];
  for (const m of src.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) found.push({ at: m.index, raw: m[0] });
  for (const m of src.matchAll(BARE_LINK)) {
    // A sentence glued to the next one ("fin.Début") has a capital right after the dot: a typed domain is lower case there.
    if (!bareHostOk(m[1]) || /\.[A-Z]/.test(m[1].slice(m[1].indexOf(".")))) continue;
    if (found.some((f) => m.index >= f.at && m.index < f.at + f.raw.length)) continue; // already part of a full address
    found.push({ at: m.index, raw: `https://${m[1]}${m[2]}`, bare: true });
  }
  const out: { url: string; bare: boolean }[] = [];
  for (const f of found.sort((a, b) => a.at - b.at)) {
    const raw = f.raw.replace(/[.,;:!?…»]+$/u, "");
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (!isPublicHost(url.hostname)) continue;
    if (!out.some((o) => o.url === url.toString())) out.push({ url: url.toString(), bare: !!f.bare });
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
  const typed = linksIn(userText, 3);
  if (!typed.length) return "";
  const links = typed.map((l) => l.url);
  // Only bare names ("sklubs.fr"): a site may be named without wanting it opened (an account, an address to write down).
  const maybe = typed.every((l) => l.bare);
  const video = links.some((u) => /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|twitch\.tv)$/i.test(new URL(u).hostname));
  return `[The user's message contains ${links.length > 1 ? "links" : "a link"} (${links.join(", ")})${maybe ? `, written without http://. Unless ${links.length > 1 ? "they are" : "it is"} only named (an account, an address to note down)` : ""}: open ${links.length > 1 ? "them" : "it"} in your own computer's browser with browser_open first, so the user can watch on your screen, then read the page with page_read (element_snapshot for its controls).` +
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

/** "https://www.Example.com/x" or "example.com" → "example.com"; "" when there is no usable host. */
export function hostOf(url: unknown): string {
  const s = String(url ?? "").trim();
  if (!s) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
/** Hosts named in a piece of text (addresses and bare domain names). */
export function hostsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) { const h = hostOf(m[0]); if (h) out.add(h); }
  for (const m of text.matchAll(/(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi)) { const h = hostOf(m[1]); if (h) out.add(h); }
  return [...out];
}
