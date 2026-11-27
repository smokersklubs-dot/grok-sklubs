import { cleanNotes, removeNote, sendNoteNow } from "../src/lib/queuedNotes";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";

describe("L58 « Envoyer maintenant » on the phone", () => {
  const note = { id: 7, text: "et le devis ?", thread: 0 };
  it("posts to the same route as the web app and says the step was stopped", async () => {
    const calls: string[] = [];
    const call = async <T,>(m: string, p: string) => { calls.push(`${m} ${p}`); return { notes: [], state: "sent" } as T; };
    const r = await sendNoteNow(call, "bot 1", 7);
    expect(calls).toEqual(["POST /bots/bot%201/notes/7/send-now"]);
    expect(r).toEqual({ notes: [], message: "notes.sentNow" });
  });
  it("says the bot is finishing when no step was running", async () => {
    const call = async <T,>() => ({ notes: [note, null, { id: "x" }], state: "idle" }) as T;
    const r = await sendNoteNow(call, "b", 7);
    expect(r.message).toBe("notes.sentSoon");
    expect(r.notes).toEqual([note]);
  });
  it("« Retirer » deletes and keeps only valid notes", async () => {
    const calls: string[] = [];
    const call = async <T,>(m: string, p: string) => { calls.push(`${m} ${p}`); return { notes: "junk" } as T; };
    expect(await removeNote(call, "b", 3)).toEqual([]);
    expect(calls).toEqual(["DELETE /bots/b/notes/3"]);
    expect(cleanNotes(undefined)).toEqual([]);
  });
  it("has the button and both messages in French and English", () => {
    for (const k of ["notes.sendNow", "notes.sentNow", "notes.sentSoon"] as const) { expect(fr[k]).toBeTruthy(); expect(en[k]).toBeTruthy(); }
    expect(fr["notes.sendNow"]).toBe("Envoyer maintenant");
  });
});
