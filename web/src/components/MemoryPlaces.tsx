import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { relTime } from "../lib/format";
import type { Bot } from "../types";
import { ErrorNote } from "./ui";
import "./MemoryPlaces.css";

/**
 * L88 (server agent/memoryplaces.ts): « Documents de {bot} » — texts given once and searched by the bot (docs_search) —
 * and « Notes sur les sites » — notes tied to a website, given back to every bot when it opens that site.
 */
interface Doc { id: string; name: string; chars: number; createdAt: number }
interface SiteNote { id: string; host: string; text: string; botName: string | null; createdAt: number }

export function MemoryPlaces({ bot }: { bot: Bot }) {
  const t = useT();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [notes, setNotes] = useState<SiteNote[] | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [site, setSite] = useState("");
  const [siteText, setSiteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api<{ docs: Doc[] }>("GET", `/docbase?kind=bot&id=${enc(bot.id)}`).then((r) => setDocs(r.docs), (e) => setError(errText(e)));
    api<{ notes: SiteNote[] }>("GET", "/site-notes").then((r) => setNotes(r.notes), (e) => setError(errText(e)));
  };
  useEffect(load, [bot.id]);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); load(); } catch (e) { setError(errText(e)); } };
  return (
    <div className="mem-places">
      <section>
        <p className="action-title">{t("places.docs", { name: bot.name })}</p>
        <p className="muted small">{t("places.docsHint", { name: bot.name })}</p>
        {docs && docs.length > 0 && (
          <ul className="mem-places-list">
            {docs.map((d) => (
              <li key={d.id}>
                <span className="mem-places-main"><strong>{d.name}</strong> <span className="muted small">{t("places.chars", { n: d.chars.toLocaleString() })} · {relTime(d.createdAt)}</span></span>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => void run(() => api("DELETE", `/docbase/${enc(d.id)}`))}>{t("places.remove")}</button>
              </li>
            ))}
          </ul>
        )}
        <form className="mem-places-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("POST", "/docbase", { kind: "bot", id: bot.id, name, text }); setName(""); setText(""); }); }}>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("places.docName")} aria-label={t("places.docName")} />
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("places.docText")} aria-label={t("places.docText")} />
          <button className="btn btn-small" disabled={!name.trim() || !text.trim()}>{t("places.addDoc")}</button>
        </form>
      </section>
      <section>
        <p className="action-title">{t("places.sites")}</p>
        <p className="muted small">{t("places.sitesHint")}</p>
        {notes && notes.length > 0 && (
          <ul className="mem-places-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span className="mem-places-main"><strong>{n.host}</strong> — {n.text} {n.botName && <span className="muted small">({n.botName})</span>}</span>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => void run(() => api("DELETE", `/site-notes/${enc(n.id)}`))}>{t("places.remove")}</button>
              </li>
            ))}
          </ul>
        )}
        <form className="mem-places-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("POST", "/site-notes", { site, text: siteText }); setSite(""); setSiteText(""); }); }}>
          <input className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder={t("places.site")} aria-label={t("places.site")} />
          <input className="input" value={siteText} maxLength={500} onChange={(e) => setSiteText(e.target.value)} placeholder={t("places.siteText")} aria-label={t("places.siteText")} />
          <button className="btn btn-small" disabled={!site.trim() || !siteText.trim()}>{t("places.addSite")}</button>
        </form>
      </section>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
