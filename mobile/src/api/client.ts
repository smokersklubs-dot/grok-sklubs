/**
 * HTTP client for the Sklubot server's JSON API under /api (server/src/routes.ts).
 *
 * - Every request goes to the one configured origin; nothing else ever gets the session.
 * - `credentials: "omit"`: the app keeps the session itself (secure storage) and sends it as a Cookie header, so no
 *   native cookie jar holds a copy. With expo/fetch (the global fetch in Expo SDK 58) "omit" switches the request to
 *   OkHttp's CookieJar.NO_COOKIES on Android, leaving our own header untouched — see
 *   node_modules/expo/android/src/main/java/expo/modules/fetch/NativeRequest.kt and
 *   https://docs.expo.dev/versions/v58.0.0/sdk/expo/#expofetch-api
 * - No Origin header is sent: the server treats such requests as a non-browser client (routes.ts, originAllowed).
 */
import { cookieHeader, sessionFromSetCookie } from "./cookie";

export class ApiError extends Error {
  status: number;
  /** The server's own message ({ error }), when it sent one. */
  serverMessage: string | null;
  constructor(message: string, status: number, serverMessage: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
  text(): Promise<string>;
}>;

export interface ClientOptions {
  origin: string;
  token: string | null;
  fetch?: FetchLike;
  /** Called when the server sets or clears the session cookie. */
  onToken?: (token: string | null) => void;
  /** Called when a request that needs a session gets a 401 (the session expired or was revoked). */
  onUnauthorized?: () => void;
  timeoutMs?: number;
}

const enc = encodeURIComponent;

export class ApiClient {
  readonly origin: string;
  private token: string | null;
  private readonly doFetch: FetchLike;
  private readonly opts: ClientOptions;

  constructor(opts: ClientOptions) {
    this.opts = opts;
    this.origin = opts.origin;
    this.token = opts.token;
    this.doFetch = opts.fetch ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));
  }

  get hasSession(): boolean {
    return !!this.token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  /** Headers that authenticate a request to the server (also used for images and downloads). */
  authHeaders(): Record<string, string> {
    return this.token ? { Cookie: cookieHeader(this.token) } : {};
  }

  url(path: string): string {
    return `${this.origin}/api${path}`;
  }

  /** A file of a bot's library, shown inline (pictures, videos) or downloaded. */
  fileUrl(botId: string, filePath: string, kind: "view" | "download" = "view"): string {
    return this.url(`/bots/${enc(botId)}/files/${kind}?path=${enc(filePath)}`);
  }

  async request<T>(method: string, path: string, body?: unknown, extra?: { raw?: { body: Uint8Array; contentType: string }; timeoutMs?: number }): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...this.authHeaders() };
    let payload: unknown;
    if (extra?.raw) {
      payload = extra.raw.body;
      headers["Content-Type"] = extra.raw.contentType;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = extra?.timeoutMs ?? this.opts.timeoutMs ?? 30_000;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.doFetch(this.url(path), { method, headers, body: payload, credentials: "omit", signal: ctrl?.signal });
    } catch {
      throw new ApiError("unreachable", 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const list = res.headers.getSetCookie?.();
    const fresh = sessionFromSetCookie(list && list.length ? list : res.headers.get("set-cookie"));
    if (fresh !== null) {
      this.token = fresh || null;
      this.opts.onToken?.(this.token);
    }
    const text = await res.text().catch(() => "");
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const serverMessage = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null;
      // A wrong password on /auth/* also answers 401; that is not a lost session.
      if (res.status === 401 && !path.startsWith("/auth/") && !path.startsWith("/account") && !/^\/me(\?|$)/.test(path)) this.opts.onUnauthorized?.();
      throw new ApiError(serverMessage ?? `HTTP ${res.status}`, res.status, serverMessage);
    }
    return data as T;
  }

  get<T>(path: string) { return this.request<T>("GET", path); }
  post<T>(path: string, body?: unknown) { return this.request<T>("POST", path, body ?? {}); }
  patch<T>(path: string, body: unknown) { return this.request<T>("PATCH", path, body); }
  put<T>(path: string, body: unknown) { return this.request<T>("PUT", path, body); }
  /**
   * POST one file as multipart/form-data (field `file`), as POST /bots/:id/uploads expects. The body is built here
   * (RFC 7578) from the file's bytes: expo/fetch does not read React Native's { uri } form parts.
   */
  upload<T>(path: string, file: { name: string; type: string; bytes: Uint8Array }) {
    const { body, contentType } = multipartBody("file", file);
    return this.request<T>("POST", path, undefined, { raw: { body, contentType }, timeoutMs: 120_000 });
  }
}

/** A multipart/form-data body with one file part (RFC 7578). The file name is kept as given, quotes and line breaks removed. */
export function multipartBody(field: string, file: { name: string; type: string; bytes: Uint8Array }, boundary = `----sklubot${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`): { body: Uint8Array; contentType: string } {
  const safe = file.name.replace(/["\r\n\\]/g, "_");
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${safe}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** GET /api/health without a session: is there a Sklubot server at this address? */
export async function checkHealth(origin: string, fetchImpl?: FetchLike, timeoutMs = 10_000): Promise<{ ok: true } | { ok: false; reason: "unreachable" | "notSklubot" }> {
  const f = fetchImpl ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await f(`${origin}/api/health`, { method: "GET", headers: { Accept: "application/json" }, credentials: "omit", signal: ctrl?.signal });
    const text = await res.text();
    const data = JSON.parse(text) as { ok?: unknown };
    return res.ok && data && data.ok === true ? { ok: true } : { ok: false, reason: "notSklubot" };
  } catch (e) {
    return { ok: false, reason: e instanceof SyntaxError ? "notSklubot" : "unreachable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
