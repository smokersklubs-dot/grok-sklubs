import { useId, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";

/**
 * L83 — the owner's signature of a Gmail or Outlook account (server native/mailextras.ts): added at the end of the
 * emails and drafts the bots write from it (after "-- "). Folded until opened; loaded when opened. `initial`: gallery.
 */
export function MailSignature({ accountId, initial }: { accountId: string; initial?: string }) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState<string | null>(initial ?? null);
  const [saved, setSaved] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    if (text !== null) return;
    api<{ text: string }>("GET", `/native/accounts/${encodeURIComponent(accountId)}/signature`).then((r) => { setText(r.text); setSaved(r.text); }, (e: unknown) => setError(errText(e)));
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ text: string }>("PUT", `/native/accounts/${encodeURIComponent(accountId)}/signature`, { text: text ?? "" });
      setText(r.text); setSaved(r.text); setOk(true); window.setTimeout(() => setOk(false), 1800);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <details className="connector-note mail-signature" open={initial !== undefined} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>{saved ? t("signature.titleSet") : t("signature.title")}</summary>
      <label className="field-hint" htmlFor={`${id}s`}>{t("signature.hint")}</label>
      <textarea id={`${id}s`} className="input" rows={3} maxLength={2000} value={text ?? ""} disabled={text === null} placeholder={t("signature.placeholder")} onChange={(e) => setText(e.target.value)} />
      <div className="mail-signature-actions">
        <button type="button" className="btn btn-small" disabled={busy || text === null || text === saved} onClick={() => void save()}>{t(busy ? "common.saving" : "common.save")}</button>
        {ok && <span className="chip state-ready" role="status">{t("common.saved")}</span>}
      </div>
      {error && <p className="card-error" role="alert">{error}</p>}
    </details>
  );
}
