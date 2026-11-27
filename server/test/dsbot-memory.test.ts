import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Audit DS-Bot #81 #82 F5 (À faire n° 5: pin, end date, a change of mind updates the note), #58 #78 (n° 6: group memory),
// #84 #77 (n° 7: daily tidy, undone in one go, only the bot's own notes, a card for sensitive ones).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-dsmem-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "mem:m";
delete process.env.AUX_MODEL;

const { registerProvider } = await import("../src/llm/index.js");
const { consolidate } = await import("../src/agent/memory.js");
const { pickMemories } = await import("../src/agent/prompt.js");
const { changeNote } = await import("../src/agent/memorybook.js");
const { cleanDay, isExpired } = await import("../src/agent/memorymarks.js");
const { undoChange } = await import("../src/agent/undoable.js");
const { tidyMemory, tidyDue, ENTRIES_MIN } = await import("../src/agent/memorytidy.js");
const { roomMemoryTools, roomNotesText } = await import("../src/agent/roommemory.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { createRoom } = await import("../src/agent/team.js");
const { users, bots, memories, rows } = await import("../src/store.js");
const { q } = await import("../src/db.js");

let answer = '{"facts": []}';
const prompts: string[] = [];
registerProvider({ id: "mem", label: "Mem", models: ["m"], available: () => true, async runTurn(req) { prompts.push(JSON.stringify(req.messages)); return { content: [{ type: "text", text: answer }], stopReason: "end", model: "m", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; } });

const user = users.create("mem@example.com", "Mé", "x", "fr");
const mk = (name: string) => bots.create(user.id, { name, model: "mem:m" });
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
const say = (bot: any, text: string) => rows.append(bot, { kind: "message", role: "user", text });

test("n° 5 — before: a note has no pin and no end date (defect confirmed: the columns did not exist)", () => {
  const cols = q.all<{ name: string }>("PRAGMA table_info(memories)").map((c) => c.name);
  assert.ok(cols.includes("pinned") && cols.includes("until_day"), "added at load");
  assert.equal(cleanDay("2026-02-30"), null);
  assert.equal(cleanDay("2026-03-31"), "2026-03-31");
  assert.equal(isExpired({ until: "2020-01-01" }), true);
});

test("n° 5 — a pinned note comes first in the prompt; a note past its last day leaves it; the owner sets both", () => {
  const b = mk("Épingles");
  const old = memories.add(b.id, "The user likes green.", "chat");
  memories.add(b.id, "The user likes blue.", "chat");
  const dated = memories.add(b.id, "The user is on holiday.", "chat");
  changeNote(user, old.id, { pinned: true });
  changeNote(user, dated.id, { until: day(-1) });
  const lines = pickMemories(bots.byId(b.id)!).lines;
  assert.match(lines[0] ?? "", /^- \(pinned\) The user likes green\./);
  assert.ok(!lines.some((l) => l.includes("holiday")), "past its day: out of the prompt");
  assert.equal(memories.owned(user.id, dated.id)!.status, "active", "not deleted, not archived by the prompt");
  assert.throws(() => changeNote(user, dated.id, { until: "bientôt" }), /YYYY-MM-DD/);
  changeNote(user, dated.id, { until: day(3) });
  assert.ok(pickMemories(bots.byId(b.id)!).lines.some((l) => l.includes(`holds until ${day(3)}`)));
});

test("n° 5 — the user changes their mind: the note is updated in place (not duplicated), with « Annuler »", async () => {
  const b = mk("Avis");
  const note = memories.add(b.id, "The user prefers tea.", "learned", { quote: "je bois du thé" });
  q.run("UPDATE memories SET created_at = created_at - 60000 WHERE id = ?", note.id);
  say(bots.byId(b.id)!, "Finalement je préfère le café le matin.");
  answer = JSON.stringify({ facts: [{ text: "The user prefers coffee in the morning.", quote: "Finalement je préfère le café le matin", contradicts: "The user prefers tea." }] });
  await consolidate(bots.byId(b.id)!);
  const all = memories.list(b.id);
  assert.equal(all.length, 1, "no second note");
  assert.equal(all[0].id, note.id, "same note");
  assert.equal(all[0].text, "The user prefers coffee in the morning.");
  const undo = rows.list(b.id, bots.byId(b.id)!.generation, 20).find((r) => r.body.kind === "notice" && r.body.action?.kind === "undo");
  assert.ok(undo && undo.body.kind === "notice" && /Mémoire mise à jour/.test(undo.body.text));
  assert.equal(undoChange(bots.byId(b.id)!, (undo!.body as any).action.undoId), "done");
  assert.equal(memories.owned(user.id, note.id)!.text, "The user prefers tea.");
});

test("n° 5 — a pinned note is never changed by the learning: the card asks instead; an end date the user gave is kept", async () => {
  const b = mk("Pinned");
  const note = memories.add(b.id, "The user works at SKLUBS.", "learned");
  changeNote(user, note.id, { pinned: true });
  q.run("UPDATE memories SET created_at = created_at - 60000 WHERE id = ?", note.id);
  say(bots.byId(b.id)!, "Désormais je travaille chez Acme. Je suis à Lisbonne jusqu'à fin mars.");
  answer = JSON.stringify({ facts: [
    { text: "The user works at Acme.", quote: "Désormais je travaille chez Acme", contradicts: "The user works at SKLUBS." },
    { text: "The user is in Lisbon.", quote: "Je suis à Lisbonne jusqu'à fin mars", until: "2027-03-31" },
  ] });
  await consolidate(bots.byId(b.id)!);
  assert.equal(memories.owned(user.id, note.id)!.text, "The user works at SKLUBS.");
  assert.ok(rows.list(b.id, bots.byId(b.id)!.generation, 20).some((r) => r.body.kind === "card" && r.body.card.type === "memory"));
  assert.equal(memories.list(b.id).find((m) => m.text === "The user is in Lisbon.")?.until, "2027-03-31");
  assert.match(prompts.at(-1) ?? "", /until/);
});

test("n° 6 — group notes: kept under the group, only for its members, shown in the group's messages, never in a member's own memory", async () => {
  const a = mk("Alba"), c = mk("Cyr"), out = mk("Dehors");
  const room = createRoom(user.id, "Projet Atlas", [a.id, c.id]);
  const save = roomMemoryTools.find((t) => t.spec.name === "group_note_save")!;
  const read = roomMemoryTools.find((t) => t.spec.name === "group_notes")!;
  const ctx = (bot: any) => ({ bot, user, depth: 0, signal: new AbortController().signal });
  const r = await save.run({ room: "Projet Atlas", text: "Les livrables partent le vendredi." }, ctx(a) as any);
  assert.equal(r.isError, undefined);
  assert.equal(memories.list(a.id).length, 0, "not in the member's own memory");
  assert.equal(memories.list(room.id).length, 1, "kept under the group");
  assert.match((await read.run({ room: "Projet Atlas" }, ctx(c) as any)).content as string, /vendredi/);
  const refused = await read.run({ room: "Projet Atlas" }, ctx(out) as any);
  assert.equal(refused.isError, true, "a bot outside the group cannot read them");
  assert.equal((await save.run({ room: "Projet Atlas", text: "Le mot de passe du wifi : Hunter2-secret!" }, ctx(a) as any)).isError, true, "never a secret");
  assert.match(roomNotesText(bots.byId(room.id)!), /Notes of this group[\s\S]*vendredi/);
  assert.ok(!pickMemories(bots.byId(a.id)!).lines.some((l) => l.includes("vendredi")), "isolated from the member's private prompt");
  assert.ok(memories.owned(user.id, memories.list(room.id)[0].id), "the owner sees and edits it like any note");
  assert.ok(builtinTools({ owner: user.id }).some((t) => t.spec.name === "group_note_save"));
});

test("n° 7 — the daily tidy merges and sets aside the bot's own notes, at most a fifth, one « Annuler » for all", async () => {
  const b = mk("Rangement");
  for (let i = 0; i < 10; i++) memories.add(b.id, `Fact number ${i} about the project.`, "learned");
  memories.add(b.id, "Imported fact.", "import");
  const pinned = memories.add(b.id, "Pinned fact.", "learned"); changeNote(user, pinned.id, { pinned: true });
  const ended = memories.add(b.id, "Trip to Rome.", "learned"); changeNote(user, ended.id, { until: day(-2) });
  assert.equal(tidyDue(b.id), true);
  // Notes are numbered oldest first among the open ones: 1 and 2 merged, 3 retired; 4 asked but past the budget.
  answer = JSON.stringify({ changes: [{ op: "merge", entries: [1, 2], text: "Facts 0 and 1 about the project." }, { op: "retire", entry: 3, why: "over" }, { op: "retire", entry: 4 }, { op: "retire", entry: 5 }] });
  const res = await tidyMemory(bots.byId(b.id)!);
  assert.ok(res.undoId);
  const open = memories.list(b.id).filter((m) => m.status !== "archived");
  assert.ok(open.some((m) => m.text === "Facts 0 and 1 about the project."));
  // 13 notes offered? No: imported, pinned and owner-edited notes are not offered (11 offered → budget 2). Merge uses 2.
  assert.equal(res.merged, 2);
  assert.equal(memories.owned(user.id, ended.id)!.status, "archived", "past its day: set aside without a model");
  assert.equal(memories.list(b.id).find((m) => m.text === "Imported fact.")!.status, "active");
  assert.equal(memories.owned(user.id, pinned.id)!.status, "active");
  assert.equal(tidyDue(b.id), false, "once a day");
  assert.equal(undoChange(bots.byId(b.id)!, res.undoId!), "done");
  assert.equal(memories.list(b.id).filter((m) => m.status === "archived").length, 0, "everything came back in one go");
  assert.ok(memories.list(b.id).some((m) => m.text === "Fact number 0 about the project."));
});

test("n° 7 — a note changed since the tidy blocks its undo (nothing half undone); sensitive notes get a card, never a change", async () => {
  const b = mk("Sensible");
  for (let i = 0; i < ENTRIES_MIN + 5; i++) memories.add(b.id, `Note ${i} about work.`, "learned");
  const s1 = memories.add(b.id, "The user takes medicine for asthma.", "learned", { category: "health" as any });
  const s2 = memories.add(b.id, "The user has asthma.", "learned", { category: "health" as any });
  const n = memories.list(b.id).length;
  const open = memories.list(b.id).reverse();
  const at = (id: string) => open.findIndex((m) => m.id === id) + 1;
  answer = JSON.stringify({ changes: [{ op: "merge", entries: [at(s1.id), at(s2.id)], text: "The user has asthma and takes medicine." }, { op: "retire", entry: 1 }] });
  const res = await tidyMemory(bots.byId(b.id)!, true);
  assert.equal(memories.owned(user.id, s1.id)!.text, "The user takes medicine for asthma.", "not changed");
  assert.equal(res.asked, 1);
  assert.ok(rows.list(b.id, bots.byId(b.id)!.generation, 20).some((r) => r.body.kind === "card" && r.body.card.type === "memory" && r.body.card.newText === "The user has asthma and takes medicine."));
  assert.equal(memories.list(b.id).length, n, "nothing deleted");
  // The retired note is edited again by the owner: the undo refuses rather than half-undo.
  const retired = memories.list(b.id).find((m) => m.status === "archived")!;
  changeNote(user, retired.id, { text: "Edited by the owner." });
  assert.equal(undoChange(bots.byId(b.id)!, res.undoId!), "gone");
  assert.equal(memories.owned(user.id, retired.id)!.text, "Edited by the owner.");
});
