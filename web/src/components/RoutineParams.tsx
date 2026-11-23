import { useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Routine } from "../types";
import { routineParams } from "../../../server/src/clientshared/routineparams";
import { dateTime } from "../lib/format";
import { Icon, Spinner } from "./Icon";
import { CopyButton, ErrorNote } from "./ui";

/**
 * L143 — « Lancer avec ces valeurs »: a routine whose instruction holds {{name}} or {{name=default}} gets one field per
 * parameter, filled with its default; a scheduled run uses the defaults (server: clientshared/routineparams.ts).
 */
export function RoutineRunForm({ r, revision, onNote }: { r: Routine; revision?: number; onNote: (t: string) => void }) {
  const t = useT();
  const params = routineParams(r.prompt);
  const base = useId();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, p.fallback])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!params.length) return null;
  const run = async () => {
    setBusy(true); setError(null);
    try { await api("POST", `/routines/${enc(r.id)}/run`, { revision, params: values }); onNote(t("routine.runningNow")); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <form className="routine-params" onSubmit={(e) => { e.preventDefault(); if (!busy) void run(); }}>
      <p className="small"><strong>{t("routineParams.title")}</strong> <span className="muted">{t("routineParams.hint")}</span></p>
      <div className="routine-params-fields">
        {params.map((p, i) => (
          <div className="field" key={p.name}>
            <label className="field-label" htmlFor={`${base}-${i}`}>{p.name}</label>
            <input id={`${base}-${i}`} className="input" value={values[p.name] ?? ""} maxLength={500} placeholder={p.fallback || t("routineParams.empty")} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
          </div>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="submit" className="btn btn-small btn-primary" disabled={busy}>
          {busy ? <Spinner size={12} /> : <Icon name="bolt" size={13} />} {t("routineParams.run")}
        </button>
      </div>
    </form>
  );
}

interface FeedStatus { active: boolean; createdAt: number | null; lastReadAt: number | null; url?: string }

/** L143 — the routines in your calendar app: a read-only iCalendar link, shown once, replaced or removed at any time. */
export function RoutineCalendarFeed({ startStatus }: { /** Gallery: a fixed state, no server call. */ startStatus?: FeedStatus }) {
  const t = useT();
  const [status, setStatus] = useState<FeedStatus | null>(startStatus ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (startStatus) return;
    let dead = false;
    api<FeedStatus>("GET", "/routine-calendar").then((s) => { if (!dead) setStatus(s); }, (e: unknown) => { if (!dead) setError(errText(e)); });
    return () => { dead = true; };
  }, [startStatus]);
  const act = async (method: "POST" | "DELETE") => {
    setBusy(true); setError(null);
    try { setStatus(await api<FeedStatus>(method, "/routine-calendar")); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="routine-feed" aria-labelledby="routine-feed-title">
      <h3 id="routine-feed-title" className="routine-feed-title"><Icon name="clock" size={14} /> {t("routineFeed.title")}</h3>
      <p className="small muted">{t("routineFeed.intro")}</p>
      {status?.url && (
        <div className="routine-feed-link">
          <input className="input mono" readOnly value={status.url} aria-label={t("routineFeed.link")} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={status.url} label={t("routineFeed.copy")} />
          <p className="small">{t("routineFeed.once")}</p>
        </div>
      )}
      {status?.active && !status.url && (
        <p className="small">{t("routineFeed.active", { date: status.createdAt ? dateTime(status.createdAt) : "?" })}{status.lastReadAt ? ` · ${t("routineFeed.lastRead", { date: dateTime(status.lastReadAt) })}` : ""}</p>
      )}
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <span className="spacer" />
        {status?.active && <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy} onClick={() => void act("DELETE")}>{t("routineFeed.remove")}</button>}
        <button type="button" className="btn btn-small" disabled={busy || !status} onClick={() => void act("POST")}>{t(status?.active ? "routineFeed.renew" : "routineFeed.create")}</button>
      </div>
    </section>
  );
}
