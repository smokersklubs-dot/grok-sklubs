import { useEffect, useId, useState, type FormEvent } from "react";
import { api, ApiError, errText } from "../api";
import { LOCALES, useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import { GoogleSignInButton } from "./GoogleLogin";
import { ForgotPassword } from "./AccountRecovery";

export function SignIn() {
  const signupOpen = useStore((s) => s.signupOpen);
  const setupCodeRequired = useStore((s) => s.setupCodeRequired);
  const firstBot = useStore((s) => s.firstBot);
  const signedIn = useStore((s) => s.signedIn);
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">(signupOpen ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  // The first bot's name and role (B-9): the server's defaults are shown as placeholders; empty keeps them.
  const [botName, setBotName] = useState("");
  const [botLabel, setBotLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Mot de passe oublié ?": the card shows the e-mail form instead (AccountRecovery.tsx).
  const [forgot, setForgot] = useState(false);
  const ids = { name: useId(), email: useId(), password: useId(), setupCode: useId(), botName: useId(), botLabel: useId() };
  // Wave 6: a workspace invitation link (/?invite=…) lets its addressee create an account even when sign-ups are closed.
  const [inviteToken] = useState(() => new URLSearchParams(location.search).get("invite") ?? "");
  const [invite, setInvite] = useState<{ workspaceName: string; email: string; role: string } | null>(null);
  useEffect(() => {
    if (!inviteToken) return;
    api<{ invite: { workspaceName: string; email: string; role: string } }>("GET", `/invites/${encodeURIComponent(inviteToken)}`).then((r) => { setInvite(r.invite); setEmail(r.invite.email); setMode("signup"); }, () => setInvite(null));
  }, [inviteToken]);
  const creating = mode === "signup" && (signupOpen || !!invite);
  // A one-time sign-in link that has expired or was already used lands here with ?link=expired.
  const [linkExpired] = useState(() => new URLSearchParams(location.search).get("link") === "expired");
  useEffect(() => {
    if (!linkExpired) return;
    const url = new URL(location.href);
    url.searchParams.delete("link");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [linkExpired]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    if (!mail.includes("@")) {
      setError(t("signin.errEmail"));
      return;
    }
    if (!password) {
      setError(t("signin.errPassword"));
      return;
    }
    if (creating && password.length < 8) {
      setError(t("signin.errShort"));
      return;
    }
    if (creating && setupCodeRequired && !setupCode.trim()) {
      setError(t("signin.errSetupCode"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = creating
        ? await api<{ user: User }>("POST", "/auth/signup", { email: mail, name: name.trim() || undefined, password, locale, invite: invite ? inviteToken : undefined, setupCode: setupCodeRequired ? setupCode.trim() : undefined, botName: botName.trim() || undefined, botLabel: botLabel.trim() || undefined })
        : await api<{ user: User }>("POST", "/auth/login", { email: mail, password });
      // A sign-up with the invitation already joined the workspace: the link is used up.
      if (creating && invite) history.replaceState(history.state, "", location.pathname);
      await signedIn(r.user);
    } catch (err) {
      setError(creating && setupCodeRequired && err instanceof ApiError && err.status === 403 && /setup code/i.test(err.message) ? t("signin.errSetupCodeWrong") : errText(err));
      setBusy(false);
    }
  };

  if (forgot) {
    return (
      <main className="signin">
        <div className="signin-card">
          <div className="signin-brand">
            <Avatar shape="squircle" color="ember" name="S" size={56} />
            <h1>Sklubot</h1>
            <p>{t("signin.tagline")}</p>
          </div>
          <ForgotPassword initialEmail={email} onBack={() => { setForgot(false); setError(null); }} />
        </div>
      </main>
    );
  }

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit} noValidate>
        <div className="signin-brand">
          <Avatar shape="squircle" color="ember" name="S" size={56} />
          <h1>Sklubot</h1>
          <p>{t("signin.tagline")}</p>
        </div>

        <h2 className="signin-title">{t(creating ? "signin.create" : "signin.signIn")}</h2>

        {invite && (
          <p className="signin-notice is-invite" role="status">
            <Icon name="users" size={16} />
            <span>{t("ws.invitedTo", { ws: invite.workspaceName, role: t(`ws.role.${invite.role as "member"}`) })}</span>
          </p>
        )}
        {linkExpired && (
          <p className="signin-notice" role="status">
            <Icon name="info" size={16} />
            <span>{t("signin.linkExpired")}</span>
          </p>
        )}

        {creating && (
          <div className="field">
            <label className="field-label" htmlFor={ids.name}>{t("common.name")}</label>
            <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} placeholder={t("signin.namePlaceholder")} />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={ids.email}>{t("signin.email")}</label>
          <input id={ids.email} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder={t("signin.emailPlaceholder")} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.password}>{t("signin.password")}</label>
          <input
            id={ids.password}
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={creating ? "new-password" : "current-password"}
          />
          {creating && <p className="field-hint">{t("signin.passwordHint")}</p>}
        </div>
        {!creating && (
          <button type="button" className="link signin-forgot" onClick={() => { setForgot(true); setError(null); }}>{t("recovery.forgotLink")}</button>
        )}
        {creating && setupCodeRequired && (
          <div className="field">
            <label className="field-label" htmlFor={ids.setupCode}>{t("signin.setupCode")}</label>
            <input id={ids.setupCode} className="input" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="one-time-code" spellCheck={false} maxLength={64} />
            <p className="field-hint">{t("signin.setupCodeHint")}</p>
          </div>
        )}

        {creating && (
          <fieldset className="signin-firstbot">
            <legend>{t("signin.firstBot")}</legend>
            <p className="field-hint">{t("signin.firstBotHint")}</p>
            <div className="signin-firstbot-row">
              <Avatar shape="pebble" color="indigo" name={(botName.trim() || firstBot.name).slice(0, 1)} size={40} />
              <div className="field">
                <label className="field-label" htmlFor={ids.botName}>{t("signin.firstBotName")}</label>
                <input id={ids.botName} className="input" value={botName} onChange={(e) => setBotName(e.target.value)} maxLength={60} placeholder={firstBot.name} autoComplete="off" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={ids.botLabel}>{t("signin.firstBotLabel")}</label>
                <input id={ids.botLabel} className="input" value={botLabel} onChange={(e) => setBotLabel(e.target.value)} maxLength={60} placeholder={firstBot.label || t("signin.firstBotLabelDefault")} autoComplete="off" />
              </div>
            </div>
          </fieldset>
        )}

        <ErrorNote>{error}</ErrorNote>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {t(busy ? (creating ? "signin.creating" : "signin.signingIn") : creating ? "signin.createBtn" : "signin.signIn")}
        </button>
        <GoogleSignInButton invite={invite ? inviteToken : undefined} setupCode={setupCode} setupCodeRequired={creating && setupCodeRequired} onError={setError} />

        {signupOpen && (
          <p className="signin-switch">
            {t(creating ? "signin.haveAccount" : "signin.newHere")}{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(creating ? "login" : "signup");
                setError(null);
              }}
            >
              {t(creating ? "signin.signIn" : "signin.createLink")}
            </button>
          </p>
        )}
        {!signupOpen && <p className="signin-switch">{t("signin.closed")}</p>}
      </form>
      <p className="signin-foot">{t("signin.foot")}</p>
      <p className="signin-links"><a href="/telecharger">{t("signin.download")}</a></p>
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
