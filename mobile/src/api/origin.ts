/**
 * The server address the app talks to. Only this origin ever receives the session; it must be https, except for a
 * server on this device or on the computer running the Android emulator (development).
 *
 * Parsed with a small regular expression rather than `URL`: React Native's URL polyfill does not implement every
 * getter on all versions, and an origin is all we need.
 */
export const DEFAULT_SERVER = "https://sklubot.sklubs.fr";

/** Hosts allowed over plain http: the device itself and the emulator's alias for the host computer (10.0.2.2). */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2", "[::1]"]);

export type OriginResult = { ok: true; origin: string } | { ok: false; reason: "empty" | "invalid" | "insecure" };

// scheme://host[:port][/anything]
const ORIGIN_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#@\s]+)(?:[/?#].*)?$/i;
const HOST_RE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

/** Turns what the person typed ("sklubot.example.com", "https://x.fr/", "http://10.0.2.2:8799") into a clean origin. */
export function normalizeOrigin(input: string): OriginResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const m = ORIGIN_RE.exec(withScheme);
  if (!m) return { ok: false, reason: "invalid" };
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  const pm = /^(.*?)(?::(\d{1,5}))?$/.exec(authority);
  const host = pm?.[1] ?? "";
  const port = pm?.[2];
  if (!HOST_RE.test(host) || (port !== undefined && (Number(port) < 1 || Number(port) > 65535))) return { ok: false, reason: "invalid" };
  if (scheme === "http") {
    if (!DEV_HOSTS.has(host)) return { ok: false, reason: "insecure" };
  } else if (scheme !== "https") {
    return { ok: false, reason: "invalid" };
  }
  const defaultPort = scheme === "https" ? "443" : "80";
  return { ok: true, origin: `${scheme}://${host}${port && port !== defaultPort ? `:${port}` : ""}` };
}

/** Whether `url` points at `origin` (same scheme, host and port). Checked before any request carries the session. */
export function sameOrigin(url: string, origin: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  const n = normalizeOrigin(url);
  return n.ok && n.origin === origin;
}
