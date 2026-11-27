import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { onLiveDoc } from "../lib/livedocEvents";
import { useStore } from "../store";
import { TextOp, clientAck, clientEdit, clientRemote, diffOp, newClient, transformIndex, type ClientState } from "../../../server/src/clientshared/textop";
import type { LiveDocChange, LiveDocFull, LiveDocInfo } from "../../../server/src/clientshared/livedoctypes";
import { Icon } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading } from "./ui";
import "./LiveDocs.css";

/**
 * L178 « Documents partagés » (server livedoc.ts): a Markdown document you and your bots write in at the same time.
 * Each keystroke batch is one change sent with the version it was made on; the server folds changes made at the same
 * time (operational transformation, clientshared/textop.ts adapted from ot.js, MIT) and every open page receives the
 * others' changes live. History: who changed what and when, « Voir » a past version, « Annuler » one change.
 */
const clientId = Math.random().toString(36).slice(2, 10);

export function LiveDocsNavRow({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <button type="button" className={`nav-row ${view === "docs" ? "is-active" : ""}`} onClick={() => setView(view === "docs" ? "chat" : "docs")} aria-pressed={view === "docs"}
      title={collapsed ? t("livedoc.title") : undefined} aria-label={collapsed ? t("livedoc.title") : undefined}>
      <span className="nav-row-icon"><Icon name="file" size={19} /></span>
      {!collapsed && <span className="nav-row-label">{t("livedoc.title")}</span>}
    </button>
  );
}

