/**
 * « Notes du groupe » (audit DS-Bot #58, server agent/roommemory.ts): what the members of one group chat keep for that
 * group only. The owner sees them here, pins one (the automatic passes never touch it) or forgets it; they never leave
 * the group (not in a member's own memory, not in another group).
 */
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import type { Bot, Memory } from "../types";
import { ErrorNote } from "./ui";

export function RoomNotes({ room, initial }: { room: Bot; /** The dev gallery: notes given, nothing fetched. */ initial?: Memory[] }) {
  const t = useT();
  const [notes, setNotes] = useState<Memory[] | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let live = true;
    api<{ memories: Memory[] }>("GET", `/bots/${room.id}/bundle`).then((r) => { if (live) setNotes(r.memories.filter((m) => m.status !== "archived")); }).catch((e) => { if (live) setError(errText(e)); });
    return () => { live = false; };
  }, [room.id, initial]);
  const pin = async (m: Memory) => {
    setError(null);
    try { const r = await api<{ memory: Memory }>("PATCH", `/memories/${m.id}`, { pinned: !m.pinned }); setNotes((l) => (l ?? []).map((x) => (x.id === m.id ? r.memory : x))); } catch (e) { setError(errText(e)); }
  };
  const forget = async (m: Memory) => {
    setError(null);
    try { await api("DELETE", `/memories/${m.id}`); setNotes((l) => (l ?? []).filter((x) => x.id !== m.id)); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="field room-notes">
      <span className="field-label">{t("roomNotes.title")}</span>
      <p className="field-hint">{t("roomNotes.hint")}</p>
      {notes && notes.length === 0 && <p className="muted small">{t("roomNotes.empty")}</p>}
      {notes && notes.length > 0 && (
        <ul className="list">
          {notes.map((m) => (
            <li key={m.id} className="list-row is-card">
              <div className="list-row-text">
                <span className="memory-text">{m.text}</span>
                <span className="list-row-sub">{m.pinned && <span className="chip">{t("memory.pinnedChip")}</span>}{m.until && <span className="chip chip-quiet">{t("memory.untilChip", { day: m.until })}</span>}</span>
              </div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void pin(m)}>{t(m.pinned ? "roomNotes.unpin" : "memory.pin")}</button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void forget(m)} aria-label={t("memory.forgetLabel", { text: m.text.slice(0, 60) })}>{t("memory.forget")}</button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
