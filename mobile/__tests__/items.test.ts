import type { Row } from "../src/api/types";
import { buildItems, stepSummary } from "../src/state/items";

const day = new Date(2026, 10, 16, 10).getTime();
const row = (seq: number, body: Row["body"], at = day + seq, thread?: number): Row => ({ botId: "b", generation: 1, seq, rev: 1, createdAt: at, body, ...(thread ? { thread } : {}) });
const step = (seq: number, label: string, status: "done" | "running" | "error" = "done") => row(seq, { kind: "step", callId: `c${seq}`, tool: "t", label, status, args: {} });

describe("buildItems", () => {
  it("groups steps, separates days and marks the user's messages", () => {
    const rows = [
      row(1, { kind: "message", role: "user", text: "hello" }),
      step(2, "Search"), step(3, "Read", "error"),
      row(4, { kind: "message", role: "assistant", text: "Hi" }),
      row(5, { kind: "message", role: "assistant", text: "" }),
      row(6, { kind: "message", role: "assistant", text: "thread" }, day + 6, 1),
      row(7, { kind: "notice", tone: "info", text: "n" }, day + 86_400_000),
    ];
    const items = buildItems(rows, false);
    expect(items.map((i) => i.t)).toEqual(["day", "msg", "steps", "msg", "day", "row"]);
    const m = items[1] as Extract<(typeof items)[number], { t: "msg" }>;
    expect(m.mine).toBe(true);
    const s = items[2] as Extract<(typeof items)[number], { t: "steps" }>;
    expect(s.rows).toHaveLength(2);
    expect(s.live).toBe(false);
    expect(stepSummary(s.rows)).toEqual({ label: "Read", count: 2, problem: true });
  });
  it("marks the last step group live while the bot works", () => {
    const items = buildItems([row(1, { kind: "message", role: "user", text: "go" }), step(2, "Working", "running")], true);
    expect(items[items.length - 1]).toMatchObject({ t: "steps", live: true });
  });
  it("on a shared bot, only the viewer's own messages are theirs", () => {
    const mine = row(1, { kind: "message", role: "user", text: "a", origin: { kind: "member", id: "me", name: "Me" } });
    const owner = row(2, { kind: "message", role: "user", text: "b" });
    const items = buildItems([mine, owner], false, "me").filter((i) => i.t === "msg") as { mine: boolean }[];
    expect(items.map((i) => i.mine)).toEqual([true, false]);
  });
});
