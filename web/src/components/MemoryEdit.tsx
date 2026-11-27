import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { shortDate } from "../lib/format";
import type { Memory } from "../types";
import { ErrorNote } from "./ui";

/** One change of a note, as the server keeps it (server/src/agent/memorybook.ts). */
interface HistoryEntry { at: number; action: "edited" | "status" | "confidence" | "deleted" | "restored" | "forgotten"; before: string | null; after: string | null; by: "owner" | "bot" }

/**
 * Réglages → Mémoire: correct the words of a note in place (instead of deleting it and writing a new one, which lost its
 * date, excerpt and confidence), and see what changed in it, oldest first.
 */
export function MemoryEdit({ memory, onSaved, onCancel, historyOpen = false }: { memory: Memory; onSaved: (m: Memory) => void; onCancel: () => void; /** Show the history at once (the dev gallery). */ historyOpen?: boolean }) {
  const t = useT();
  const [text, setText] = useState(memory.text);
  // Audit DS-Bot #81 / #82: pinned (the automatic passes never touch it) and a last day.
  const [pinned, setPinned] = useState(!!memory.pinned);
  const [until, setUntil] = useState(memory.until ?? "");
  const changed = (text.trim() !== memory.text) || pinned !== !!memory.pinned || until !== (memory.until ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try { onSaved((await api<{ memory: Memory }>("PATCH", `/memories/${memory.id}`, { text, pinned, until: until || null })).memory); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const showHistory = async () => {
    setError(null);
    try { setHistory((await api<{ history: HistoryEntry[] }>("GET", `/memories/${memory.id}/history`)).history); } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { if (historyOpen) void showHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const status = (s: string | null) => (s === "active" || s === "contested" || s === "archived" ? t(`memory.filter.${s}`) : s ?? "");
  const line = (h: HistoryEntry) => {
    const who = t(h.by === "bot" ? "memory.history.byBot" : "memory.history.byYou");
    if (h.action === "edited") return t("memory.history.edited", { who, before: h.before ?? "", after: h.after ?? "" });
    if (h.action === "status") return t("memory.history.status", { who, before: status(h.before), after: status(h.after) });
    if (h.action === "confidence") return t("memory.history.confidence", { who, after: t(`memory.confidence.${h.after === "confirmed" ? "confirmed" : "once"}`) });
    return t(`memory.history.${h.action}`, { who });
  };
  return (
    <form className="memory-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <textarea className="input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("memory.editLabel")} autoFocus />
      <div className="memory-edit-marks">
        <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> {t("memory.pin")}</label>
        <label className="memory-edit-until">{t("memory.until")} <input type="date" className="input input-small" value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t("memory.until")} /></label>
      </div>
      <p className="field-hint">{t("memory.marksHint")}</p>
      <div className="memory-edit-actions">
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !text.trim() || !changed}>{t("common.save")}</button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>{t("common.cancel")}</button>
        <span className="spacer" />
        {!history && <button type="button" className="link small" onClick={() => void showHistory()}>{t("memory.history.show")}</button>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {history && (history.length
        ? <ul className="memory-history">{history.map((h, i) => <li key={i}><span className="muted">{shortDate(h.at)}</span> {line(h)}</li>)}</ul>
        : <p className="muted small">{t("memory.history.none")}</p>)}
    </form>
  );
}
