import { EventStream, SseParser, type StreamFetch } from "../src/api/sse";

describe("SseParser", () => {
  it("parses messages split across chunks and line endings", () => {
    const p = new SseParser();
    expect(p.feed('data: {"type":"hel')).toEqual([]);
    expect(p.feed('lo"}\n\ndata: a\r\ndata: b\r')).toEqual([{ event: "message", data: '{"type":"hello"}', id: null }]);
    expect(p.feed("\n\r\n")).toEqual([{ event: "message", data: "a\nb", id: null }]);
  });
  it("handles comments, event names, ids and fields without a space", () => {
    const p = new SseParser();
    expect(p.feed(": keep-alive\n\nevent: x\nid: 7\ndata:1\n\n")).toEqual([{ event: "x", data: "1", id: "7" }]);
    expect(p.feed("event: y\n\n")).toEqual([]);
  });
});

function streamOf(chunks: string[], status = 200): StreamFetch {
  return async () => {
    const enc = new TextEncoder();
    let i = 0;
    return {
      ok: status === 200, status,
      body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }), cancel: async () => undefined }) },
    };
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("EventStream", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("delivers messages, then reconnects with backoff after a drop", async () => {
    const got: string[] = [];
    const opens: boolean[] = [];
    const downs: number[] = [];
    let n = 0;
    const s = new EventStream({
      url: () => "https://x.fr/api/events", headers: () => ({ Cookie: "sklubot_session=t" }),
      onMessage: (d) => got.push(d), onOpen: (r) => opens.push(r), onDown: (ms) => downs.push(ms),
      fetch: (url, init) => { n++; return streamOf([`data: {"n":${n}}\n\n`])(url, init); },
    });
    s.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(got).toEqual(['{"n":1}']);
    expect(downs).toEqual([1000]);
    await jest.advanceTimersByTimeAsync(1000);
    expect(got).toEqual(['{"n":1}', '{"n":2}']);
    expect(opens).toEqual([false, true]);
    expect(downs).toEqual([1000, 2000]);
    s.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(n).toBe(2);
  });

  it("stops and reports a lost session on 401", async () => {
    let lost = 0;
    const s = new EventStream({ url: () => "u", headers: () => ({}), onMessage: () => undefined, onUnauthorized: () => lost++, fetch: streamOf([], 401) });
    s.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(lost).toBe(1);
    expect(s.active).toBe(false);
  });

  it("caps the retry delay at 15 s", async () => {
    const downs: number[] = [];
    const s = new EventStream({ url: () => "u", headers: () => ({}), onMessage: () => undefined, onDown: (ms) => downs.push(ms), fetch: async () => { throw new Error("down"); } });
    s.start();
    for (let i = 0; i < 7; i++) await jest.advanceTimersByTimeAsync(16_000);
    expect(downs.slice(0, 6)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    s.stop();
    void flush;
  });
});
