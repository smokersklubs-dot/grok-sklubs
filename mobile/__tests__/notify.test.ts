import type { Bot } from "../src/api/types";
import { newsSince } from "../src/notify/news";

const bot = (id: string, unread: number, preview = "p"): Bot => ({ id, name: id.toUpperCase(), unread, preview } as Bot);

describe("background check", () => {
  it("announces only new unread messages and new waits", () => {
    const live = { b: { running: true, activity: null, awaiting: { reason: "Approve", since: 1 }, startedAt: 1, queued: 0 } };
    const out = newsSince({ a: { unread: 1, waiting: false }, b: { unread: 0, waiting: false } }, [bot("a", 2, "new msg"), bot("b", 0), bot("c", 0)], live);
    expect(out).toEqual([{ botId: "a", title: "A", body: "new msg" }, { botId: "b", title: "B", body: "Approve" }]);
    expect(newsSince({ a: { unread: 2, waiting: false }, b: { unread: 0, waiting: true } }, [bot("a", 2), bot("b", 0)], live)).toEqual([]);
  });
});