export function LiveDocsView({ initialOpen = null }: { initialOpen?: string | null } = {}) {
  const t = useT();
  const [docs, setDocs] = useState<LiveDocInfo[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setDocs((await api<{ docs: LiveDocInfo[] }>("GET", "/livedocs")).docs); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    try { const r = await api<{ doc: LiveDocInfo }>("POST", "/livedocs", { title: t("livedoc.untitled"), text: "" }); await load(); setOpenId(r.doc.id); } catch (e) { setError(errText(e)); }
  };
  return (
    <section className="main tasks-view livedoc-view" aria-label={t("livedoc.title")}>
      <header className="tasks-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => useStore.getState().setMobileNav(true)} />
        {openId ? <IconButton icon="arrowLeft" label={t("livedoc.back")} onClick={() => { setOpenId(null); void load(); }} /> : null}
        <h1>{t("livedoc.title")}</h1>
        {!openId && <button type="button" className="btn btn-small" onClick={create}><Icon name="plus" size={14} /> {t("livedoc.new")}</button>}
      </header>
      <div className="tasks-body">
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        {openId ? <LiveDocEditor key={openId} id={openId} onDeleted={() => { setOpenId(null); void load(); }} /> : (
          <>
            <p className="muted livedoc-lead">{t("livedoc.lead")}</p>
            {!docs && !error && <Loading />}
            {docs && docs.length === 0 && <Empty icon="file" title={t("livedoc.emptyTitle")}>{t("livedoc.emptyText")}</Empty>}
            {docs && docs.length > 0 && (
              <ul className="list livedoc-list">
                {docs.map((d) => (
                  <li key={d.id} className="list-row is-card">
                    <button type="button" className="livedoc-open" onClick={() => setOpenId(d.id)}>
                      <span className="list-row-title">{d.title}</span>
                      <span className="list-row-sub">{t("livedoc.meta", { n: d.chars, v: d.revision, bots: d.bots.length })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function LiveDocEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const t = useT();
  const allBots = useStore((s) => s.bots);
  const agents = Object.values(allBots).filter((b) => b.kind === "agent");
  const [doc, setDoc] = useState<LiveDocFull | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"saved" | "sending" | "offline">("saved");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<LiveDocChange[] | null>(null);
  const [viewing, setViewing] = useState<{ revision: number; text: string } | null>(null);
  const [last, setLast] = useState<string>("");
  const ref = useRef<HTMLTextAreaElement>(null);
  // The editing state lives in refs: events and answers arrive outside React's render cycle.
  const st = useRef<{ client: ClientState; text: string; ackAt: number | null }>({ client: newClient(0), text: "", ackAt: null });

  const reload = useCallback(async () => {
    try {
      const d = (await api<{ doc: LiveDocFull }>("GET", `/livedocs/${id}`)).doc;
      st.current = { client: newClient(d.revision), text: d.text, ackAt: null };
      setDoc(d); setText(d.text); setStatus("saved");
    } catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);

  const send = useCallback(async (op: TextOp) => {
    setStatus("sending");
    try {
      const r = await api<{ revision: number }>("POST", `/livedocs/${id}/ops`, { revision: st.current.client.revision, op: op.toJSON(), clientId });
      st.current.ackAt = r.revision;
      settle();
    } catch (e) { setError(errText(e)); void reload(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reload]);

  /** An answer is applied once every change made before ours has arrived (the event stream may be a little late). */
  const settle = useCallback(() => {
    const s = st.current;
    if (s.ackAt === null || s.ackAt !== s.client.revision + 1) {
      if (s.ackAt !== null) window.setTimeout(() => { if (st.current.ackAt !== null && st.current.ackAt !== st.current.client.revision + 1) void reload(); }, 3000);
      return;
    }
    s.ackAt = null;
    const a = clientAck(s.client);
    s.client = a.state;
    if (a.send) void send(a.send); else setStatus("saved");
  }, [reload, send]);

  useEffect(() => onLiveDoc((ev) => {
    if (ev.docId !== id) return;
    const s = st.current;
    if (ev.clientId === clientId || ev.revision <= s.client.revision) return;
    if (ev.revision !== s.client.revision + 1) { void reload(); return; }
    let op: TextOp;
    try { op = TextOp.fromJSON(ev.op); } catch { void reload(); return; }
    const r = clientRemote(s.client, op);
    s.client = r.state;
    const el = ref.current;
    const start = el ? transformIndex(r.apply, el.selectionStart) : 0, end = el ? transformIndex(r.apply, el.selectionEnd) : 0;
    try { s.text = r.apply.apply(s.text); } catch { void reload(); return; }
    setText(s.text);
    setLast(t("livedoc.lastBy", { name: ev.author }));
    if (el && document.activeElement === el) requestAnimationFrame(() => el.setSelectionRange(start, end));
    settle();
  }), [id, reload, settle, t]);

  const onChange = (next: string) => {
    const s = st.current;
    const op = diffOp(s.text, next);
    s.text = next;
    setText(next);
    if (op.isNoop()) return;
    const e = clientEdit(s.client, op);
    s.client = e.state;
    if (e.send) void send(e.send); else setStatus("sending");
  };

  const share = async (botId: string, on: boolean) => {
    if (!doc) return;
    const bots = on ? [...doc.bots, botId] : doc.bots.filter((b) => b !== botId);
    try { const r = await api<{ doc: LiveDocInfo }>("PATCH", `/livedocs/${id}`, { bots }); setDoc({ ...doc, ...r.doc }); } catch (e) { setError(errText(e)); }
  };
  const rename = async (title: string) => {
    if (!doc || !title.trim() || title === doc.title) return;
    try { const r = await api<{ doc: LiveDocInfo }>("PATCH", `/livedocs/${id}`, { title }); setDoc({ ...doc, ...r.doc }); } catch (e) { setError(errText(e)); }
  };
  const loadHistory = async () => { try { setHistory((await api<{ changes: LiveDocChange[] }>("GET", `/livedocs/${id}/history`)).changes); } catch (e) { setError(errText(e)); } };
  const undo = async (revision: number) => { try { await api("POST", `/livedocs/${id}/undo`, { revision }); await loadHistory(); } catch (e) { setError(errText(e)); } };
  const see = async (revision: number) => { try { setViewing(await api<{ revision: number; text: string }>("GET", `/livedocs/${id}/at/${revision}`)); } catch (e) { setError(errText(e)); } };
  const remove = async () => { try { await api("DELETE", `/livedocs/${id}`); onDeleted(); } catch (e) { setError(errText(e)); } };

  if (!doc) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const time = (at: number) => new Date(at).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  return (
    <div className="livedoc-editor">
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="livedoc-top">
        <input className="input livedoc-title" defaultValue={doc.title} aria-label={t("livedoc.titleLabel")} maxLength={120} onBlur={(e) => void rename(e.target.value)} />
        <span className={`chip livedoc-status is-${status}`} role="status">{status === "saved" ? t("livedoc.saved") : t("livedoc.sending")}</span>
      </div>
      <fieldset className="livedoc-share">
        <legend>{t("livedoc.shareWith")}</legend>
        {agents.length === 0 && <span className="muted">{t("livedoc.noBots")}</span>}
        {agents.map((b) => (
          <label key={b.id} className="livedoc-bot"><input type="checkbox" checked={doc.bots.includes(b.id)} onChange={(e) => void share(b.id, e.target.checked)} /> {b.name}</label>
        ))}
      </fieldset>
      <textarea ref={ref} className="input livedoc-text" value={text} onChange={(e) => onChange(e.target.value)} spellCheck aria-label={t("livedoc.textLabel")} placeholder={t("livedoc.placeholder")} />
      <p className="field-hint">{last || t("livedoc.hint")}</p>
      <div className="livedoc-actions">
        <button type="button" className="btn btn-small" onClick={() => (history ? setHistory(null) : void loadHistory())} aria-expanded={!!history}><Icon name="history" size={14} /> {t("livedoc.history")}</button>
        <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={remove} />
      </div>
      {history && (
        <ul className="list livedoc-history" aria-label={t("livedoc.history")}>
          {history.length === 0 && <li className="muted">{t("livedoc.noHistory")}</li>}
          {history.map((h) => (
            <li key={h.revision} className="list-row livedoc-change">
              <div className="list-row-text">
                <span className="list-row-title">{h.authorKind === "bot" ? <Icon name="users" size={13} /> : <Icon name="user" size={13} />} {h.author} <span className="muted">· {time(h.at)}</span></span>
                <span className="list-row-sub">{t("livedoc.change", { plus: h.plus, minus: h.minus, v: h.revision })}{h.undone ? ` · ${t("livedoc.undone")}` : ""}{h.undoes ? ` · ${t("livedoc.undoOf", { v: h.undoes })}` : ""}</span>
              </div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void see(h.revision)}>{t("livedoc.see")}</button>
              {!h.undone && <button type="button" className="btn btn-small" onClick={() => void undo(h.revision)}>{t("livedoc.undo")}</button>}
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <div className="livedoc-past" role="region" aria-label={t("livedoc.versionOf", { v: viewing.revision })}>
          <div className="livedoc-past-head"><strong>{t("livedoc.versionOf", { v: viewing.revision })}</strong><IconButton icon="close" label={t("common.close")} onClick={() => setViewing(null)} /></div>
          <pre>{viewing.text}</pre>
        </div>
      )}
    </div>
  );
}
