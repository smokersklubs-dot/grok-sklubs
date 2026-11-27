import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import type { LostPart, PageLossCard } from "../types";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton, ErrorNote, Loading } from "./ui";
import "./PageKeep.css";

/**
 * L157 (backlog A-FAIRE), owner side:
 *  - PageLossCardView: « Ces parties ont disparu » — a bot redid a page and the new version no longer has some sections,
 *    links, images or text blocks of the old one (server/src/pagekeep.ts). « Garder la nouvelle version » or « Remettre
 *    l'ancienne » (kept as a new version, as in Réglages → Pages).
 *  - DesignJournal: Réglages → Pages → « Journal de design »: the account's decisions on colours, fonts and layout that
 *    every bot reuses for its next pages (server/src/designjournal.ts). Read, add, remove.
 */
const KIND_ICON: Record<LostPart["kind"], IconName> = { section: "file", link: "external", image: "image", text: "edit", file: "folder" };

export function PageLossCardView({ card, botId, seq }: { card: PageLossCard; botId: string; seq: number }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const decide = async (choice: "keep" | "restore") => {
    setBusy(true); setError(null);
    try { await api("POST", `/bots/${encodeURIComponent(botId)}/rows/${seq}/pageloss`, { choice }); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const pending = card.status === "pending";
  const shown = all ? card.lost : card.lost.slice(0, 6);
  return (
    <div className={`card pageloss-card ${pending ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile is-disk" aria-hidden="true"><Icon name="alert" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("pagekeep.title", { title: card.title })}</p>
          <p className="card-sub">{t("pagekeep.sub", { n: card.total })}</p>
        </div>
      </div>
      <ul className="pageloss-list">
        {shown.map((p, i) => (
          <li key={i} className="pageloss-item">
            <Icon name={KIND_ICON[p.kind]} size={14} />
            <span className="pageloss-kind">{t(`pagekeep.kind.${p.kind}` as Key)}</span>
            <span className="pageloss-text">{p.text}{p.detail && <span className="muted small"> · {p.detail}</span>}</span>
          </li>
        ))}
      </ul>
      {card.lost.length > 6 && <button type="button" className="link small" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? t("pagekeep.less") : t("pagekeep.more", { n: card.lost.length - 6 })}</button>}
      {card.total > card.lost.length && <p className="muted small">{t("pagekeep.cut", { n: card.total - card.lost.length })}</p>}
      {pending ? (
        <>
          <p className="card-reason">{t("pagekeep.ask")}</p>
          <div className="card-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void decide("keep")}>{t("pagekeep.keep")}</button>
            <span className="spacer" />
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void decide("restore")}><Icon name="history" size={15} /> {t(busy ? "common.working" : "pagekeep.restore")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status === "restored" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "restored" ? "history" : "check"} size={14} />
          {t(card.status === "restored" ? "pagekeep.restored" : "pagekeep.kept")}
        </p>
      )}
    </div>
  );
}

interface Decision { id: string; topic: "colors" | "fonts" | "layout" | "other"; decision: string; why: string; by: "user" | "bot"; createdAt: number }
const TOPICS: Decision["topic"][] = ["colors", "fonts", "layout", "other"];
const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

export function DesignJournal() {
  const t = useT();
  const id = useId();
  const [list, setList] = useState<Decision[] | null>(null);
  const [topic, setTopic] = useState<Decision["topic"]>("colors");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ decisions: Decision[] }>("GET", "/design-journal").then((r) => !dead && setList(r.decisions ?? []), (e) => !dead && (setError(errText(e)), setList([])));
    return () => { dead = true; };
  }, []);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { const r = await api<{ decision: Decision }>("POST", "/design-journal", { topic, decision: text }); setList((cur) => [r.decision, ...(cur ?? []).filter((d) => d.id !== r.decision.id)]); setText(""); }
    catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  const remove = async (d: Decision) => {
    setError(null);
    try { await api("DELETE", `/design-journal/${encodeURIComponent(d.id)}`); setList((cur) => cur?.filter((x) => x.id !== d.id) ?? null); } catch (err) { setError(errText(err)); }
  };
  return (
    <section className="design-journal" aria-labelledby={`${id}h`}>
      <h3 className="pane-heading" id={`${id}h`}>{t("dj.title")}</h3>
      <p className="muted small">{t("dj.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!list && <Loading />}
      {list && list.length === 0 && <p className="muted small">{t("dj.empty")}</p>}
      {list && TOPICS.filter((tp) => list.some((d) => d.topic === tp)).map((tp) => (
        <div key={tp} className="dj-group">
          <p className="dj-topic">{t(`dj.topic.${tp}` as Key)}</p>
          <ul className="dj-list">
            {list.filter((d) => d.topic === tp).map((d) => (
              <li key={d.id} className="dj-item">
                <span className="dj-text">
                  {tp === "colors" && (d.decision.match(HEX) ?? []).slice(0, 6).map((h) => <span key={h} className="dj-swatch" style={{ background: h }} aria-hidden="true" />)}
                  {d.decision}
                  {d.why && <span className="muted small"> · {d.why}</span>}
                  <span className="chip">{t(d.by === "bot" ? "dj.byBot" : "dj.byYou")}</span>
                </span>
                <ConfirmButton className="btn btn-small btn-ghost-danger" icon="trash" ariaLabel={t("dj.remove")} label={t("dj.remove")} confirmLabel={t("dj.removeConfirm")} busyLabel="…" onConfirm={() => remove(d)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form className="dj-form" onSubmit={add}>
        <label className="small" htmlFor={`${id}t`}>{t("dj.topicLabel")}</label>
        <select id={`${id}t`} className="input" value={topic} onChange={(e) => setTopic(e.target.value as Decision["topic"])}>
          {TOPICS.map((tp) => <option key={tp} value={tp}>{t(`dj.topic.${tp}` as Key)}</option>)}
        </select>
        <label className="small" htmlFor={`${id}d`}>{t("dj.decisionLabel")}</label>
        <input id={`${id}d`} className="input" value={text} maxLength={300} placeholder={t("dj.placeholder")} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !text.trim()}><Icon name="plus" size={13} /> {t("dj.add")}</button>
      </form>
    </section>
  );
}
