/**
 * "Connexion ou inscription": one screen for signing in and signing up, e-mail first.
 *  1. start: "Continuer avec Google" first and filled (when the server has it), "ou", the e-mail address, "Continuer".
 *  2. password: the same step for every address — nothing says whether an account uses it (no enumeration): the
 *     password (POST /auth/login), or "Recevoir un lien de connexion par e-mail" (server emaillink.ts: signs an account
 *     in, or creates one for a new address after a last step), "Mot de passe oublié ?", and "Créer un compte avec un
 *     mot de passe" (the password sign-up, POST /auth/signup, as the mobile app and the tests use it).
 *  3. create: name, password, the terms (hosted mode), Turnstile (open servers) — and the setup code for the very first
 *     account of a fresh install, which starts here.
 *  4. sent: the link is on its way.
 * Links keep working: ?auth=login|signup and ?plan= open step 1, ?invite= (a workspace) and ?plan_invite= are noted, a
 * workspace invitation opens step 3 with its address, ?second=1 is the two-factor step, ?link=expired a notice.
 * L44: step 1 also offers « Se connecter avec une clé d'accès » where the browser has passkeys (Passkeys.tsx).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, errText } from "../api";
import { LOCALES, useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import { GoogleSignInButton } from "./GoogleLogin";
import { ForgotPassword } from "./AccountRecovery";
import { SecondStep } from "./TwoFactor";
import { PasskeySignInButton } from "./Passkeys";
import { TurnstileWidget } from "./Turnstile";
import { HostedLinks, HostedSignupFields, type HostedSignup } from "./Hosted";
import { useA } from "./authText";
import "../styles/auth.css";

type Step = "start" | "password" | "create" | "sent";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function AuthBrand() {
  return (
    <div className="signin-brand">
      <Avatar shape="squircle" color="ember" name="S" size={48} />
      <span className="signin-wordmark">Sklubot</span>
    </div>
  );
}

/** `initialMode` / `onBack`: opened from the public landing page (Landing.tsx), which it can go back to. */
export function SignIn({ initialMode, onBack }: { initialMode?: "login" | "signup"; onBack?: () => void } = {}) {
  const signupOpen = useStore((s) => s.signupOpen);
  const setupCodeRequired = useStore((s) => s.setupCodeRequired);
  const signedIn = useStore((s) => s.signedIn);
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const t = useT();
  const a = useA();
  const ids = { name: useId(), email: useId(), password: useId(), newPassword: useId(), setupCode: useId() };
  const [step, setStep] = useState<Step>(setupCodeRequired ? "create" : "start");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState<"login" | "link" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [mail, setMail] = useState(true);
  const [google, setGoogle] = useState(false);
  const [termsMissing, setTermsMissing] = useState(false);
  const termsRef = useRef<HTMLDivElement>(null);
  // Two-factor (TwoFactor.tsx): after the password, or back from Google / a link / a reset (/?second=1).
  const [second, setSecond] = useState<{ token?: string } | null>(() => (new URLSearchParams(location.search).get("second") === "1" ? {} : null));
  // A workspace invitation (/?invite=…) lets its addressee create an account even when sign-ups are closed.
  const [inviteToken] = useState(() => new URLSearchParams(location.search).get("invite") ?? "");
  const [invite, setInvite] = useState<{ workspaceName: string; email: string; role: string } | null>(null);
  useEffect(() => {
    if (!inviteToken) return;
    api<{ invite: { workspaceName: string; email: string; role: string } }>("GET", `/invites/${encodeURIComponent(inviteToken)}`).then((r) => { setInvite(r.invite); setEmail(r.invite.email); setStep("create"); }, () => setInvite(null));
  }, [inviteToken]);
  useEffect(() => { api<{ mail: boolean }>("GET", "/auth/password/status").then((r) => setMail(r.mail), () => setMail(true)); }, []);
  // Hosted mode: an operator's plan invitation (/?plan_invite=…) or a plan from the pricing page (?plan=…), and the terms.
  const hostedOn = useStore((s) => !!s.hosted);
  const [planInvite] = useState(() => new URLSearchParams(location.search).get("plan_invite") ?? "");
  const [hostedForm, setHostedForm] = useState<HostedSignup>(() => ({ acceptTerms: false, planInvite: planInvite || undefined }));
  // The very first account (the owner) needs no plan and no terms: the owner writes them.
  const hostedSignup = hostedOn && !setupCodeRequired;
  const canCreate = signupOpen || !!invite || !!planInvite;
  const turnstileKey = useStore((s) => s.publicSignup.turnstileSiteKey);
  // Open servers: links and open sign-ups need the anti-robot check (not the first account, not a workspace invitation).
  const needsTurnstile = !!turnstileKey && !setupCodeRequired && (step === "password" || (step === "create" && !invite && !planInvite));
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileRound, setTurnstileRound] = useState(0);
  const [linkExpired] = useState(() => new URLSearchParams(location.search).get("link") === "expired");
  useEffect(() => {
    if (!linkExpired) return;
    const url = new URL(location.href);
    url.searchParams.delete("link");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [linkExpired]);
  // ?auth=signup from the landing page lands on the same first step: one screen for both.
  void initialMode;

  const go = (next: Step) => { setError(null); setTermsMissing(false); setStep(next); };
  const done = async (r: { user: User; twoFactor?: { token: string } }) => {
    if (r.twoFactor) { setSecond({ token: r.twoFactor.token }); setBusy(null); return; }
    if (invite || planInvite) history.replaceState(history.state, "", location.pathname);
    await signedIn(r.user);
  };
  const fail = (err: unknown) => {
    if (needsTurnstile) setTurnstileRound((n) => n + 1);
    setError(step === "create" && setupCodeRequired && err instanceof ApiError && err.status === 403 && /setup code/i.test(err.message) ? t("signin.errSetupCodeWrong") : errText(err));
    setBusy(null);
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setError(a("errEmail")); return; }
    go("password");
  };
  const login = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) { setError(a("errPassword")); return; }
    setBusy("login"); setError(null);
    try { await done(await api<{ user: User; twoFactor?: { token: string } }>("POST", "/auth/login", { email: email.trim(), password })); }
    catch (err) { fail(err); }
  };
  const sendLink = async () => {
    if (busy) return;
    if (needsTurnstile && !turnstileToken) { setError(t("signin.errTurnstile")); return; }
    setBusy("link"); setError(null);
    try {
      await api("POST", "/auth/email-link", { email: email.trim(), locale, ...(hostedSignup ? { plan: hostedForm.plan, planInvite: hostedForm.planInvite } : {}), ...(needsTurnstile ? { turnstileToken } : {}) });
      if (needsTurnstile) setTurnstileRound((n) => n + 1);
      setBusy(null);
      go("sent");
    } catch (err) { fail(err); }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!EMAIL_RE.test(email.trim())) { setError(a("errEmail")); return; }
    if (password.length < 8) { setError(t("signin.errShort")); return; }
    if (setupCodeRequired && !setupCode.trim()) { setError(t("signin.errSetupCode")); return; }
    if (hostedSignup && !hostedForm.acceptTerms) { setTermsMissing(true); setError(a("termsNeeded")); termsRef.current?.querySelector("input")?.focus(); return; }
    if (needsTurnstile && !turnstileToken) { setError(t("signin.errTurnstile")); return; }
    setBusy("create"); setError(null);
    try {
      await done(await api<{ user: User; twoFactor?: { token: string } }>("POST", "/auth/signup", {
        email: email.trim(), name: name.trim() || undefined, password, locale, invite: invite ? inviteToken : undefined,
        setupCode: setupCodeRequired ? setupCode.trim() : undefined, ...(hostedSignup ? hostedForm : {}), ...(needsTurnstile ? { turnstileToken } : {}),
      }));
    } catch (err) { fail(err); }
  };

  const shell = (body: ReactNode) => (
    <main className="signin auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="signin-card auth-card">{body}</div>
      <p className="signin-links">
        {onBack && <a href="/" onClick={(e) => { e.preventDefault(); onBack(); }}>{t("signin.backHome")}</a>}
        <a href="/telecharger">{t("signin.download")}</a>
      </p>
      <HostedLinks />
      {!hostedOn && <p className="signin-foot">{t("signin.foot")}</p>}
      <div className="segmented signin-lang" role="radiogroup" aria-label={t("signin.language")}>
        {LOCALES.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? "is-active" : ""} onClick={() => void setLocale(l.id)}>{l.label}</button>
        ))}
      </div>
    </main>
  );

  if (second) {
    return shell(<><AuthBrand /><SecondStep token={second.token} onDone={(u) => { history.replaceState(history.state, "", location.pathname); void signedIn(u); }}
      onCancel={() => { history.replaceState(history.state, "", location.pathname); setSecond(null); setPassword(""); }} /></>);
  }
  if (forgot) return shell(<><AuthBrand /><ForgotPassword initialEmail={email} onBack={() => { setForgot(false); setError(null); }} /></>);

  const notices = (
    <>
      {invite && <p className="signin-notice is-invite" role="status"><Icon name="users" size={16} /><span>{t("ws.invitedTo", { ws: invite.workspaceName, role: t(`ws.role.${invite.role as "member"}`) })}</span></p>}
      {linkExpired && <p className="signin-notice" role="status"><Icon name="info" size={16} /><span>{t("signin.linkExpired")}</span></p>}
    </>
  );
  const emailChip = (
    <div className="auth-email">
      <Icon name="mail" size={15} />
      <span className="auth-email-text">{email.trim()}</span>
      <button type="button" className="link" onClick={() => { setPassword(""); go("start"); }}>{a("changeEmail")}</button>
    </div>
  );
  const turnstile = needsTurnstile && turnstileKey ? <TurnstileWidget siteKey={turnstileKey} onToken={setTurnstileToken} resetKey={turnstileRound} /> : null;

  if (step === "start") {
    return shell(
      <form className="auth-form" onSubmit={submitEmail} noValidate>
        <AuthBrand />
        <div className="auth-head">
          <h1 className="auth-title">{a("title")}</h1>
          <p className="auth-lead">{a("lead")}</p>
        </div>
        {notices}
        <GoogleSignInButton primary divider="after" invite={invite ? inviteToken : undefined} onError={setError} onEnabled={setGoogle}
          hosted={hostedSignup ? { plan: hostedForm.plan, planInvite: hostedForm.planInvite, acceptTerms: false } : undefined} />
        {hostedSignup && <div hidden><HostedSignupFields value={hostedForm} onChange={setHostedForm} /></div>}
        <div className="field">
          <label className="field-label" htmlFor={ids.email}>{a("email")}</label>
          <input id={ids.email} className="input auth-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus={!google} placeholder={t("signin.emailPlaceholder")} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button type="submit" className={`btn btn-block auth-btn ${google ? "" : "btn-primary"}`}>{a("continue")}</button>
        <PasskeySignInButton onDone={(u) => done({ user: u })} onError={setError} />{/* L44: a passkey saved on this device (Passkeys.tsx) */}
        {!canCreate && <p className="signin-switch">{t("signin.closed")}</p>}
      </form>,
    );
  }

  if (step === "password") {
    return shell(
      <form className="auth-form" onSubmit={login} noValidate>
        <AuthBrand />
        <div className="auth-head">
          <h1 className="auth-title">{a("passwordTitle")}</h1>
          <p className="auth-lead">{a("passwordLead")}</p>
        </div>
        {emailChip}
        {notices}
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <div className="field">
          <label className="field-label" htmlFor={ids.password}>{t("signin.password")}</label>
          <input id={ids.password} className="input auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </div>
        <button type="button" className="link signin-forgot" onClick={() => { setForgot(true); setError(null); }}>{t("recovery.forgotLink")}</button>
        <ErrorNote>{error}</ErrorNote>
        <button type="submit" className="btn btn-primary btn-block auth-btn" disabled={busy !== null}>{busy === "login" ? a("signingIn") : a("signIn")}</button>
        {mail ? (
          <>
            <div className="google-or" aria-hidden="true"><span>{a("or")}</span></div>
            {turnstile}
            <button type="button" className="btn btn-block auth-btn" onClick={() => void sendLink()} disabled={busy !== null}><Icon name="mail" size={15} /> {busy === "link" ? a("sendingLink") : a("sendLink")}</button>
          </>
        ) : <p className="muted small">{a("mailOff")}</p>}
        {canCreate && (
          <p className="signin-switch">{a("newHere")} <button type="button" className="link" onClick={() => { setPassword(""); go("create"); }}>{a("createWithPassword")}</button></p>
        )}
      </form>,
    );
  }

  if (step === "sent") {
    return shell(
      <div className="auth-form" role="status" aria-live="polite">
        <AuthBrand />
        <div className="auth-sent-icon" aria-hidden="true"><Icon name="mail" size={26} /></div>
        <div className="auth-head">
          <h1 className="auth-title">{a("sentTitle")}</h1>
          <p className="auth-lead">{a("sentText", { email: email.trim() })}</p>
        </div>
        <p className="muted small auth-center">{a("sentHint")}</p>
        {turnstile}
        <ErrorNote>{error}</ErrorNote>
        <button type="button" className="btn btn-block auth-btn" onClick={() => void sendLink()} disabled={busy !== null}>{busy === "link" ? a("sendingLink") : a("resend")}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => go("password")}>{a("back")}</button>
      </div>,
    );
  }

  // create
  return shell(
    <form className="auth-form" onSubmit={create} noValidate>
      <AuthBrand />
      <div className="auth-head">
        <h1 className="auth-title">{a("createTitle")}</h1>
        <p className="auth-lead">{a("createLead")}</p>
      </div>
      {notices}
      {setupCodeRequired && (
        <div className="field">
          <label className="field-label" htmlFor={ids.setupCode}>{t("signin.setupCode")}</label>
          <input id={ids.setupCode} className="input" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="one-time-code" spellCheck={false} maxLength={64} />
          <p className="field-hint">{t("signin.setupCodeHint")}</p>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={ids.name}>{a("name")}</label>
        <input id={ids.name} className="input auth-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={80} placeholder={a("namePh")} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={ids.email}>{a("email")}</label>
        <input id={ids.email} className="input auth-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder={t("signin.emailPlaceholder")} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={ids.newPassword}>{a("newPassword")}</label>
        <input id={ids.newPassword} className="input auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <p className="field-hint">{t("signin.passwordHint")}</p>
      </div>
      {hostedSignup && <div ref={termsRef}><HostedSignupFields value={hostedForm} onChange={(v) => { setHostedForm(v); if (v.acceptTerms) setTermsMissing(false); }} missing={termsMissing} /></div>}
      {turnstile}
      <ErrorNote>{error}</ErrorNote>
      <button type="submit" className="btn btn-primary btn-block auth-btn" disabled={busy !== null}>{busy === "create" ? a("creating") : a("create")}</button>
      {setupCodeRequired && <GoogleSignInButton setupCode={setupCode} setupCodeRequired onError={setError} />}
      {!setupCodeRequired && <p className="signin-switch">{a("haveAccount")} <button type="button" className="link" onClick={() => { setPassword(""); go(EMAIL_RE.test(email.trim()) ? "password" : "start"); }}>{a("signInInstead")}</button></p>}
    </form>,
  );
}
