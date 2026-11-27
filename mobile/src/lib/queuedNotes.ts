/**
 * L58 « file visible » (mobile parity with web/src/components/QueuedNotes.tsx): the waiting notes and the two actions,
 * « Envoyer maintenant » (server agent/sendnow.ts: stops the step under way, what is done is kept, so the note is read at
 * once) and « Retirer ». Pure helpers over the store's `call`, unit-tested.
 */
export interface QueuedNote { id: number; text: string; thread: number }
type Call = <T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<T>;

/** Only well-formed notes (the server's list, guarded). */
export function cleanNotes(list: unknown): QueuedNote[] {
  if (!Array.isArray(list)) return [];
  return list.filter((n): n is QueuedNote => !!n && typeof n === "object" && Number.isInteger((n as QueuedNote).id) && typeof (n as QueuedNote).text === "string");
}

/** « Envoyer maintenant »: the notes left and which message to show ("notes.sentNow" stopped the step, "notes.sentSoon" the bot was finishing anyway). */
export async function sendNoteNow(call: Call, botId: string, id: number): Promise<{ notes: QueuedNote[]; message: "notes.sentNow" | "notes.sentSoon" }> {
  const r = await call<{ notes?: unknown; state?: string }>("POST", `/bots/${encodeURIComponent(botId)}/notes/${id}/send-now`);
  return { notes: cleanNotes(r?.notes), message: r?.state === "sent" ? "notes.sentNow" : "notes.sentSoon" };
}

/** « Retirer »: the notes left. */
export async function removeNote(call: Call, botId: string, id: number): Promise<QueuedNote[]> {
  const r = await call<{ notes?: unknown }>("DELETE", `/bots/${encodeURIComponent(botId)}/notes/${id}`);
  return cleanNotes(r?.notes);
}
