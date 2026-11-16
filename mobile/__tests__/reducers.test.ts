import type { Bot, Row } from "../src/api/types";
import { applyEvent, applyRowsPage, emptyThread, firstWords, mergeRows, sortBots, type LiveState } from "../src/state/reducers";

const msg = (seq: number, text: string, extra: Partial<Row> = {}, streaming = false, role: "user" | "assistant" = "assistant"): Row =>
  ({ botId: "b", generation: 1, seq, rev: 1, createdAt: 1000 + seq, body: { kind: "message", role, text, streaming }, ...extra }) as Row;
const bot = (id: string, p: Partial<Bot> = {}): Bot => ({ id, kind: "agent", name: id, primary: false, pinned: false, listHidden: false, lastActivityAt: 0, unread: 0, ...p }) as Bot;

describe("mergeRows", () => {
  it("orders by seq, keeps the newest revision, ignores thread replies", () => {
    const a = [msg(2, "b"), msg(1, "a")];
    const merged = mergeRows(a, [msg(2, "b2", { rev: 2 }), msg(3, "c"), msg(4, "t", { thread: 1 })]);
    expect(merged.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect((merged[1].body as { text: string }).text).toBe("b2");
    expect(mergeRows(merged, [msg(2, "old", { rev: 1 })])[1].rev).toBe(2);
  });
});

describe("applyRowsPage", () => {
  it("replaces the list on a newer generation and tracks hasMore", () => {
    const t = { ...emptyThread(1), rows: [msg(1, "x")], loaded: true };
    const next = applyRowsPage(t, { generation: 2, rows: [msg(1, "y", { generation: 2 })] });
    expect(next.generation).toBe(2);
    expect(next.rows).toHaveLength(1);
    expect(next.hasMore).toBe(false);
    const full = applyRowsPage(emptyThread(1), { generation: 1, rows: Array.from({ length: 200 }, (_, i) => msg(i + 1, "m")) });
    expect(full.hasMore).toBe(true);
  });
});

describe("applyEvent", () => {
  const base = (): LiveState => ({ bots: { b: bot("b") }, live: {}, threads: { b: { ...emptyThread(1), loaded: true, rows: [msg(1, "hi", {}, false, "user")] } } });

  it("streams a reply in and alerts once when it finishes", () => {
    let s = base();
    let r = applyEvent(s, { type: "rows", botId: "b", generation: 1, rows: [msg(2, "Hel", {}, true)] });
    expect(r.alerts).toEqual([]);
    s = r.state;
    r = applyEvent(s, { type: "rows", botId: "b", generation: 1, rows: [msg(2, "Hello there", { rev: 2 })] });
    expect(r.alerts).toEqual([{ kind: "reply", botId: "b", text: "Hello there" }]);
    expect(r.state.threads.b.rows).toHaveLength(2);
    r = applyEvent(r.state, { type: "rows", botId: "b", generation: 1, rows: [msg(2, "Hello there", { rev: 3 })] });
    expect(r.alerts).toEqual([]);
  });
  it("alerts when a bot starts waiting for the user", () => {
    const live = { running: true, activity: null, awaiting: { reason: "Approve the email", since: 1 }, startedAt: 1, queued: 0 };
    const r = applyEvent(base(), { type: "live", botId: "b", live });
    expect(r.alerts).toEqual([{ kind: "waiting", botId: "b", text: "Approve the email" }]);
    expect(applyEvent(r.state, { type: "live", botId: "b", live }).alerts).toEqual([]);
  });
  it("resets a conversation, updates bots and asks for reloads", () => {
    const r = applyEvent(base(), { type: "reset", botId: "b", generation: 2 });
    expect(r.state.threads.b).toMatchObject({ generation: 2, rows: [] });
    expect(applyEvent(base(), { type: "bot", bot: bot("b", { unread: 3 }) }).state.bots.b.unread).toBe(3);
    expect(applyEvent(base(), { type: "roster" }).reloadBots).toBe(true);
    expect(applyEvent(base(), { type: "tasks", botId: "b" })).toMatchObject({ reloadTasks: true, bundleOf: "b" });
    const same = base();
    expect(applyEvent(same, { type: "usage" }).state).toBe(same);
  });
});

describe("sortBots / firstWords", () => {
  it("puts the main contact first and separates rooms and shared bots", () => {
    const g = sortBots([bot("a", { lastActivityAt: 5 }), bot("p", { primary: true }), bot("r", { kind: "room" }), bot("s", { access: {} as Bot["access"] }), bot("h", { listHidden: true })]);
    expect(g.team.map((b) => b.id)).toEqual(["p", "a"]);
    expect(g.rooms.map((b) => b.id)).toEqual(["r"]);
    expect(g.shared.map((b) => b.id)).toEqual(["s"]);
  });
  it("strips markdown for previews", () => {
    expect(firstWords("**Done**: see [the report](https://x.fr)\n\n```js\ncode\n```")).toBe("Done: see the report");
    expect(firstWords("a".repeat(200), 10)).toBe("aaaaaaaaa…");
  });
});
