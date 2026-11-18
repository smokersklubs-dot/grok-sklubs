import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { api, ApiError, errText } from "../api";
import { intlLocale, useT } from "../i18n";
import { qrPath } from "../lib/qr";
import type { User } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, CopyButton, ErrorNote } from "./ui";
import "./TwoFactor.css";

/**
 * Two-factor sign-in (server: twofactor.ts). Settings → Account: turn it on with a QR code drawn here (lib/qr.ts: the
 * seed never leaves the page), confirm with a code, keep the 10 recovery codes; turn it off (password + code); new
 * recovery codes. Also "sign out of every other device". On the sign-in page: the second step (code or recovery code).
 */
interface Status { enabled: boolean; enabledAt: number | null; recoveryLeft: number; hasPassword: boolean }
interface Overview { twoFactor: Status; sessions: number }

/** A 6-digit code field (also takes a recovery code when `recovery`). */
function CodeInput({ id, value, onChange, recovery, autoFocus }: { id: string; value: string; onChange: (v: string) => void; recovery?: boolean; autoFocus?: boolean }) {
  return (
    <input id={id} className="input tfa-code" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="one-time-code" spellCheck={false} autoFocus={autoFocus}
      inputMode={recovery ? "text" : "numeric"} maxLength={recovery ? 20 : 7} placeholder={recovery ? "abcd-efgh-ijkl" : "123 456"} />
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT();
  const text = `${t("tfa.recoveryFileTitle")}\n\n${codes.join("\n")}\n`;
  const href = useMemo(() => URL.createObjectURL(new Blob([text], { type: "text/plain" })), [text]);
  useEffect(() => () => URL.revokeObjectURL(href), [href]);
  return (
    <div className="tfa-panel" role="region" aria-label={t("tfa.recoveryTitle")}>
      <p className="action-title">{t("tfa.recoveryTitle")}</p>
      <p className="muted small">{t("tfa.recoveryHint")}</p>
      <ol className="tfa-recovery">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <div className="row-end tfa-actions">
        <CopyButton text={codes.join("\n")} label={t("tfa.copyCodes")} />
        <a className="btn btn-small" href={href} download="sklubot-codes-de-secours.txt"><Icon name="download" size={14} /> {t("tfa.downloadCodes")}</a>
        <button type="button" className="btn btn-primary btn-small" onClick={onDone}>{t("tfa.savedCodes")}</button>
      </div>
    </div>
  );
}

function Setup({ onEnabled, onCancel }: { onEnabled: (codes: string[]) => void; onCancel: () => void }) {
  const t = useT();
  const uid = useId();
  const [seed, setSeed] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ secret: string; uri: string }>("POST", "/account/2fa/setup").then(setSeed, (e) => setError(errText(e))); }, []);
  const qr = useMemo(() => (seed ? qrPath(seed.uri) : null), [seed]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setError(null);
    try { onEnabled((await api<{ recoveryCodes: string[] }>("POST", "/account/2fa/confirm", { code })).recoveryCodes); }
    catch (err) { setError(errText(err)); setBusy(false); }
  };
  return (
    <form className="tfa-panel" onSubmit={submit}>
      <ol className="tfa-steps">
        <li>{t("tfa.step1")}</li>
        <li>{t("tfa.step2")}</li>
      </ol>
      {seed && qr ? (
        <div className="tfa-setup">
          <svg className="tfa-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={t("tfa.qrLabel")} shapeRendering="crispEdges">
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
          <div className="tfa-seed">
            <p className="muted small">{t("tfa.manual")}</p>
            <code className="tfa-secret" aria-label={t("tfa.secretLabel")}>{seed.secret.replace(/(.{4})(?=.)/g, "$1 ")}</code>
            <div className="tfa-actions">
              <CopyButton text={seed.secret} label={t("tfa.copySecret")} />
              <a className="btn btn-small" href={seed.uri}>{t("tfa.openApp")}</a>
            </div>
          </div>
        </div>
      ) : !error && <p className="muted small" aria-busy="true">…</p>}
      <div className="field">
        <label className="field-label" htmlFor={`${uid}c`}>{t("tfa.step3")}</label>
        <CodeInput id={`${uid}c`} value={code} onChange={setCode} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end tfa-actions">
        <button type="button" className="btn btn-small" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !seed || code.replace(/\D/g, "").length !== 6}>{t(busy ? "common.saving" : "tfa.confirm")}</button>
      </div>
    </form>
  );
}

