/**
 * Mandatory e-mail verification of a new public account (server publicsignup.ts): the full-screen page that is the whole
 * app until the address is confirmed (VerifyEmailGate), and the page the e-mail's link opens (/?verify_email=…).
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { LOCALES, useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import { GoogleSignInButton } from "./GoogleLogin";
import "../styles/firstrun.css";

/** Reads ?verify_email=… once and removes it from the address (the token must not stay in the history). */
export function takeVerifyLink(): string | null {
  const url = new URL(location.href);
  const token = url.searchParams.get("verify_email");
  if (!token) return null;
  url.searchParams.delete("verify_email");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return token;
}

/**
 * Reads the signed-in person again (after a confirmation). An account that was held and is now confirmed enters the app:
 * its bots, events and the rest are loaded only now (store.signedIn), since the server refused them until then.
 */
export async function refreshUser(): Promise<User | null> {
  const me = await api<{ user: User | null }>("GET", "/me");
  const before = useStore.getState().user;
  if (me.user && before?.emailUnverified && !me.user.emailUnverified) await useStore.getState().signedIn(me.user);
  else if (me.user) useStore.setState({ user: me.user });
  return me.user;
}

/** "18:42" today, or "18/11 … 18:42" when the deadline is another day, in the person's language. */
function deadlineText(t: ReturnType<typeof useT>, locale: string, at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return t("verify.gateDeadline", { time });
  return t("verify.gateDeadlineDay", { time, day: d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }) });
}

/**
 * The whole app for an account whose address is not confirmed (mandatory: the server answers 403 email_unverified to
 * everything else, publicsignup.ts): the address, the deadline after which the account is deleted, "J'ai confirmé",
 * "Renvoyer l'e-mail", "Continuer avec Google" (confirms at once), "Changer d'adresse" and "Se déconnecter".
 */
