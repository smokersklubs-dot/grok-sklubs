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
import { sendFileParts } from "../../shared/uploadParts";

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
  arrayBuffer?(): Promise<ArrayBuffer>;
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

  async request<T>(method: string, path: string, body?: unknown, extra?: { raw?: { body: Uint8Array | Blob; contentType: string; filename?: string }; timeoutMs?: number }): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...this.authHeaders() };
    let payload: unknown;
    if (extra?.raw) {
      payload = extra.raw.body;
      headers["Content-Type"] = extra.raw.contentType;
      if (extra.raw.filename) headers["X-Sklubot-Filename"] = encodeURIComponent(extra.raw.filename);
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

  /**
   * GET raw bytes (the bot's screenshot): the status and the body, without JSON. 204 → null body. Same session header,
   * same 401 handling as JSON requests.
   */
  async bytes(path: string, timeoutMs = 15_000): Promise<{ status: number; bytes: Uint8Array | null }> {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.doFetch(this.url(path), { method: "GET", headers: { ...this.authHeaders() }, credentials: "omit", signal: ctrl?.signal });
    } catch {
      throw new ApiError("unreachable", 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 401) this.opts.onUnauthorized?.();
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    if (res.status === 204 || !res.arrayBuffer) return { status: res.status, bytes: null };
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
  }

  /**
   * POST JSON, answer as raw bytes (« Écouter »: POST /bots/:id/rows/:seq/speak answers audio/wav). Not ok → the
   * status with the server's JSON error, no bytes.
   */
  async postBytes(path: string, body: unknown, timeoutMs = 40_000): Promise<{ status: number; bytes: Uint8Array | null; header(name: string): string | null; error: string | null }> {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.doFetch(this.url(path), { method: "POST", headers: { "Content-Type": "application/json", ...this.authHeaders() }, body: JSON.stringify(body), credentials: "omit", signal: ctrl?.signal });
    } catch {
      throw new ApiError("unreachable", 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 401) this.opts.onUnauthorized?.();
    const header = (name: string) => res.headers.get(name);
    if (!res.ok) {
      let error: string | null = null;
      try { const j = JSON.parse(await res.text()) as { error?: unknown }; if (typeof j.error === "string") error = j.error; } catch { /* not JSON */ }
      return { status: res.status, bytes: null, header, error };
    }
    return { status: res.status, bytes: res.arrayBuffer ? new Uint8Array(await res.arrayBuffer()) : null, header, error: null };
  }

  async uploadLargeFile<T>(path: string, name: string, file: { size: number; open(): { offset: number | null; readBytes(count: number): Promise<Uint8Array>; close(): void } }, progress?: (value: number) => void) {
    const handle = file.open();
    try {
      const size = file.size;
      const session = await this.post<{ id: string; partBytes: number }>(path + "/start", { name, size });
      return await sendFileParts<T, Uint8Array>(size, session, {
        read: (start, end) => { handle.offset = start; return handle.readBytes(end - start); },
        send: (id, offset, bytes) => this.request("POST", path + "/" + enc(id) + "?offset=" + offset, undefined, { raw: { body: bytes, contentType: "application/octet-stream" }, timeoutMs: 600_000 }),
        cancel: id => this.request("DELETE", path + "/" + enc(id)),
        progress,
      });
    } finally { handle.close(); }
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
