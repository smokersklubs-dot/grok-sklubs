/**
 * The server keeps the session in an httpOnly cookie named `sklubot_session` (server/src/auth.ts SESSION_COOKIE).
 * The app does not use a cookie jar: it reads the cookie from the sign-in answer, keeps it in the device's secure
 * storage (Keystore / Keychain) and sends it back itself, only to the configured server.
 */
export const SESSION_COOKIE = "sklubot_session";

/**
 * Finds the session token in Set-Cookie header value(s). Several cookies may be folded into one header separated by
 * commas (Expires dates also contain commas, hence the careful split). Returns "" when the server cleared it
 * (Max-Age=0 or an empty value), null when the header does not mention it.
 */
export function sessionFromSetCookie(headers: string | string[] | null | undefined): string | null {
  if (!headers) return null;
  const list = Array.isArray(headers) ? headers : headers.split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
  let found: string | null = null;
  for (const raw of list) {
    const parts = raw.split(";").map((p) => p.trim());
    const first = parts[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0 || first.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    let value = first.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { value = decodeURIComponent(value); } catch { /* keep as is */ }
    const cleared = parts.some((p) => /^max-age\s*=\s*(0|-\d+)$/i.test(p)) || parts.some((p) => /^expires\s*=/i.test(p) && Date.parse(p.split("=").slice(1).join("=")) < Date.now());
    found = cleared ? "" : value;
  }
  return found;
}

/** The Cookie request header for a session token. */
export const cookieHeader = (token: string) => `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
