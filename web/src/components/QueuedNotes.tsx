import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Icon } from "./Icon";

/**
 * L58 « file visible »: the messages typed while the bot works that it has not read yet (server agent/steering.ts). Each
 * one can be taken back (« Retirer ») before the bot reads it at its next step; what it reads is added to its work and
 * answered on top of it. « Envoyer maintenant » (L58) stops the step under way — what is done is kept — so the note is
 * read at once (server agent/sendnow.ts).
 */
interface Note { id: number; text: string; thread: number }

export function QueuedNotes({ botId, queued }: { botId: string; queued: number }) {
  const t = useT();
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    if (queued <= 0) { setNotes([]); return; }
    let dead = false;
    api<{ notes: Note[] }>("GET", `/bots/${enc(botId)}/notes`).then((r) => { if (!dead) setNotes(Array.isArray(r?.notes) ? r.notes : []); }, () => undefined);
    return () => { dead = true; };
  }, [botId, queued]);
  if (!notes.length) return null;
  const remove = async (id: number) => {
    setBusy(id);
    try {
      const r = await api<{ notes: Note[] }>("DELETE", `/bots/${enc(botId)}/notes/${id}`);
      setNotes(r.notes);
      useStore.getState().showToast(t("notes.removed"));
    } catch (e) { useStore.getState().showToast(errText(e)); setNotes((l) => l.filter((n) => n.id !== id)); }
    finally { setBusy(null); }
  };
  const sendNow = async (id: number) => {
    setBusy(id);
    try {
      const r = await api<{ notes: Note[]; state: "sent" | "idle" }>("POST", `/bots/${enc(botId)}/notes/${id}/send-now`);
      setNotes(r.notes);
      useStore.getState().showToast(t(r.state === "sent" ? "notes.sentNow" : "notes.sentSoon"));
    } catch (e) { useStore.getState().showToast(errText(e)); setNotes((l) => l.filter((n) => n.id !== id)); }
    finally { setBusy(null); }
  };
  return (
    <div className="queued-notes" role="region" aria-label={t("notes.title")}>
      <p className="queued-notes-title"><Icon name="clock" size={12} /> {t("notes.title")}</p>
      <p className="queued-notes-hint muted">{t("notes.hint")}</p>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <span className="queued-notes-text">{n.text}</span>
            <span className="queued-notes-actions">
              <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void sendNow(n.id)} title={t("notes.sendNowHint")}>{t("notes.sendNow")}</button>
              <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void remove(n.id)}>{t("notes.remove")}</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
