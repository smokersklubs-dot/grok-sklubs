/** « À toi » on the phone (lib/inbox.ts): tabs, the card's words, which approvals are answered from the list, the request. */
import type { Card } from "../src/api/types";
import { countOf, decideRequest, inboxTitle, inTab, quickAnswer, type InboxItem } from "../src/lib/inbox";

const approval = (extra: Record<string, unknown> = {}): Card => ({ type: "approval", approvalId: "ap/1", title: "Envoyer l’e-mail à Paul", detail: "", tool: "mail_send", source: "", status: "pending", ...extra }) as Card;
const question: Card = { type: "question", question: "Quel jour ?", options: ["Lundi", "Mardi"], status: "pending" };
const secret: Card = { type: "secret", name: "OPENWEATHER_KEY", reason: "météo", host: "api.openweathermap.org", header: "", prefix: "", status: "pending" };
const item = (card: Card, kind: InboxItem["kind"], seq: number): InboxItem => ({ botId: "b1", botName: "Léa", seq, thread: 0, createdAt: seq, card, kind });

test("tabs and counts", () => {
  const items = [item(approval(), "approval", 1), item(question, "question", 2), item(secret, "other", 3)];
  expect(inTab(items, "all")).toHaveLength(3);
  expect(inTab(items, "approval").map((i) => i.seq)).toEqual([1]);
  expect(countOf(items, "question")).toBe(1);
  expect(countOf(items, "other")).toBe(1);
});

test("the card's words", () => {
  expect(inboxTitle(approval())).toBe("Envoyer l’e-mail à Paul");
  expect(inboxTitle(question)).toBe("Quel jour ?");
  expect(inboxTitle(secret)).toBe("OPENWEATHER_KEY");
});

test("quick 👍 / 👎 only for a plain pending approval", () => {
  expect(quickAnswer(approval())).toBe(true);
  expect(quickAnswer(approval({ irreversible: true }))).toBe(false);
  expect(quickAnswer(approval({ draft: { body: "Bonjour" } }))).toBe(false);
  expect(quickAnswer(approval({ status: "allowed" }))).toBe(false);
  expect(quickAnswer(question)).toBe(false);
});

test("the same route as in the chat", () => {
  expect(decideRequest(approval(), "deny")).toEqual({ path: "/approvals/ap%2F1", body: { decision: "deny" } });
  expect(decideRequest(question, "allow")).toBeNull();
});
