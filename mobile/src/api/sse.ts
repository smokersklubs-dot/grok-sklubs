/**
 * The server's live channel: GET /api/events, a server-sent event stream (text/event-stream, one JSON ServerEvent per
 * message; a { type: "ping" } every 20 s when nothing happens — server/src/routes.ts).
 *
 * React Native has no EventSource. Expo SDK 58's fetch (expo/fetch, installed as the global fetch) streams response
 * bodies (`response.body.getReader()`), see https://docs.expo.dev/versions/v58.0.0/sdk/expo/#expofetch-api — so the
 * stream is read with fetch and parsed here, following the WHATWG "event stream interpretation" rules
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).
 */

export interface SseMessage { event: string; data: string; id: string | null }

/** Incremental parser: feed it text chunks as they arrive, it returns the complete messages. */
export class SseParser {
  private buf = "";
  private data: string[] = [];
  private event = "";
  private id: string | null = null;
  private sawCR = false;

  feed(chunk: string): SseMessage[] {
    const out: SseMessage[] = [];
    let text = chunk;
    // A "\r\n" split across two chunks: the "\n" that follows a final "\r" was already a line end.
    if (this.sawCR && text.startsWith("\n")) text = text.slice(1);
    this.sawCR = text.endsWith("\r");
    this.buf += text;
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (ch !== "\n" && ch !== "\r") continue;
      const line = this.buf.slice(start, i);
      if (ch === "\r" && this.buf[i + 1] === "\n") i++;
      start = i + 1;
      this.line(line, out);
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  private line(line: string, out: SseMessage[]) {
    if (line === "") {
      if (this.data.length) out.push({ event: this.event || "message", data: this.data.join("\n"), id: this.id });
      this.data = [];
      this.event = "";
      return;
    }
    if (line.startsWith(":")) return; // comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
    else if (field === "id" && !value.includes("\0")) this.id = value;
  }
}

type Reader = { read(): Promise<{ done: boolean; value?: Uint8Array | string }>; cancel?(): Promise<void> };
export type StreamFetch = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  body: { getReader(): Reader } | null;
}>;

export interface EventStreamOptions {
  url: () => string;
  headers: () => Record<string, string>;
  onMessage: (data: string) => void;
  /** The stream is up (a 200 answer arrived). `reconnected`: it had been up before. */
  onOpen?: (reconnected: boolean) => void;
  /** The stream dropped; it reconnects on its own after `retryInMs`. */
  onDown?: (retryInMs: number) => void;
  /** 401: the session is gone. The stream stops. */
  onUnauthorized?: () => void;
  fetch?: StreamFetch;
  /** Reconnect when nothing (not even a ping) arrived for this long. The server pings every 20 s. */
  idleMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

/** One live connection with reconnect (1 s doubling up to 15 s, like the web app) and an idle watchdog. */
export class EventStream {
  private running = false;
  private ctrl: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private delay: number;
  private openedBefore = false;
  private generation = 0;
  private readonly o: Required<Pick<EventStreamOptions, "idleMs" | "minDelayMs" | "maxDelayMs">> & EventStreamOptions;

  constructor(opts: EventStreamOptions) {
    this.o = { idleMs: 45_000, minDelayMs: 1_000, maxDelayMs: 15_000, ...opts };
    this.delay = this.o.minDelayMs;
  }

  get active() { return this.running; }

  start() {
    if (this.running) return;
    this.running = true;
    this.delay = this.o.minDelayMs;
    void this.connect();
  }

  stop() {
    this.running = false;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.retryTimer = this.idleTimer = null;
    this.ctrl?.abort();
    this.ctrl = null;
  }

  /** Drop the current connection and connect again now (e.g. when the app comes back to the foreground). */
  restart() {
    this.stop();
    this.start();
  }

  /** The server said hello: the connection is healthy, so the next drop retries quickly again. */
  resetBackoff() {
    this.delay = this.o.minDelayMs;
  }

  private kick() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.ctrl?.abort(), this.o.idleMs);
  }

  private async connect() {
    const gen = ++this.generation;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.ctrl = ctrl;
    const f: StreamFetch = this.o.fetch ?? ((url, init) => (globalThis.fetch as unknown as StreamFetch)(url, init));
    let unauthorized = false;
    try {
      this.kick();
      const res = await f(this.o.url(), { method: "GET", headers: { Accept: "text/event-stream", "Cache-Control": "no-cache", ...this.o.headers() }, credentials: "omit", signal: ctrl?.signal });
      if (gen !== this.generation) return;
      if (res.status === 401) {
        unauthorized = true;
        return;
      }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      this.o.onOpen?.(this.openedBefore);
      this.openedBefore = true;
      const reader = res.body.getReader();
      const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
      const parser = new SseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (gen !== this.generation) {
          void reader.cancel?.().catch(() => undefined);
          return;
        }
        if (done) break;
        this.kick();
        const text = typeof value === "string" ? value : value && decoder ? decoder.decode(value, { stream: true }) : "";
        for (const msg of parser.feed(text)) this.o.onMessage(msg.data);
      }
    } catch {
      /* dropped, refused or timed out: retried below */
    } finally {
      if (gen === this.generation) {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
        if (unauthorized) {
          this.running = false;
          this.o.onUnauthorized?.();
        } else if (this.running) {
          const wait = this.delay;
          this.delay = Math.min(this.delay * 2, this.o.maxDelayMs);
          this.o.onDown?.(wait);
          this.retryTimer = setTimeout(() => { if (this.running && gen === this.generation) void this.connect(); }, wait);
        }
      }
    }
  }
}