export function VerifyEmailGate() {
  const user = useStore((s) => s.user);
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const logout = useStore((s) => s.logout);
  const t = useT();
  const ids = { email: useId(), password: useId() };
  const [busy, setBusy] = useState<"resend" | "check" | "change" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mail, setMail] = useState(true);
  const [google, setGoogle] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    api<{ mail: boolean; pending: { email: string } | null }>("GET", "/account/email").then((r) => { setMail(r.mail); setPending(r.pending?.email ?? null); }, () => undefined);
    api<{ enabled: boolean }>("GET", "/auth/google/status").then((r) => setGoogle(r.enabled), () => setGoogle(false));
    // Confirmed in another tab or on the phone: the app opens by itself.
    const poll = () => { if (document.visibilityState === "visible") void refreshUser().catch(() => undefined); };
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener("focus", poll);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", poll); };
  }, []);
  if (!user) return null;
  // The address in bold inside the sentence, whatever the language puts around it.
  const [before, after = ""] = t("verify.gateText", { email: "\u0000" }).split("\u0000");
  const resend = async () => {
    setBusy("resend"); setError(null); setNotice(null);
    try {
      const r = await api<{ verified: boolean; email?: string }>("POST", "/account/verify-email/resend");
      if (r.verified) await refreshUser();
      else setNotice(t("verify.sent", { email: r.email ?? user.email }));
    } catch (e) { setError(errText(e)); }
    setBusy(null);
  };
  const check = async () => {
    setBusy("check"); setError(null); setNotice(null);
    try {
      const me = await refreshUser();
      if (me?.emailUnverified) setNotice(t("verify.stillPending"));
      else useStore.getState().showToast(t("verify.confirmed"));
    } catch (e) { setError(errText(e)); }
    setBusy(null);
  };
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy("change"); setError(null); setNotice(null);
    try {
      const r = await api<{ applied: boolean; user?: User; pending: { email: string } | null }>("POST", "/account/email", { email: newEmail.trim(), password });
      if (r.applied && r.user) { useStore.setState({ user: { ...user, ...r.user } }); setNotice(t("verify.changeApplied", { email: r.user.email })); }
      else { setPending(r.pending?.email ?? newEmail.trim()); setNotice(t("verify.changePending", { email: r.pending?.email ?? newEmail.trim() })); }
      setChanging(false); setPassword(""); setNewEmail("");
    } catch (err) { setError(errText(err)); }
    setBusy(null);
  };
  return (
    <main className="signin verify-gate">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="verify-gate-icon" aria-hidden="true"><Icon name="mail" size={26} /></span>
          <h1>{t("verify.gateTitle")}</h1>
        </div>
        <p className="verify-gate-text">{before}<b className="verify-gate-email">{user.email}</b>{after}</p>
        {user.emailVerifyDeadline && (
          <p className="signin-notice verify-gate-deadline" role="note">
            <Icon name="clock" size={16} />
            <span>{deadlineText(t, locale, user.emailVerifyDeadline)}</span>
          </p>
        )}
        {pending && <p className="signin-notice is-invite" role="status"><Icon name="mail" size={16} /><span>{t("verify.changePending", { email: pending })}</span></p>}
        {notice && <p className="field-hint" role="status">{notice}</p>}
        {!mail && <p className="signin-notice" role="note"><Icon name="info" size={16} /><span>{t(google ? "verify.gateNoMail" : "verify.gateNoMailNoGoogle")}</span></p>}
        <ErrorNote>{error}</ErrorNote>

        <button type="button" className="btn btn-primary btn-block" disabled={!!busy} onClick={() => void check()}>{busy === "check" ? t("verify.pageChecking") : t("verify.done")}</button>
        {mail && <button type="button" className="btn btn-block" disabled={!!busy} onClick={() => void resend()}>{busy === "resend" ? t("verify.resending") : t("verify.resend")}</button>}
        {mail && <p className="field-hint verify-gate-hint">{t("verify.gateSpam")}</p>}
        {google && <GoogleSignInButton onError={setError} />}
        {google && <p className="field-hint verify-gate-hint">{t("verify.gateGoogleHint")}</p>}

        {changing ? (
          <form className="verify-gate-change" onSubmit={change} noValidate>
            <h2 className="signin-title">{t("verify.changeTitle")}</h2>
            <p className="field-hint">{t("verify.changeHint")}</p>
            <div className="field">
              <label className="field-label" htmlFor={ids.email}>{t("verify.newEmail")}</label>
              <input id={ids.email} className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={ids.password}>{t("verify.password")}</label>
              <input id={ids.password} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="verify-gate-row">
              <button type="button" className="btn btn-ghost" onClick={() => setChanging(false)}>{t("common.cancel")}</button>
              <button type="submit" className="btn btn-primary" disabled={!!busy || !newEmail.includes("@") || !password}>{busy === "change" ? t("verify.changeSending") : t("verify.changeSend")}</button>
            </div>
          </form>
        ) : null}
        <p className="signin-links verify-gate-links">
          {!changing && <button type="button" className="link" onClick={() => { setChanging(true); setNotice(null); setError(null); }}>{t("verify.changeEmail")}</button>}
          <button type="button" className="link" onClick={() => void logout()}>{t("verify.signOut")}</button>
        </p>
      </div>
      <div className="segmented signin-lang" role="radiogroup" aria-label={t("signin.language")}>
        {LOCALES.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? "is-active" : ""} onClick={() => void setLocale(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
    </main>
  );
}

/** The page of the verification link: confirms, then offers to open the app (signed in or not). */
export function VerifyEmailPage({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [state, setState] = useState<"checking" | "ok" | "failed">("checking");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api("POST", "/auth/verify-email", { token, locale }).then(
      () => { setState("ok"); void refreshUser().catch(() => undefined); },
      (e) => { setState("failed"); setError(errText(e)); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <Avatar shape="squircle" color="ember" name="S" size={56} state={state === "ok" ? "happy" : state === "checking" ? "thinking" : "idle"} />
          <h1>Sklubot</h1>
        </div>
        <h2 className="signin-title">{t("verify.pageTitle")}</h2>
        {state === "checking" && <p role="status" className="muted">{t("verify.pageChecking")}</p>}
        {state === "ok" && <p role="status" className="signin-notice is-invite"><Icon name="check" size={16} /><span>{t("verify.pageOk")}</span></p>}
        <ErrorNote>{error}</ErrorNote>
        {state !== "checking" && <button type="button" className="btn btn-primary btn-block" onClick={onDone}>{t("verify.pageOpen")}</button>}
      </div>
    </main>
  );
}
