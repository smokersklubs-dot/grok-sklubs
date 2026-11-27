import { useEffect, useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Gloss } from "./Gloss";
import { Icon } from "./Icon";
import { ErrorNote, IconButton, Loading, Modal } from "./ui";
import "./Comfort7.css";

/** Server convs.ts Conversation. */
export interface ConversationItem { generation: number; title: string; autoTitle: boolean; pinned: boolean; folder: string; model: string; automatic: boolean; messages: number; startedAt: number; lastAt: number; current: boolean }
type Filter = "all" | "mine" | "auto";

/**
 * L146 « Conversations » of one bot: every earlier conversation with its automatic title, « Renommer », « Épingler »,
 * a folder, the « Automatiques » filter and « Ouvrir » (the earlier one becomes the open one; the open one stays listed).
 */
export function ConversationsModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const t = useT();
  const [list, setList] = useState<ConversationItem[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [folder, setFolder] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");
  const [editing, setEditing] = useState<{ gen: number; title: string; folder: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/bots/${enc(bot.id)}/conversations`;
  const load = () => api<{ conversations: ConversationItem[]; folders: string[] }>("GET", base).then((r) => { setList(r.conversations); setFolders(r.folders); }, (e) => { setError(errText(e)); setList([]); });
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bot.id, bot.generation]);
  const shown = useMemo(() => (list ?? [])
    .filter((c) => filter === "all" || (filter === "auto" ? c.automatic : !c.automatic))
    .filter((c) => folder === null || c.folder === folder)
    .filter((c) => !needle.trim() || c.title.toLowerCase().includes(needle.trim().toLowerCase())), [list, filter, folder, needle]);
  const patch = async (gen: number, body: Record<string, unknown>) => {
    setError(null);
    try { const r = await api<{ conversations: ConversationItem[]; folders: string[] }>("PATCH", `${base}/${gen}`, body); setList(r.conversations); setFolders(r.folders); return true; } catch (e) { setError(errText(e)); return false; }
  };
  const open = async (c: ConversationItem) => {
    if (c.current) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      await api("POST", `${base}/${c.generation}/open`);
      await useStore.getState().loadRows(bot.id);
      useStore.getState().showToast(t("c7.conv.opened", { title: c.title || t("c7.conv.untitled") }));
      onClose();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  return (
    <Modal title={t("c7.conv.title", { name: bot.name })} onClose={onClose} size="lg" className="convs-modal">
      <div className="modal-body convs">
        <div className="convs-bar">
          <div className="seg" role="radiogroup" aria-label={t("c7.conv.filter")}>
            {(["all", "mine", "auto"] as Filter[]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={filter === f} className={`seg-btn${filter === f ? " is-on" : ""}`} onClick={() => setFilter(f)}>{t(`c7.conv.f.${f}`)}</button>
            ))}
          </div>
          <input className="input convs-search" type="search" value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder={t("c7.conv.search")} aria-label={t("c7.conv.search")} />
        </div>
        <p className="muted small"><Gloss term="automatic" />{" · "}{t("c7.conv.hint")}</p>
        {folders.length > 0 && (
          <div className="convs-folders" role="group" aria-label={t("c7.conv.folders")}>
            <button type="button" className={`chip chip-button${folder === null ? " is-on" : ""}`} aria-pressed={folder === null} onClick={() => setFolder(null)}>{t("c7.conv.allFolders")}</button>
            {folders.map((f) => <button key={f} type="button" className={`chip chip-button${folder === f ? " is-on" : ""}`} aria-pressed={folder === f} onClick={() => setFolder(f)}><Icon name="folder" size={12} /> {f}</button>)}
          </div>
        )}
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        {!list && <Loading />}
        {list && shown.length === 0 && <p className="muted">{t("c7.conv.none")}</p>}
        <ul className="convs-list">
          {shown.map((c) => (
            <li key={c.generation} className={`conv${c.current ? " is-current" : ""}`}>
              {editing?.gen === c.generation ? (
                <form className="conv-edit" onSubmit={async (e) => { e.preventDefault(); if (await patch(c.generation, { title: editing.title, folder: editing.folder })) setEditing(null); }}>
                  <label className="small">{t("c7.conv.name")}<input className="input" value={editing.title} maxLength={80} autoFocus placeholder={c.autoTitle ? c.title : ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
                  <label className="small">{t("c7.conv.folder")}<input className="input" value={editing.folder} maxLength={40} list={`conv-folders-${bot.id}`} onChange={(e) => setEditing({ ...editing, folder: e.target.value })} /></label>
                  <datalist id={`conv-folders-${bot.id}`}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
                  <div className="conv-edit-actions"><button type="submit" className="btn btn-small btn-primary">{t("common.save")}</button><button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</button></div>
                </form>
              ) : (
                <>
                  <button type="button" className="conv-main" disabled={busy} onClick={() => void open(c)}>
                    <span className="conv-title">{c.pinned && <Icon name="pin" size={12} />}<span>{c.title || t("c7.conv.untitled")}</span></span>
                    <span className="muted small conv-meta">
                      {c.current && <span className="chip">{t("c7.conv.current")}</span>}
                      {c.automatic && <span className="chip chip-quiet">{t("c7.conv.auto")}</span>}
                      {c.folder && <span className="chip chip-quiet"><Icon name="folder" size={11} /> {c.folder}</span>}
                      {t("c7.conv.meta", { n: c.messages, date: when(c.lastAt) })}
                    </span>
                  </button>
                  <IconButton icon="pin" label={t(c.pinned ? "c7.conv.unpin" : "c7.conv.pin")} className={c.pinned ? "is-on" : ""} onClick={() => void patch(c.generation, { pinned: !c.pinned })} />
                  <IconButton icon="edit" label={t("c7.conv.rename")} onClick={() => setEditing({ gen: c.generation, title: c.autoTitle ? "" : c.title, folder: c.folder })} />
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