/** Password (when the account has one) + code: turn off, or make new recovery codes (code only). */
function Verify({ mode, hasPassword, onDone, onCancel }: { mode: "disable" | "regen"; hasPassword: boolean; onDone: (r: { recoveryCodes?: string[] }) => void; onCancel: () => void }) {
  const t = useT();
  const uid = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPassword = mode === "disable" && hasPassword;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try { onDone(await api<{ recoveryCodes?: string[] }>("POST", mode === "disable" ? "/account/2fa/disable" : "/account/2fa/recovery", { code, ...(needsPassword ? { password } : {}) })); }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? t("account.wrongPassword") : errText(err)); setBusy(false); }
  };
  return (
    <form className="tfa-panel" onSubmit={submit}>
      <p className="muted small">{t(mode === "disable" ? "tfa.disableHint" : "tfa.regenHint")}</p>
      <div className={needsPassword ? "form-cols is-even" : undefined}>
        {needsPassword && (
          <div className="field">
            <label className="field-label" htmlFor={`${uid}p`}>{t("account.currentPassword")}</label>
            <input id={`${uid}p`} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${uid}c`}>{t(mode === "disable" ? "tfa.codeOrRecovery" : "tfa.codeLabel")}</label>
          <CodeInput id={`${uid}c`} value={code} onChange={setCode} recovery={mode === "disable"} autoFocus={!needsPassword} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end tfa-actions">
        <button type="button" className="btn btn-small" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className={`btn btn-small ${mode === "disable" ? "btn-danger" : "btn-primary"}`} disabled={busy || !code.trim() || (needsPassword && !password)}>
          {t(busy ? "common.saving" : mode === "disable" ? "tfa.disable" : "tfa.regen")}
        </button>
      </div>
    </form>
  );
}

/** Settings → Account → "Double authentification" and the devices signed in. */
export function TwoFactorSettings() {
  const t = useT();
  const [info, setInfo] = useState<Overview | null>(null);
  const [view, setView] = useState<"idle" | "setup" | "disable" | "regen">("idle");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Overview>("GET", "/account/2fa").then(setInfo, () => setInfo(null));
  useEffect(() => { void load(); }, []);
  if (!info) return null;
  const s = info.twoFactor;
  const since = s.enabledAt ? new Date(s.enabledAt).toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" }) : "";
  const revoke = async () => {
    setError(null); setNotice(null);
    try {
      const r = await api<{ revoked: number; sessions: number }>("POST", "/account/sessions/revoke-others");
      setNotice(t("tfa.revoked", { n: r.revoked }));
      await load();
    } catch (err) { setError(errText(err)); }
  };

  return (
    <>
      <h3 className="pane-heading">{t("tfa.heading")}</h3>
      {codes ? <RecoveryCodes codes={codes} onDone={() => { setCodes(null); void load(); }} /> : (
        <>
          <div className="action-row">
            <div>
              <p className="action-title tfa-state">
                <span className={`tfa-dot ${s.enabled ? "is-on" : ""}`} aria-hidden="true" />
                {t(s.enabled ? "tfa.on" : "tfa.off")}
              </p>
              <p className="muted small">{s.enabled ? t("tfa.onHint", { date: since, n: s.recoveryLeft }) : t("tfa.offHint")}</p>
            </div>
            {view === "idle" && !s.enabled && <button type="button" className="btn btn-primary btn-small" onClick={() => setView("setup")}><Icon name="shield" size={14} /> {t("tfa.enable")}</button>}
          </div>
          {view === "idle" && s.enabled && (
            <div className="row-end tfa-actions">
              <button type="button" className="btn btn-small" onClick={() => setView("regen")}><Icon name="key" size={14} /> {t("tfa.regen")}</button>
              <button type="button" className="btn btn-small btn-danger" onClick={() => setView("disable")}>{t("tfa.disable")}</button>
            </div>
          )}
          {view === "setup" && <Setup onCancel={() => setView("idle")} onEnabled={(c) => { setCodes(c); setView("idle"); }} />}
          {(view === "disable" || view === "regen") && (
            <Verify mode={view} hasPassword={s.hasPassword} onCancel={() => setView("idle")}
              onDone={(r) => { setView("idle"); if (r.recoveryCodes) setCodes(r.recoveryCodes); else void load(); }} />
          )}
        </>
      )}

      <div className="action-row">
        <div>
          <p className="action-title">{t("tfa.devices", { n: info.sessions })}</p>
          <p className="muted small">{t("tfa.devicesHint")}</p>
        </div>
        <ConfirmButton className="btn btn-small" label={<><Icon name="logout" size={14} /> {t("tfa.revokeOthers")}</>} confirmLabel={t("tfa.revokeConfirm")} disabled={info.sessions <= 1} onConfirm={revoke} />
      </div>
      {notice && <p className="muted small" role="status">{notice}</p>}
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}

/** Hosted mode, operators (Hosted.tsx, a customer's panel): sign that account out of every device. */
export function AdminRevokeSessions({ uid }: { uid: string }) {
  const t = useT();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revoke = async () => {
    setMsg(null); setError(null);
    try { const r = await api<{ revoked: number }>("POST", `/admin/customers/${encodeURIComponent(uid)}/sessions/revoke`); setMsg(t("tfa.adminRevoked", { n: r.revoked })); }
    catch (err) { setError(errText(err)); }
  };
  return (
    <div className="hosted-box">
      <p className="field-label">{t("tfa.adminRevoke")}</p>
      <p className="muted small">{t("tfa.adminRevokeHint")}</p>
      <ConfirmButton className="btn btn-small" label={<><Icon name="logout" size={14} /> {t("tfa.adminRevoke")}</>} confirmLabel={t("tfa.revokeConfirm")} onConfirm={revoke} />
      {msg && <p className="muted small" role="status">{msg}</p>}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

/**
 * The second step of a sign-in. `token`: from the password answer (the browser also holds it in a short-lived cookie,
 * which is all a redirect — Google, a sign-in link, a password reset — leaves).
 */
export function SecondStep({ token, onDone, onCancel }: { token?: string; onDone: (u: User) => void; onCancel: () => void }) {
  const t = useT();
  const uid = useId();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ user: User }>("POST", "/auth/2fa", { code, ...(token ? { token } : {}) });
      onDone(r.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setExpired(true);
      setError(errText(err));
      setCode("");
      setBusy(false);
    }
  };
  return (
    <form className="tfa-second" onSubmit={submit} noValidate>
      <h2 className="signin-title tfa-second-title"><Icon name="shield" size={16} /> {t("tfa.secondTitle")}</h2>
      <p className="muted small">{t(recovery ? "tfa.secondRecoveryHint" : "tfa.secondHint")}</p>
      {!expired && (
        <div className="field">
          <label className="field-label" htmlFor={`${uid}c`}>{t(recovery ? "tfa.recoveryLabel" : "tfa.codeLabel")}</label>
          <CodeInput id={`${uid}c`} value={code} onChange={setCode} recovery={recovery} autoFocus />
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {!expired && <button type="submit" className="btn btn-primary btn-block" disabled={busy || !code.trim()}>{t(busy ? "signin.signingIn" : "tfa.verify")}</button>}
      <p className="signin-switch">
        {!expired && <button type="button" className="link" onClick={() => { setRecovery(!recovery); setCode(""); setError(null); }}>{t(recovery ? "tfa.useApp" : "tfa.useRecovery")}</button>}
        {!expired && " · "}
        <button type="button" className="link" onClick={onCancel}>{t("tfa.back")}</button>
      </p>
    </form>
  );
}
