import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// DS-Bot item 10 (agent/deletecheck.ts, bind.ts): two-step delete in the browser. The first click on a delete control is
// refused before it is judged (nothing clicked, no approval card), the second with confirm: true on the same element
// goes to the usual judgment with the click target bound; another element, another click in between, changed words, or
// 5 minutes: checked again. The model can never set the bound fields itself.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-delete-check-"));
process.env.SESSION_SECRET = "delete-check-secret-delete-check-1234";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

const { bindCall, probe } = await import("../src/agent/bind.js");
const { stageDelete, deleteCheckAnswer, DELETE_CHECK_MS } = await import("../src/agent/deletecheck.js");
const { rememberSnapshot } = await import("../src/agent/elements.js");
const { elementTools } = await import("../src/agent/tools-elements.js");

const turn = { bot: { id: "bot_del", userId: "u1" }, user: { id: "u1" }, thread: 0 } as any;
let label = "Supprimer";
probe.target = async () => ({ label, tag: "button", role: "button", type: "submit", formAction: "https://mail.example/delete", formMethod: "post", url: "https://mail.example/inbox" });
probe.element = async () => ({ label, tag: "button", role: "button", type: "", formAction: "", formMethod: "", url: "https://mail.example/inbox" });
const click = async (input: Record<string, unknown>, name = "screen_click") => { const call = { type: "tool_use" as const, id: "c", name, input: { ...input } }; await bindCall(turn, call); return call.input as Record<string, any>; };

test("screen_click: first delete click is a check (no target bound, so nothing commits); confirm on the same point goes on", async () => {
  const first = await click({ x: 100, y: 200, seen_delete: "confirmed", seen_target: { label: "x", host: "evil", form: "" } });
  assert.equal(first.seen_delete, "check", "the model's own seen_delete is replaced");
  assert.equal(first.seen_target, undefined);
  assert.deepEqual(first.seen_check, { label: "Supprimer", host: "mail.example", form: "POST https://mail.example/delete" });
  const said = deleteCheckAnswer(first)!;
  assert.match(said.content, /This would delete “Supprimer” on mail\.example\. Nothing was deleted yet\./);
  const second = await click({ x: 100, y: 200, confirm: true });
  assert.equal(second.seen_delete, "confirmed");
  assert.equal(second.seen_target.label, "Supprimer", "the target is bound again: judged and gated as a committing click");
  assert.equal(deleteCheckAnswer(second), null);
  const third = await click({ x: 100, y: 200, confirm: true });
  assert.equal(third.seen_delete, "check", "a check is used once");
});

test("screen_click: confirm on another point, after another click, after the words changed, or too late: checked again", async () => {
  await click({ x: 10, y: 10 });
  assert.equal((await click({ x: 11, y: 10, confirm: true })).seen_delete, "check", "another point");
  label = "Envoyer";
  const other = await click({ x: 50, y: 50 });
  assert.equal(other.seen_delete, undefined, "not a delete control: no check");
  label = "Supprimer";
  assert.equal((await click({ x: 11, y: 10, confirm: true })).seen_delete, "check", "another click in between cleared it");
  label = "Supprimer définitivement";
  const changed = await click({ x: 11, y: 10, confirm: true });
  assert.equal(changed.seen_delete, "check", "the words changed");
  assert.match(deleteCheckAnswer(changed)!.content, /did not match/);
  label = "Supprimer";
  const input: Record<string, unknown> = { x: 5, y: 5 };
  stageDelete("bot_late", "screen_click", input, { label: "Delete", host: "h", form: "" }, true, 1000);
  const late: Record<string, unknown> = { x: 5, y: 5, confirm: true };
  stageDelete("bot_late", "screen_click", late, { label: "Delete", host: "h", form: "" }, true, 1000 + DELETE_CHECK_MS + 1);
  assert.equal(late.seen_delete, "check", "lapsed after 5 minutes");
});

test("element_click: the same element (node, document, tab) — another element with the same words is checked again", async () => {
  const listing = rememberSnapshot("bot_del", { url: "https://mail.example/inbox", title: "Inbox", target: "T1", loader: "L1", more: 0, elements: [{ node: 11, role: "button", name: "Supprimer" }, { node: 12, role: "button", name: "Supprimer" }] as any });
  const refs = [...listing.matchAll(/\b([0-9a-z]{2,}\.\d+)\b/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, listing);
  const first = await click({ ref: refs[0] }, "element_click");
  assert.equal(first.seen_delete, "check");
  assert.equal((await click({ ref: refs[1], confirm: true }, "element_click")).seen_delete, "check", "same words, another row");
  await click({ ref: refs[0] }, "element_click");
  const ok = await click({ ref: refs[0], confirm: true }, "element_click");
  assert.equal(ok.seen_delete, "confirmed");
  assert.equal(ok.seen_target.label, "Supprimer");
});

test("element_click answers a check without clicking (no helper call)", async () => {
  const tool = elementTools.find((t) => t.spec.name === "element_click")!;
  assert.ok((tool.spec.inputSchema as any).properties.confirm, "confirm is in the schema");
  const out = await tool.run({ ref: "zz.1", seen_delete: "check", seen_check: { label: "Delete", host: "a.example", form: "" } }, { bot: { id: "nobody" }, user: { id: "u" } } as any);
  assert.equal(out.summary, "delete: check first");
  assert.match(String(out.content), /This would delete “Delete” on a\.example/);
  assert.equal(deleteCheckAnswer({ seen_delete: "confirmed" }), null);
});
