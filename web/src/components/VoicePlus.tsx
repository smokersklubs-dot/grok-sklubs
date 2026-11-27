import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { getLocale, useT, intlTag } from "../i18n";
import { installLocal, localStatus, setWakeEnabled, wakeEnabled, type LocalStatus } from "../lib/wakeword";
import { ErrorNote } from "./ui";
import "./VoicePlus.css";

/**
 * L154 in Settings → Voice: the wake word (this device only, on-device recognition only: lib/wakeword.ts) and the reminder
 * calls to YOUR phone (server voice/remindercall.ts: your own Twilio account, your own number, nobody else is ever called).
 */
export function VoicePlus({ initialStatus }: { initialStatus?: LocalStatus }) {
  return (
    <>
      <WakeWordSetting initialStatus={initialStatus} />
      <ReminderCallSetting />
    </>
  );
}

const langOf = () => (intlTag(getLocale()));

export function WakeWordSetting({ initialStatus }: { initialStatus?: LocalStatus }) {
  const t = useT();
  const id = useId();
  const [on, setOn] = useState(wakeEnabled);
  const [status, setStatus] = useState<LocalStatus | null>(initialStatus ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!initialStatus) void localStatus(langOf()).then(setStatus); }, [initialStatus]);
  const toggle = (v: boolean) => { setWakeEnabled(v); setOn(v); };
  const install = async () => { setBusy(true); try { await installLocal(langOf()); setStatus(await localStatus(langOf())); } finally { setBusy(false); } };
  const usable = status === "available";
  return (
    <section className="voice-plus" aria-labelledby={`${id}-wake`}>
      <h3 id={`${id}-wake`}>{t("wake.title")}</h3>
      <p className="muted small">{t("wake.text")}</p>
      <label className="check-row">
        <input type="checkbox" checked={on && usable} disabled={!usable} onChange={(e) => toggle(e.target.checked)} />
        <span>{t("wake.toggle")}</span>
      </label>
      {status === null && <p className="muted small">{t("common.loading")}</p>}
      {status === "unavailable" && <p className="muted small" role="status">{t("wake.unavailable")}</p>}
      {(status === "downloadable" || status === "downloading") && (
        <p className="small voice-plus-row" role="status">
          <span>{t("wake.download")}</span>
          <button type="button" className="btn btn-small" disabled={busy || status === "downloading"} onClick={() => void install()}>{busy || status === "downloading" ? t("wake.downloading") : t("wake.install")}</button>
        </p>
      )}
    </section>
  );
}

interface Reminder { configured: boolean; enabled: boolean; accountSid: string; username: string; from: string; to: string; hasSecret: boolean; callsToday: number }

export function ReminderCallSetting({ initial }: { initial?: Reminder }) {
  const t = useT();
  const id = useId();
  const [r, setR] = useState<Reminder | null>(initial ?? null);
  const [form, setForm] = useState({ accountSid: "", username: "", secret: "", from: "", to: "" });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fill = (v: Reminder) => { setR(v); setForm({ accountSid: v.accountSid, username: v.username === v.accountSid ? "" : v.username, secret: "", from: v.from, to: v.to }); };
  useEffect(() => { if (initial) { fill(initial); return; } let dead = false; api<Reminder>("GET", "/reminder-call").then((v) => !dead && fill(v), (e) => !dead && setError(errText(e))); return () => { dead = true; }; }, [initial]);
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy("save"); setError(null); setNote(null);
    try { fill(await api<Reminder>("PUT", "/reminder-call", { ...form, secret: form.secret || undefined, ...extra })); setNote(t("remind.saved")); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy("test"); setError(null); setNote(null);
    try { fill(await api<Reminder>("POST", "/reminder-call/test")); setNote(t("remind.ringing")); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const remove = async () => {
    setError(null);
    try { await api("DELETE", "/reminder-call"); fill({ configured: false, enabled: false, accountSid: "", username: "", from: "", to: "", hasSecret: false, callsToday: 0 }); setNote(null); } catch (e) { setError(errText(e)); }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <section className="voice-plus" aria-labelledby={`${id}-remind`}>
      <h3 id={`${id}-remind`}>{t("remind.title")}</h3>
      <p className="muted small">{t("remind.text")}</p>
      {r && (
        <form className="voice-plus-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="field"><span className="field-label">{t("remind.to")}</span>
            <input className="input" type="tel" inputMode="tel" placeholder="+33612345678" value={form.to} onChange={set("to")} />
            <span className="field-hint">{t("remind.toHint")}</span>
          </label>
          <label className="field"><span className="field-label">{t("remind.from")}</span>
            <input className="input" type="tel" inputMode="tel" placeholder="+33100000000" value={form.from} onChange={set("from")} />
          </label>
          <label className="field"><span className="field-label">Account SID</span>
            <input className="input" spellCheck={false} placeholder="AC…" value={form.accountSid} onChange={set("accountSid")} />
          </label>
          <label className="field"><span className="field-label">{t("remind.secret")}</span>
            <input className="input" type="password" spellCheck={false} placeholder={r.hasSecret ? t("remind.secretSaved") : ""} value={form.secret} onChange={set("secret")} data-1p-ignore="" data-lpignore="true" />
            <span className="field-hint">{t("remind.secretHint")}</span>
          </label>
          {r.configured && (
            <label className="check-row small"><input type="checkbox" checked={r.enabled} onChange={(e) => void save({ enabled: e.target.checked })} /><span>{t("remind.enabled")}</span></label>
          )}
          <div className="voice-plus-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy !== null}>{busy === "save" ? t("common.saving") : t("common.save")}</button>
            {r.configured && <button type="button" className="btn btn-small" disabled={busy !== null || !r.enabled} onClick={() => void test()}>{busy === "test" ? t("remind.testing") : t("remind.test")}</button>}
            {r.configured && <button type="button" className="btn btn-small btn-ghost" onClick={() => void remove()}>{t("remind.remove")}</button>}
          </div>
          {r.configured && <p className="muted small">{t("remind.limits", { n: r.callsToday })}</p>}
          {note && <p className="provider-check is-ok" role="status">{note}</p>}
        </form>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </section>
  );
}
