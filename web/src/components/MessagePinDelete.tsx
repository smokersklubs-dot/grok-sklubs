import { useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Row } from "../types";
import { Icon } from "./Icon";

/**
 * L141 (rest): « Épingler » a message (it shows in the pinned strip at the top of the chat) and « Supprimer » it (two
 * taps: its text is emptied and « Message supprimé » stays in its place; what the bot already read is not rewritten).
 */
export function MessagePinDelete({ row }: { row: Row }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const owner = useStore((s) => !s.bots[row.botId]?.access);
  if (row.body.kind !== "message" || row.body.streaming || row.body.deleted || !owner) return null;
  const pinned = !!row.body.pinned;
  const act = async (method: "POST" | "DELETE", path: string, body?: unknown) => {
    try { await api(method, `/bots/${enc(row.botId)}/rows/${row.seq}${path}`, body); } catch (e) { useStore.getState().showToast(errText(e)); }
  };
  return (
    <>
      <button type="button" className={`msg-action${pinned ? " is-on" : ""}`} aria-pressed={pinned} aria-label={t(pinned ? "c7.msg.unpin" : "c7.msg.pin")} title={t(pinned ? "c7.msg.unpin" : "c7.msg.pin")} onClick={() => void act("POST", "/pin", { on: !pinned })}>
        <Icon name="pin" size={15} />
      </button>
      <button type="button" className={`msg-action${armed ? " is-danger" : ""}`} aria-label={t(armed ? "c7.msg.deleteConfirm" : "c7.msg.delete")} title={t(armed ? "c7.msg.deleteConfirm" : "c7.msg.delete")}
        onBlur={() => setArmed(false)} onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); void act("DELETE", ""); }}>
        <Icon name="trash" size={15} />{armed && <span className="msg-action-text">{t("c7.msg.deleteConfirm")}</span>}
      </button>
    </>
  );
}

/** The pinned messages of the open conversation, at the top of the chat; a tap shows the message. */
export function PinnedStrip({ rows }: { rows: Row[] }) {
  const t = useT();
  const pinned = rows.filter((r) => r.body.kind === "message" && r.body.pinned && !r.body.deleted);
  if (!pinned.length) return null;
  const show = (seq: number) => {
    const el = document.querySelector<HTMLElement>(`.chat [data-seq="${seq}"]`);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("is-flash"); window.setTimeout(() => el.classList.remove("is-flash"), 2200); }
  };
  return (
    <div className="pinned-strip" role="region" aria-label={t("c7.msg.pinned")}>
      <Icon name="pin" size={13} />
      <span className="pinned-label small">{t("c7.msg.pinnedN", { n: pinned.length })}</span>
      <span className="pinned-items">
        {pinned.slice(-5).map((r) => (
          <button key={r.seq} type="button" className="chip chip-button truncate" onClick={() => show(r.seq)}>{r.body.kind === "message" ? r.body.text.replace(/\s+/g, " ").slice(0, 60) : ""}</button>
        ))}
      </span>
    </div>
  );
}
