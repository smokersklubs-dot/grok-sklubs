import { useState } from "react";
import { create } from "zustand";
import { useT } from "../i18n";
import { addLayout, applyLayout, loadLayouts, MAX_LAYOUTS, removeLayout, storeLayouts, type ChatLayout } from "../lib/chatlayouts";
import { useSideChat } from "../lib/sidechat";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { Modal } from "./ui";
import { useSideBots } from "./SideChat";

/**
 * L146 « Dispositions »: the chat arrangements saved on this device (lib/chatlayouts.ts) — bring one back in one click
 * (the main bot and the ones beside it; a bot deleted since is skipped and said), delete one, or save the arrangement on
 * screen under a name. Kept in this browser only: the dialog says so.
 */
const useDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openChatLayouts = () => useDialog.setState({ open: true });

/** Rendered once by App.tsx: the dialog, when « Dispositions… » was chosen in the chat menu. */
export function ChatLayoutsHost() {
  const open = useDialog((s) => s.open);
  return open ? <ChatLayoutsDialog onClose={() => useDialog.setState({ open: false })} /> : null;
}

export function ChatLayoutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const mainId = useStore((s) => s.selectedId);
  const shown = useSideBots();
  const [list, setList] = useState<ChatLayout[]>(() => loadLayouts());
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const nameOf = (id: string) => bots[id]?.name ?? t("grid.gone");
  const keep = (next: ChatLayout[]) => { setList(next); if (!storeLayouts(next)) setNote(t("grid.notKept")); };
  const save = () => {
    const next = addLayout(list, name, mainId, shown);
    if (!next) { setNote(t(list.length >= MAX_LAYOUTS ? "grid.full" : "grid.needSide", { n: MAX_LAYOUTS })); return; }
    keep(next); setName(""); setNote(t("grid.saved"));
  };
  const apply = (l: ChatLayout) => {
    const r = applyLayout(l, (id) => !!bots[id]);
    if (!r.main) { setNote(t("grid.allGone")); return; }
    useStore.getState().selectBot(r.main);
    useSideChat.getState().set(r.side);
    if (r.skipped) useStore.getState().showToast(t("grid.skipped", { n: r.skipped }));
    onClose();
  };
  return (
    <Modal title={t("grid.layoutsTitle")} onClose={onClose} size="sm" className="chat-layouts">
      <div className="modal-body">
      <p className="muted small chat-layouts-note"><Icon name="smartphone" size={13} /> {t("grid.thisDevice")}</p>
      {list.length === 0 ? <p className="muted">{t("grid.none")}</p> : (
        <ul className="chat-layouts-list">
          {list.map((l) => (
            <li key={l.id} className="chat-layouts-item">
              <span className="chat-layouts-text">
                <span className="chat-layouts-name">{l.name}</span>
                <span className="muted small">{[l.main, ...l.side].map(nameOf).join(" · ")}</span>
              </span>
              <button type="button" className="btn btn-small btn-accent" onClick={() => apply(l)}>{t("grid.apply")}</button>
              <button type="button" className="btn btn-small btn-ghost" aria-label={t("grid.delete", { name: l.name })} onClick={() => keep(removeLayout(list, l.id))}><Icon name="trash" size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="chat-layouts-save" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field-label" htmlFor="chat-layout-name">{t("grid.saveLabel")}</label>
        <div className="chat-layouts-row">
          <input id="chat-layout-name" className="input" value={name} maxLength={40} placeholder={t("grid.namePh")} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={!name.trim() || !shown.length}>{t("grid.save")}</button>
        </div>
        {!shown.length && <p className="muted small">{t("grid.needSide")}</p>}
      </form>
      {note && <p className="muted small" role="status">{note}</p>}
      </div>
    </Modal>
  );
}
