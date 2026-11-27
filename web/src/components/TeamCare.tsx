import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { ErrorNote } from "./ui";
import "./BotCare.css";

/**
 * L161, Settings → Team (server botcare.ts, botcarework.ts):
 *   GlobalInstructions    « Consignes pour tous les bots »
 *   SharedRoles           « Rôles partagés »: edit a role for every bot of that role, « Rétablir », add one
 *   ShortcutsToReview     « Raccourcis à revoir » noted by the bots (shortcut_note)
 *   MissingCapabilities   « Capacités manquantes » noted by the bots (capability_gap)
 */
export function TeamCare() {
  return (<><GlobalInstructions /><SharedRoles /><ShortcutsToReview /><MissingCapabilities /></>);
}

export function GlobalInstructions() {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ text: string }>("GET", "/global-instructions").then((r) => { setText(r.text); setSaved(r.text); }, (e) => setError(errText(e))); }, []);
  const save = async () => {
    setError(null); setNote(null);
    try { const r = await api<{ text: string }>("PUT", "/global-instructions", { text: text ?? "" }); setSaved(r.text); setText(r.text); setNote(t("care.saved")); } catch (e) { setError(errText(e)); }
  };
  return (
    <section className="care-section" aria-labelledby="care-global-h">
      <h3 className="pane-heading" id="care-global-h">{t("care.global.title")}</h3>
      <p className="muted small">{t("care.global.hint")}</p>
      <textarea className="input" rows={4} maxLength={4000} aria-labelledby="care-global-h" placeholder={t("care.global.placeholder")} value={text ?? ""} disabled={text === null} onChange={(e) => { setText(e.target.value); setNote(null); }} />
      <div className="care-row">
        <button type="button" className="btn btn-small btn-primary" disabled={text === null || text === saved} onClick={() => void save()}>{t("care.save")}</button>
        <span className="muted small">{t("care.chars", { n: (text ?? "").length, max: 4000 })}</span>
        {note && <span className="small care-ok" role="status">{note}</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

interface Role { id: string; name: string; text: string; builtin: boolean; modified: boolean; bots: { id: string; name: string }[] }

export function SharedRoles() {
  const t = useT();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", text: "" });
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ roles: Role[] }>("GET", "/shared-roles").then((r) => setRoles(r.roles), (e) => setError(errText(e)));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); setEditing(null); await load(); } catch (e) { setError(errText(e)); } };
  const open = (r: Role | null) => { setEditing(r ? r.id : "new"); setDraft({ name: r?.name ?? "", text: r?.text ?? "" }); };
  const editor = (
    <div className="care-editor">
      <label className="care-label">{t("care.roles.name")}<input className="input" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="care-label">{t("care.roles.text")}<textarea className="input" rows={4} maxLength={3000} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
      <div className="care-row">
        <button type="button" className="btn btn-small btn-primary" disabled={!draft.name.trim() || !draft.text.trim()} onClick={() => void act(() => editing === "new" ? api("POST", "/shared-roles", draft) : api("PUT", `/shared-roles/${enc(String(editing))}`, draft))}>{t("care.save")}</button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(null)}>{t("care.cancel")}</button>
      </div>
    </div>
  );
  return (
    <section className="care-section" aria-labelledby="care-roles-h">
      <h3 className="pane-heading" id="care-roles-h">{t("care.roles.title")}</h3>
      <p className="muted small">{t("care.roles.hint")}</p>
      <ul className="care-docs">
        {roles?.map((r) => (
          <li key={r.id} className="care-doc">
            {editing === r.id ? editor : (
              <>
                <div className="care-doc-head">
                  <strong className="care-doc-title">{r.name}{r.modified && <span className="care-tag is-ask">{t("care.role.modified")}</span>}</strong>
                  <span className="care-row">
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => open(r)}>{t("care.edit")}</button>
                    {(r.modified || !r.builtin) && <button type="button" className="btn btn-small btn-ghost" onClick={() => void act(() => api("DELETE", `/shared-roles/${enc(r.id)}`))}>{t(r.builtin ? "care.roles.reset" : "care.remove")}</button>}
                  </span>
                </div>
                <p className="care-doc-body">{r.text}</p>
                <p className="muted small">{r.bots.length ? t("care.roles.used", { names: r.bots.map((b) => b.name).join(", ") }) : t("care.roles.unused")}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? editor : <button type="button" className="btn btn-small" disabled={!roles} onClick={() => open(null)}>{t("care.roles.add")}</button>}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

interface Shortcut { id: string; botId: string; botName: string; what: string; leavesOut: string; revisit: string; revisitAt: number | null; due: boolean; noRevisit: boolean; createdAt: number }

export function ShortcutsToReview() {
  const t = useT();
  const [items, setItems] = useState<Shortcut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ items: Shortcut[] }>("GET", "/bot-shortcuts").then((r) => setItems(r.items), (e) => setError(errText(e))); }, []);
  const act = async (method: string, path: string) => { setError(null); try { setItems((await api<{ items: Shortcut[] }>(method, path)).items); } catch (e) { setError(errText(e)); } };
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <section className="care-section" aria-labelledby="care-sc-h">
      <h3 className="pane-heading" id="care-sc-h">{t("care.sc.title")}</h3>
      <p className="muted small">{t("care.sc.hint")}</p>
      {items && items.length === 0 && <p className="muted small care-empty">{t("care.sc.empty")}</p>}
      <ul className="care-docs">
        {items?.map((s) => (
          <li key={s.id} className={`care-doc${s.due ? " is-due" : ""}`}>
            <div className="care-doc-head">
              <strong className="care-doc-title">{s.what}</strong>
              <span className="care-row">
                <button type="button" className="btn btn-small" onClick={() => void act("POST", `/bot-shortcuts/${enc(s.id)}/done`)}>{t("care.sc.done")}</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void act("DELETE", `/bot-shortcuts/${enc(s.id)}`)}>{t("care.remove")}</button>
              </span>
            </div>
            {s.leavesOut && <p className="care-doc-body">{t("care.sc.leaves", { text: s.leavesOut })}</p>}
            <p className="small care-meta">
              <span>{t("care.by", { name: s.botName, date: date(s.createdAt) })}</span>
              {s.due ? <span className="care-tag is-ask">{t("care.sc.due")}</span> : s.noRevisit ? <span className="care-tag is-warn">{t("care.sc.noRevisit")}</span> : <span>{t("care.sc.when", { when: s.revisitAt ? date(s.revisitAt) : s.revisit })}</span>}
            </p>
          </li>
        ))}
      </ul>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

interface Gap { id: string; botId: string; botName: string; what: string; why: string; tried: string; times: number; createdAt: number; lastAt: number }

export function MissingCapabilities() {
  const t = useT();
  const [items, setItems] = useState<Gap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ items: Gap[] }>("GET", "/capability-gaps").then((r) => setItems(r.items), (e) => setError(errText(e))); }, []);
  const done = async (id: string) => { setError(null); try { setItems((await api<{ items: Gap[] }>("POST", `/capability-gaps/${enc(id)}/done`)).items); } catch (e) { setError(errText(e)); } };
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <section className="care-section" aria-labelledby="care-gap-h">
      <h3 className="pane-heading" id="care-gap-h">{t("care.gap.title")}</h3>
      <p className="muted small">{t("care.gap.hint")}</p>
      {items && items.length === 0 && <p className="muted small care-empty">{t("care.gap.empty")}</p>}
      <ul className="care-docs">
        {items?.map((g) => (
          <li key={g.id} className="care-doc">
            <div className="care-doc-head">
              <strong className="care-doc-title">{g.what}</strong>
              <button type="button" className="btn btn-small" onClick={() => void done(g.id)}>{t("care.gap.done")}</button>
            </div>
            {g.why && <p className="care-doc-body">{t("care.gap.why", { text: g.why })}</p>}
            {g.tried && <p className="care-doc-body">{t("care.gap.tried", { text: g.tried })}</p>}
            <p className="small care-meta"><span>{t("care.by", { name: g.botName, date: date(g.lastAt) })}</span>{g.times > 1 && <span className="care-tag is-ask">{t("care.gap.times", { n: g.times })}</span>}</p>
          </li>
        ))}
      </ul>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
