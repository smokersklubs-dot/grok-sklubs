/**
 * L177 « bot qui rejoint une réunion » — which meeting links a bot may join, and the exact address it opens.
 *
 * Only four services, each through its own documented guest path in a normal browser (no SDK, no API):
 *  - Google Meet: open the meeting link, type a name, « Ask to join »; someone in the meeting lets the guest in
 *    (support.google.com/meet/answer/9303069 « Join a meeting », guests without a Google Account).
 *  - Zoom: the web client. Zoom's developer forum gives the browser form of a join link: replace "/j/" with "/wc/",
 *    i.e. https://zoom.us/wc/{meetingID}/join (devforum.zoom.us/t/join-from-browser-url/42162). Only the meeting id and
 *    its "pwd" passcode are kept; the host of the link (zoom.us or a company's *.zoom.us) is kept as given.
 *  - Microsoft Teams: the meeting link, then « Continue on this browser » and a name, without a Teams account
 *    (support.microsoft.com « Join a meeting without an account in Microsoft Teams », c6efc38f-4e03-4e79-b28f-e65a4c039508).
 *  - Jitsi Meet (meet.jit.si, 8x8.vc): the room link. Options go in the link's fragment as `config.<key>=<value>` joined
 *    by `&`; `startWithAudioMuted` / `startWithVideoMuted` turn the microphone and camera off on joining
 *    (jitsi.github.io/handbook/docs/user-guide/user-guide-advanced, « URL parameters »).
 * Anything else (another host, a link with a login or a password in it, plain http) is refused with a plain reason.
 */
export type MeetingPlatform = "meet" | "zoom" | "teams" | "jitsi";
export const PLATFORM_LABEL: Record<MeetingPlatform, string> = { meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", jitsi: "Jitsi Meet" };
export type MeetingLink = { ok: true; platform: MeetingPlatform; url: string; host: string } | { ok: false; error: string };

const MAX_LINK = 2000;
const JITSI_HOSTS = ["meet.jit.si", "8x8.vc"];
const JITSI_MUTED = "#config.startWithAudioMuted=true&config.startWithVideoMuted=true";

const bad = (error: string): MeetingLink => ({ ok: false, error });

/** The address the bot opens for a meeting link the owner gave, or why it cannot. Pure (tests). */
export function meetingLink(raw: unknown): MeetingLink {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return bad("Give the meeting link (Google Meet, Zoom, Microsoft Teams or Jitsi).");
  if (text.length > MAX_LINK || /[\s\0]/.test(text)) return bad("This meeting link is not valid.");
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { return bad("This meeting link is not valid."); }
  if (u.protocol !== "https:") return bad("Only secure meeting links (https) can be joined.");
  if (u.username || u.password) return bad("This meeting link carries a login: the bot never uses one.");
  if (u.port) return bad("This meeting link is not valid.");
  const host = u.hostname.toLowerCase();

  if (host === "meet.google.com") {
    const code = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/.exec(u.pathname)?.[1];
    if (!code) return bad("This Google Meet link has no meeting code (like abc-defg-hij).");
    return { ok: true, platform: "meet", host, url: `https://meet.google.com/${code}` };
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const id = /^\/(?:j|wc|w|s)\/(\d{9,11})(?:\/join)?\/?$/.exec(u.pathname)?.[1] ?? /^\/wc\/join\/(\d{9,11})\/?$/.exec(u.pathname)?.[1];
    if (!id) return bad("This Zoom link has no meeting number. Use the invitation link (…zoom.us/j/123456789…).");
    const pwd = u.searchParams.get("pwd");
    const q = pwd && /^[A-Za-z0-9._-]{1,128}$/.test(pwd) ? `?pwd=${pwd}` : "";
    return { ok: true, platform: "zoom", host, url: `https://${host}/wc/${id}/join${q}` };
  }
  if (host === "teams.microsoft.com" || host === "teams.live.com") {
    if (!/^\/(?:l\/meetup-join\/|meet\/)/.test(u.pathname)) return bad("This Teams link is not a meeting invitation (…/l/meetup-join/… or …/meet/…).");
    return { ok: true, platform: "teams", host, url: `https://${host}${u.pathname}${u.search}` };
  }
  if (JITSI_HOSTS.includes(host)) {
    const room = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^[A-Za-z0-9_.-]{3,120}(?:\/[A-Za-z0-9_.-]{3,120})?$/.test(room)) return bad("This Jitsi link has no room name.");
    return { ok: true, platform: "jitsi", host, url: `https://${host}/${room}${JITSI_MUTED}` };
  }
  return bad("Only Google Meet, Zoom, Microsoft Teams and Jitsi Meet links can be joined.");
}

/** The name shown in the meeting: « <Bot> (assistant de <owner>) — prend des notes ». */
export function guestName(bot: string, owner: string, locale: string): string {
  const b = bot.replace(/[\r\n<>]/g, " ").trim().slice(0, 40) || "Sklubot";
  const o = owner.replace(/[\r\n<>]/g, " ").trim().slice(0, 40);
  if (locale === "fr") return o ? `${b} (assistant de ${o}) — prend des notes` : `${b} (assistant) — prend des notes`;
  return o ? `${b} (${o}'s assistant) — taking notes` : `${b} (assistant) — taking notes`;
}

/** What the bot writes in the meeting's chat as soon as it is in. */
export function announcement(bot: string, owner: string, locale: string): string {
  const o = owner.trim().slice(0, 40) || (locale === "fr" ? "mon propriétaire" : "my owner");
  return locale === "fr"
    ? `Bonjour, je suis ${bot}, un assistant automatique. Je prends des notes pour ${o} ; dites-le si vous refusez (écrivez « je refuse ») et je quitte la réunion.`
    : `Hello, I am ${bot}, an automated assistant. I am taking notes for ${o}; say so if you refuse (write "I refuse") and I will leave the meeting.`;
}

/** Words that make the bot leave when a participant writes them in the meeting chat (accents and case ignored). */
export const REFUSAL_WORDS = ["je refuse", "refus", "pas d'enregistrement", "pas de notes", "pas de bot", "bot dehors", "stop bot", "i refuse", "i object", "no recording", "no bot", "stop recording", "bot leave"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").toLowerCase();

/**
 * The refusal word a participant wrote, or null. `chat` is the meeting chat as read now; every message the bot wrote
 * itself (its announcement mentions refusing) is taken out first, so the bot never reacts to its own words.
 */
export function refusalIn(chat: string, own: string[], extra: string[] = []): string | null {
  let text = fold(chat);
  for (const m of own) if (m.trim()) text = text.split(fold(m.trim())).join(" ");
  for (const w of [...REFUSAL_WORDS, ...extra]) {
    const word = fold(w.trim());
    if (word.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (re.test(text)) return w.trim();
  }
  return null;
}
