/**
 * The server's own e-mails (server side: server/src/accountmail.ts):
 *  - "Mot de passe oublié ?" on the sign-in page, and the page a reset link opens (/?reset=…);
 *  - the page a change-of-address link opens (/?email_change=…);
 *  - Settings → Account: the account's e-mail address, and the owner's "E-mails du serveur" (SMTP) block.
 * Tokens are read from the address once, then removed from it (history.replaceState) so they do not stay in history.
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, errText } from "../api";
import { intlLocale, useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { CopyButton, ErrorNote } from "./ui";
import "./AccountRecovery.css";

// ── Links that arrive in the address ────────────────────────────────────────
export type LinkAction = { kind: "reset" | "emailChange"; token: string } | null;

/** Reads (and removes from the address bar) a reset or change-of-address token. */
export function takeLinkAction(): LinkAction {
  const url = new URL(location.href);
  const reset = url.searchParams.get("reset");
  const change = url.searchParams.get("email_change");
  if (!reset && !change) return null;
  url.searchParams.delete("reset");
  url.searchParams.delete("email_change");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return reset ? { kind: "reset", token: reset } : { kind: "emailChange", token: change! };
}

function Card({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <Avatar shape="squircle" color="ember" name="S" size={56} />
          <h1>Sklubot</h1>
          <p>{t("signin.tagline")}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

/** What the sign-in page says when the server has no SMTP account: ask the owner; the owner has a terminal command. */
function NoMailHelp() {
  const t = useT();
  // The terminal command of server/src/reset-password.ts (it prints a new password and signs every device out).
  const command = t("recovery.command");
  return (
    <div className="recovery-nomail" role="status">
      <p className="recovery-nomail-title"><Icon name="info" size={16} /> {t("recovery.noMailTitle")}</p>
      <p>{t("recovery.noMail")}</p>
      <p className="muted small">{t("recovery.noMailOwner")}</p>
      <div className="recovery-cmd">
        <code>{command}</code>
        <CopyButton text={command} />
      </div>
      <p className="muted small">{t("recovery.noMailSmtp")}</p>
    </div>
  );
}

/** "Mot de passe oublié ?" — shown in the sign-in card. Always the same answer, whether the address has an account. */
export function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const uid = useId();
  const [mail, setMail] = useState<boolean | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ mail: boolean }>("GET", "/auth/password/status").then((r) => setMail(r.mail), () => setMail(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim().includes("@")) { setError(t("signin.errEmail")); return; }
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/password/forgot", { email: email.trim(), locale });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setMail(false);
      else setError(errText(err));
    }
    setBusy(false);
  };

  return (
    <>
      <h2 className="signin-title">{t("recovery.title")}</h2>
      {mail === false ? <NoMailHelp /> : sent ? (
        <p className="signin-notice" role="status"><Icon name="check" size={16} /><span>{t("recovery.sent")}</span></p>
      ) : (
        <form className="recovery-form" onSubmit={submit} noValidate>
          <p className="muted small">{t("recovery.intro")}</p>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}e`}>{t("signin.email")}</label>
            <input id={`${uid}e`} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder={t("signin.emailPlaceholder")} />
          </div>
          <ErrorNote>{error}</ErrorNote>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || mail === null}>{t(busy ? "recovery.sending" : "recovery.send")}</button>
        </form>
      )}
      <p className="signin-switch">
        <button type="button" className="link" onClick={onBack}>{t("recovery.back")}</button>
      </p>
    </>
  );
}

/** The page a reset link opens: choose a new password, then every device is signed out and this one signed in. */
export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const uid = useId();
  const [valid, setValid] = useState<boolean | null>(null);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    api<{ valid: boolean }>("POST", "/auth/password/reset/check", { token, locale }).then((r) => setValid(r.valid), () => setValid(false));
  }, [token, locale]);
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || next.length < 8 || next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user?: User; twoFactor?: unknown }>("POST", "/auth/password/reset", { token, password: next, locale });
      // A fresh start: the new session cookie is set; any other account open in this browser was another session.
      // Two-factor on: the reset does not get past it — the sign-in page asks for the code (TwoFactor.tsx SecondStep).
      location.replace(r.twoFactor ? "/?second=1" : "/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && next.length >= 8) setValid(false);
      else setError(errText(err));
      setBusy(false);
    }
  };

  if (asking) return <Card><ForgotPassword initialEmail="" onBack={onDone} /></Card>;
  return (
    <Card>
      <h2 className="signin-title">{t("recovery.resetTitle")}</h2>
      {valid === null && <p className="muted small" aria-busy="true">{t("recovery.checking")}</p>}
      {valid === false && (
        <>
          <p className="signin-notice" role="alert"><Icon name="info" size={16} /><span>{t("recovery.expired")}</span></p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setAsking(true)}>{t("recovery.askNew")}</button>
          <p className="signin-switch"><button type="button" className="link" onClick={onDone}>{t("recovery.back")}</button></p>
        </>
      )}
      {valid && (
        <form className="recovery-form" onSubmit={submit} noValidate>
          <p className="muted small">{t("recovery.resetIntro")}</p>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}n`}>{t("account.newPassword")}</label>
            <input id={`${uid}n`} className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" autoFocus aria-invalid={tooShort || undefined} />
            <p className={`field-hint ${tooShort ? "is-error" : ""}`}>{t("account.passwordRule")}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}c`}>{t("account.confirmPassword")}</label>
            <input id={`${uid}c`} className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch || undefined} />
            {mismatch && <p className="field-hint is-error">{t("account.mismatch")}</p>}
          </div>
          <ErrorNote>{error}</ErrorNote>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || next.length < 8 || next !== confirm}>{t(busy ? "common.saving" : "recovery.save")}</button>
        </form>
      )}
    </Card>
  );
}

/** The page a change-of-address link opens (no session needed). */
export function EmailConfirmPage({ token }: { token: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [state, setState] = useState<{ email: string } | { error: string } | null>(null);
  useEffect(() => {
    api<{ email: string }>("POST", "/auth/email/confirm", { token, locale }).then((r) => setState({ email: r.email }), (err) => setState({ error: errText(err) }));
    // Once per link (it is single use); the language only changes the error's wording.
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card>
      <h2 className="signin-title">{t("emailConfirm.title")}</h2>
      {!state && <p className="muted small" aria-busy="true">{t("emailConfirm.checking")}</p>}
      {state && "email" in state && <p className="signin-notice" role="status"><Icon name="check" size={16} /><span>{t("emailConfirm.done", { email: state.email })}</span></p>}
      {state && "error" in state && <ErrorNote>{state.error}</ErrorNote>}
      {state && <button type="button" className="btn btn-primary btn-block" onClick={() => location.replace("/")}>{t("emailConfirm.continue")}</button>}
    </Card>
  );
}

// ── Settings → Account ──────────────────────────────────────────────────────
interface AccountEmail { email: string; pending: { email: string; expiresAt: number } | null; mail: boolean; hasPassword: boolean }

/** Change of the account's address: password first; a link to the new address when the server can send e-mails. */
export function AccountEmailBlock() {
  const t = useT();
  const uid = useId();
  const [info, setInfo] = useState<AccountEmail | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "changed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<AccountEmail>("GET", "/account/email").then(setInfo, () => setInfo(null));
  useEffect(() => { void load(); }, []);
  if (!info) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api<{ applied: boolean; user?: User; pending: AccountEmail["pending"] }>("POST", "/account/email", { email: email.trim(), password });
      if (r.applied && r.user) useStore.setState({ user: r.user });
      setDone(r.applied ? "changed" : "sent");
      setEmail(""); setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("account.wrongPassword") : errText(err));
    }
    setBusy(false);
  };
  const cancel = async () => {
    setBusy(true); setError(null);
    try { await api("DELETE", "/account/email/pending"); setDone(null); await load(); } catch (err) { setError(errText(err)); }
    setBusy(false);
  };
  const time = info.pending ? new Date(info.pending.expiresAt).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <>
      <h3 className="pane-heading">{t("account.emailHeading")}</h3>
      {info.pending && (
        <div className="action-row">
          <p className="muted small" role="status">{t("account.emailPending", { email: info.pending.email, time })}</p>
          <button type="button" className="btn btn-small" onClick={() => void cancel()} disabled={busy}>{t("account.emailCancel")}</button>
        </div>
      )}
      {!info.hasPassword ? (
        <p className="muted small">{t("account.emailNeedsPassword")}</p>
      ) : (
        <form className="editor" onSubmit={submit}>
          <p className="muted small">{t(info.mail ? "account.emailHintMail" : "account.emailHintNoMail")} {t("account.emailGoogleNote")}</p>
          <div className="form-cols is-even">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}e`}>{t("account.emailNew")}</label>
              <input id={`${uid}e`} className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setDone(null); }} autoComplete="email" placeholder={t("signin.emailPlaceholder")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}p`}>{t("account.emailPassword")}</label>
              <input id={`${uid}p`} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            {done && <span className="muted small" role="status">{t(done === "sent" ? "account.emailSent" : "account.emailChanged")}</span>}
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || !email.trim().includes("@") || !password}>{t(busy ? "common.saving" : "account.emailChange")}</button>
          </div>
        </form>
      )}
    </>
  );
}

type TlsMode = "tls" | "starttls" | "none";
interface SmtpView { configured: boolean; source: "env" | "saved" | null; host: string; port: number; tlsMode: TlsMode; username: string; hasPassword: boolean; from: string }

const DOCS = {
  gmailAppPassword: "https://support.google.com/accounts/answer/185833",
  gmailSmtp: "https://support.google.com/a/answer/176600",
  brevo: "https://developers.brevo.com/docs/smtp-integration",
  ovh: "https://docs.ovhcloud.com/fr/guides/web-cloud/web-hosting/email-sending-best-practices",
};

/** Settings → Account, for the server's owner only (the server answers 403 to anyone else, and nothing shows). */
export function ServerMailSettings() {
  const t = useT();
  const uid = useId();
  const [view, setView] = useState<SmtpView | null>(null);
  const [form, setForm] = useState({ host: "", port: "587", tlsMode: "starttls" as TlsMode, username: "", password: "", from: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fill = (v: SmtpView) => { setView(v); setForm({ host: v.host, port: String(v.port), tlsMode: v.tlsMode, username: v.username, password: "", from: v.from }); };
  useEffect(() => { api<SmtpView>("GET", "/settings/smtp").then(fill, () => setView(null)); }, []);
  if (!view) return null;
  const fromEnv = view.source === "env";
  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setNote(null); };
  const setMode = (m: TlsMode) => setForm((f) => ({ ...f, tlsMode: m, port: m === "tls" && f.port === "587" ? "465" : m === "starttls" && f.port === "465" ? "587" : f.port }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNote(null);
    try {
      fill(await api<SmtpView>("PUT", "/settings/smtp", { host: form.host.trim(), port: Number(form.port), tlsMode: form.tlsMode, username: form.username.trim(), password: form.password || undefined, from: form.from.trim() }));
      setNote(t("smtp.saved"));
    } catch (err) { setError(errText(err)); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true); setError(null); setNote(null);
    try { fill(await api<SmtpView>("DELETE", "/settings/smtp")); } catch (err) { setError(errText(err)); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true); setError(null); setNote(null);
    try { const r = await api<{ to: string }>("POST", "/settings/smtp/test"); setNote(t("smtp.testSent", { email: r.to })); } catch (err) { setError(errText(err)); }
    setBusy(false);
  };

  return (
    <>
      <h3 className="pane-heading">{t("smtp.title")}</h3>
      <div className="google-settings">
        <p className="muted small">{t("smtp.intro")}</p>
        <p className={`google-status ${view.configured ? "is-on" : ""}`} role="status">
          <span className="google-dot" aria-hidden="true" /> {t(view.configured ? "smtp.statusOn" : "smtp.statusOff")}
        </p>
        {fromEnv && <p className="muted small">{t("smtp.fromEnv")}</p>}

        <details className="google-guide" open={!view.configured}>
          <summary>{t("smtp.guideTitle")}</summary>
          <p className="recovery-guide-h">Gmail</p>
          <ol>
            <li>{t("smtp.gmail1")}</li>
            <li>{t("smtp.gmail2")}</li>
            <li>{t("smtp.gmail3")}</li>
          </ol>
          <p className="recovery-guide-h">Brevo</p>
          <p className="small">{t("smtp.brevo")}</p>
          <p className="recovery-guide-h">OVHcloud (MX Plan)</p>
          <p className="small">{t("smtp.ovh")}</p>
          <p className="muted small recovery-docs">
            {t("smtp.docs")}{" "}
            <a href={DOCS.gmailAppPassword} target="_blank" rel="noreferrer">{t("smtp.docGmailApp")}</a>
            {" · "}<a href={DOCS.gmailSmtp} target="_blank" rel="noreferrer">{t("smtp.docGmailSmtp")}</a>
            {" · "}<a href={DOCS.brevo} target="_blank" rel="noreferrer">Brevo</a>
            {" · "}<a href={DOCS.ovh} target="_blank" rel="noreferrer">OVHcloud</a>
          </p>
        </details>

        {!fromEnv && (
          <form className="google-form" onSubmit={save}>
            <div className="form-cols is-even">
              <div className="field">
                <label className="field-label" htmlFor={`${uid}h`}>{t("smtp.host")}</label>
                <input id={`${uid}h`} className="input" value={form.host} onChange={(e) => set("host", e.target.value)} spellCheck={false} autoComplete="off" placeholder="smtp.gmail.com" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${uid}m`}>{t("smtp.tls")}</label>
                <select id={`${uid}m`} className="input" value={form.tlsMode} onChange={(e) => setMode(e.target.value as TlsMode)}>
                  <option value="tls">{t("smtp.tlsTls")}</option>
                  <option value="starttls">{t("smtp.tlsStarttls")}</option>
                  <option value="none">{t("smtp.tlsNone")}</option>
                </select>
              </div>
            </div>
            <div className="form-cols is-even">
              <div className="field">
                <label className="field-label" htmlFor={`${uid}p`}>{t("smtp.port")}</label>
                <input id={`${uid}p`} className="input" inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, "").slice(0, 5))} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${uid}u`}>{t("smtp.username")}</label>
                <input id={`${uid}u`} className="input" value={form.username} onChange={(e) => set("username", e.target.value)} spellCheck={false} autoComplete="off" placeholder="toi@gmail.com" />
              </div>
            </div>
            <div className="form-cols is-even">
              <div className="field">
                <label className="field-label" htmlFor={`${uid}w`}>{t("smtp.password")}</label>
                <input id={`${uid}w`} className="input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} spellCheck={false} autoComplete="new-password" placeholder={view.hasPassword ? t("smtp.passwordKept") : ""} />
                <p className="field-hint">{t("smtp.passwordHint")}</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${uid}f`}>{t("smtp.from")}</label>
                <input id={`${uid}f`} className="input" type="email" value={form.from} onChange={(e) => set("from", e.target.value)} spellCheck={false} autoComplete="off" placeholder="toi@gmail.com" />
                <p className="field-hint">{t("smtp.fromHint")}</p>
              </div>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="google-actions">
              {note && <span className="muted small" role="status">{note}</span>}
              {view.configured && <button type="button" className="btn btn-small" onClick={() => void remove()} disabled={busy}>{t("smtp.remove")}</button>}
              {view.configured && <button type="button" className="btn btn-small" onClick={() => void test()} disabled={busy}>{t("smtp.test")}</button>}
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !form.host.trim() || !form.port || !form.from.includes("@")}>{t(busy ? "common.saving" : "smtp.save")}</button>
            </div>
          </form>
        )}
        {fromEnv && (
          <>
            <ErrorNote>{error}</ErrorNote>
            <div className="google-actions">
              {note && <span className="muted small" role="status">{note}</span>}
              <button type="button" className="btn btn-small" onClick={() => void test()} disabled={busy}>{t("smtp.test")}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
