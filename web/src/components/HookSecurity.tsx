import { useCallback, useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { dateTime, relTime } from "../lib/format";
import { Icon } from "./Icon";
import { copyText, ErrorNote } from "./ui";
import "./HookSecurity.css";

/**
 * L20 — a webhook routine's protection (server: hooktrust.ts, hookroutes.ts), under its address in Réglages du bot →
 * Routines: « non signé » warning or the signature state, create / paste / renew / remove the signing secret (a created
 * one is shown once), grouping of calls close together, « Envoyer un exemple » (a dry run), and the refused calls.
 */
type Reason = "paused" | "too_large" | "no_signature" | "bad_signature" | "stale_timestamp" | "secret_unreadable" | "rate_limited" | "duplicate";
export interface HookView { signed: boolean; secretSetAt: number | null; previousUntil: number | null; groupSec: number; refusals: { at: number; reason: Reason; detail: string; ip: string }[]; pending: number; secret?: string }
interface Check { id: "address" | "active" | "signature" | "bot"; ok: boolean; unsigned?: boolean; unreadable?: boolean }
interface TestResult { wouldRun: boolean; grouped: number; checks: Check[] }

const GROUPS = [0, 10, 30, 60, 300, 600] as const;

export function HookSecurity({ routineId, initial }: { routineId: string; initial?: HookView }) {
  const t = useT();
  const uid = useId();
  const [data, setData] = useState<HookView | null>(initial ?? null);
  const [secret, setSecret] = useState<string | null>(initial?.secret ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const base = `/routines/${enc(routineId)}/hook`;

  const load = useCallback(async () => {
    try { setData(await api<HookView>("GET", base)); } catch (e) { setError(errText(e)); }
  }, [base]);
  useEffect(() => { if (!initial) void load(); }, [load, initial]);

  const run = async (fn: () => Promise<HookView>) => {
    setBusy(true); setError(null);
    try { const v = await fn(); setData(v); if (v.secret) setSecret(v.secret); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const create = () => run(() => api<HookView>("POST", `${base}/secret`, {}));
  const savePasted = () => run(async () => { const v = await api<HookView>("POST", `${base}/secret`, { secret: pasted.trim() }); setPaste(false); setPasted(""); setSecret(null); return v; });
  const remove = () => { if (window.confirm(t("hook.removeConfirm"))) void run(async () => { setSecret(null); return api<HookView>("DELETE", `${base}/secret`); }); };
  const group = (sec: number) => run(() => api<HookView>("PUT", base, { groupSec: sec }));
  const sendSample = async () => {
    setBusy(true); setError(null);
    try { setTest(await api<TestResult>("POST", `${base}/test`)); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  if (!data) return <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>;
  const checkLabel = (c: Check): string => c.id === "signature" ? t(c.unreadable ? "hook.check.signatureUnreadable" : c.unsigned ? "hook.check.signatureNone" : "hook.check.signature") : t(`hook.check.${c.id}` as Key);

  return (
    <div className="hook-trust">
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {data.signed ? (
        <p className="callout is-ok"><Icon name="shield" size={15} /> <span>{t("hook.signed", { date: data.secretSetAt ? dateTime(data.secretSetAt) : "—" })}{data.previousUntil ? ` ${t("hook.prevValid", { date: dateTime(data.previousUntil) })}` : ""}</span></p>
      ) : (
        <p className="callout is-warn"><Icon name="alert" size={15} /> <span><b>{t("hook.unsignedTitle")}</b> {t("hook.unsigned")}</span></p>
      )}
      {secret && (
        <div className="hook-secret" role="status">
          <p className="field-hint">{t("hook.secretOnce")}</p>
          <div className="hook">
            <code className="truncate" title={secret}>{secret}</code>
            <button type="button" className="btn btn-small" onClick={async () => { if (await copyText(secret)) { setCopied(true); window.setTimeout(() => setCopied(false), 1500); } }}>
              <Icon name={copied ? "check" : "copy"} size={13} /> {t(copied ? "routine.copied" : "routine.copy")}
            </button>
          </div>
        </div>
      )}
      <div className="hook-trust-actions">
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void create()}><Icon name="key" size={13} /> {t(data.signed ? "hook.renew" : "hook.create")}</button>
        <button type="button" className="btn btn-small" disabled={busy} aria-expanded={paste} onClick={() => setPaste((v) => !v)}><Icon name="clip" size={13} /> {t("hook.paste")}</button>
        {data.signed && <button type="button" className="btn btn-small" disabled={busy} onClick={remove}><Icon name="trash" size={13} /> {t("hook.remove")}</button>}
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void sendSample()}><Icon name="send" size={13} /> {t("hook.test")}</button>
      </div>
      {paste && (
        <form className="field hook-paste" onSubmit={(e) => { e.preventDefault(); if (pasted.trim()) void savePasted(); }}>
          <label className="field-label" htmlFor={`${uid}p`}>{t("hook.pasteLabel")}</label>
          <div className="hook-paste-row">
            <input id={`${uid}p`} className="input input-small" type="password" autoComplete="off" spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button type="submit" className="btn btn-small btn-primary" disabled={busy || !pasted.trim()}>{t("hook.pasteSave")}</button>
          </div>
        </form>
      )}
      <p className="field-hint">{t("hook.formats")}</p>
      {test && (
        <div className={`hook-test ${test.wouldRun ? "is-ok" : "is-bad"}`} role="status">
          <p className="hook-test-title">{test.wouldRun ? (test.grouped ? t("hook.testGrouped", { sec: test.grouped }) : t("hook.testOk")) : t("hook.testFail")}</p>
          <ul>
            {test.checks.map((c) => <li key={c.id} className={c.ok ? "" : "is-bad"}><Icon name={c.ok ? "check" : "alert"} size={13} /> {checkLabel(c)}</li>)}
          </ul>
          <p className="field-hint">{t("hook.testNote")}</p>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${uid}g`}>{t("hook.group")}</label>
        <select id={`${uid}g`} className="input input-small hook-group" value={data.groupSec} disabled={busy} onChange={(e) => void group(Number(e.target.value))}>
          {GROUPS.map((g) => <option key={g} value={g}>{t(`hook.group.${g}` as Key)}</option>)}
        </select>
        <p className="field-hint">{t("hook.groupHint")}{data.pending ? ` ${t("hook.pending", { n: data.pending })}` : ""}</p>
      </div>
      <details className="hook-refusals">
        <summary>{t("hook.refusals", { n: data.refusals.length })}</summary>
        {data.refusals.length === 0 ? <p className="muted small">{t("hook.refusalsNone")}</p> : (
          <ul>
            {data.refusals.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <time dateTime={new Date(r.at).toISOString()}>{relTime(r.at)}</time>
                <span className="chip">{t(`hook.refusal.${r.reason}` as Key)}</span>
                {(r.detail || r.ip) && <span className="muted small truncate">{[r.detail, r.ip].filter(Boolean).join(" · ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
