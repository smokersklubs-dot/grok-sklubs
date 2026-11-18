/**
 * "Continuer avec Google": the button on the sign-in page (and invitation links), the owner's settings with the
 * Google Cloud Console guide, and the account's own Google link. Server side: server/src/googlelogin.ts.
 * Texts live here (French and English) so this feature stays in its own files.
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, errText } from "../api";
import { useStore } from "../store";
import { CopyButton, ErrorNote } from "./ui";
import "./GoogleLogin.css";

const TEXT = {
  fr: {
    or: "ou",
    continue: "Continuer avec Google",
    opening: "Ouverture de Google…",
    needSetupCode: "Entre d'abord le code d'installation ci-dessus.",
    settingsTitle: "Connexion avec Google",
    settingsIntro: "Permet à chacun de se connecter à ce Sklubot avec son compte Google (bouton «\u00a0Continuer avec Google\u00a0»). Les mêmes règles d'inscription s'appliquent\u00a0: un nouveau compte n'est créé que si les inscriptions sont ouvertes ou avec une invitation.",
    statusOn: "Activée\u00a0: le bouton apparaît sur la page de connexion.",
    statusOff: "Pas encore configurée : l'inscription et la connexion avec Google sont désactivées, les visiteurs ne voient pas le bouton « Continuer avec Google » (ils passent par l'e-mail).",
    fromEnv: "Les clés viennent de l'environnement du serveur (GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET). Pour les changer, modifie le fichier .env du serveur.",
    guideTitle: "Comment obtenir les clés (5 minutes)",
    step1: "Ouvre Google Cloud Console (console.cloud.google.com) et crée un projet, par exemple «\u00a0Sklubot\u00a0».",
    step2: "Menu «\u00a0Google Auth Platform\u00a0» (ou «\u00a0API et services → Écran de consentement OAuth\u00a0»)\u00a0: choisis le type «\u00a0Externe\u00a0», donne un nom à l'application (par exemple Sklubot) et ton adresse e-mail d'assistance, puis enregistre. Dans «\u00a0Audience\u00a0», publie l'application («\u00a0En production\u00a0») pour que d'autres personnes que toi puissent se connecter.",
    step3: "«\u00a0Clients\u00a0» (ou «\u00a0Identifiants → Créer des identifiants → ID client OAuth\u00a0»)\u00a0: type d'application «\u00a0Application Web\u00a0».",
    step4: "Dans «\u00a0URI de redirection autorisés\u00a0», ajoute exactement cette adresse\u00a0:",
    step5: "Crée le client, puis copie ici l'ID client et le code secret du client, et enregistre.",
    scopesNote: "Sklubot ne demande que openid, email et profile\u00a0: pas besoin de validation par Google.",
    originWarn: "Attention\u00a0: cette page est ouverte sur {here}, mais le serveur pense être à {pub} (PUBLIC_URL). Google renverra vers {pub}\u00a0: vérifie PUBLIC_URL dans le fichier .env.",
    clientId: "ID client",
    clientSecret: "Code secret du client",
    secretKept: "Enregistré (laisse vide pour le garder)",
    secretHint: "Il est chiffré sur le serveur et n'est jamais renvoyé au navigateur.",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré.",
    remove: "Désactiver",
    googleAccount: "Compte Google",
    linkedTo: "Lié au compte Google {email}.",
    notLinked: "Tu peux aussi te connecter avec ton compte Google.",
    link: "Lier mon compte Google",
    unlink: "Délier",
    unlinkNeedsPassword: "Choisis d'abord un mot de passe pour pouvoir délier Google.",
    setPasswordIntro: "Ton compte a été créé avec Google et n'a pas encore de mot de passe. Tu peux en choisir un pour te connecter aussi avec ton e-mail.",
    newPassword: "Nouveau mot de passe",
    confirmPassword: "Confirme le mot de passe",
    passwordRule: "Au moins 8 caractères.",
    mismatch: "Les deux mots de passe ne sont pas identiques.",
    setPassword: "Choisir ce mot de passe",
    passwordSet: "Mot de passe enregistré.",
  },
  en: {
    or: "or",
    continue: "Continue with Google",
    opening: "Opening Google…",
    needSetupCode: "Enter the setup code above first.",
    settingsTitle: "Sign in with Google",
    settingsIntro: "Lets people sign in to this Sklubot with their Google account (the “Continue with Google” button). The same sign-up rules apply: a new account is only created when sign-ups are open or with an invitation.",
    statusOn: "On: the button shows on the sign-in page.",
    statusOff: "Not set up yet: signing up and in with Google is off, visitors do not see the “Continue with Google” button (they use their e-mail).",
    fromEnv: "The keys come from the server's environment (GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET). To change them, edit the server's .env file.",
    guideTitle: "How to get the keys (5 minutes)",
    step1: "Open Google Cloud Console (console.cloud.google.com) and create a project, for example “Sklubot”.",
    step2: "“Google Auth Platform” (or “APIs & Services → OAuth consent screen”): choose “External”, give the app a name (for example Sklubot) and your support email, then save. Under “Audience”, publish the app (“In production”) so people other than you can sign in.",
    step3: "“Clients” (or “Credentials → Create credentials → OAuth client ID”): application type “Web application”.",
    step4: "Under “Authorized redirect URIs”, add exactly this address:",
    step5: "Create the client, then copy the client ID and client secret here and save.",
    scopesNote: "Sklubot only asks for openid, email and profile: no verification by Google is needed.",
    originWarn: "Careful: this page is open on {here}, but the server thinks it is at {pub} (PUBLIC_URL). Google will send people back to {pub}: check PUBLIC_URL in the .env file.",
    clientId: "Client ID",
    clientSecret: "Client secret",
    secretKept: "Saved (leave empty to keep it)",
    secretHint: "It is encrypted on the server and never sent back to the browser.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    remove: "Turn off",
    googleAccount: "Google account",
    linkedTo: "Linked to the Google account {email}.",
    notLinked: "You can also sign in with your Google account.",
    link: "Link my Google account",
    unlink: "Unlink",
    unlinkNeedsPassword: "Choose a password first to be able to unlink Google.",
    setPasswordIntro: "Your account was created with Google and has no password yet. You can choose one to also sign in with your email.",
    newPassword: "New password",
    confirmPassword: "Confirm the password",
    passwordRule: "At least 8 characters.",
    mismatch: "The two passwords are not the same.",
    setPassword: "Use this password",
    passwordSet: "Password saved.",
  },
};
type Key = keyof typeof TEXT.fr;
function useG() {
  const locale = useStore((s) => s.locale);
  const dict = locale === "fr" ? TEXT.fr : TEXT.en;
  return (k: Key, vars: Record<string, string> = {}) => dict[k].replace(/\{(\w+)\}/g, (_m, v: string) => vars[v] ?? "");
}

/** Google's "G" mark, as Google's sign-in branding guidelines ask for on the button. */
function GoogleMark() {
  return (
    <svg className="google-mark" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The sign-in page's "Continuer avec Google" (also for invitation links). Hidden while the server has no Google keys. */
export function GoogleSignInButton({ invite, setupCode, setupCodeRequired, onError, hosted, check, primary = false, divider = "before", onEnabled }: { invite?: string; setupCode?: string; setupCodeRequired?: boolean; onError: (message: string | null) => void; /** Hosted mode: the plan, the plan invitation and the terms ticked on the form. */ hosted?: { plan?: string; planInvite?: string; acceptTerms: boolean }; /** An error to show instead of starting (e.g. the terms not ticked). */ check?: () => string | null; /** The main way in (filled), on the "Connexion ou inscription" screen. */ primary?: boolean; /** Where the "ou" line goes. */ divider?: "before" | "after" | "none"; /** Told whether Google sign-in is configured here. */ onEnabled?: (on: boolean) => void }) {
  const g = useG();
  const locale = useStore((s) => s.locale);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>("GET", "/auth/google/status").then((r) => { setEnabled(r.enabled); onEnabled?.(r.enabled); }, () => { setEnabled(false); onEnabled?.(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!enabled) return null;
  const go = async () => {
    if (busy) return;
    if (setupCodeRequired && !setupCode?.trim()) { onError(g("needSetupCode")); return; }
    const problem = check?.();
    if (problem) { onError(problem); return; }
    setBusy(true);
    onError(null);
    try {
      const r = await api<{ url: string }>("POST", "/auth/google/start", { invite: invite || undefined, setupCode: setupCodeRequired ? setupCode?.trim() : undefined, locale, ...(hosted ?? {}) });
      location.assign(r.url);
    } catch (err) {
      onError(errText(err));
      setBusy(false);
    }
  };
  const or = <div className="google-or" aria-hidden="true"><span>{g("or")}</span></div>;
  return (
    <>
      {divider === "before" && or}
      <button type="button" className={`btn btn-block google-btn ${primary ? "is-primary" : ""}`} onClick={() => void go()} disabled={busy}>
        <span className="google-mark-wrap"><GoogleMark /></span>
        <span>{g(busy ? "opening" : "continue")}</span>
      </button>
      {divider === "after" && or}
    </>
  );
}

interface GoogleSettingsView { configured: boolean; source: "env" | "saved" | null; clientId: string; hasSecret: boolean; redirectUri: string; publicUrl: string }

/** Settings → Account, for the server's owner only (the server answers 403 to anyone else, and nothing shows). */
export function GoogleLoginSettings() {
  const g = useG();
  const uid = useId();
  const [view, setView] = useState<GoogleSettingsView | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<GoogleSettingsView>("GET", "/settings/google-login").then((v) => { setView(v); setClientId(v.clientId); }, () => setView(null));
  }, []);
  if (!view) return null;
  const fromEnv = view.source === "env";
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setDone(false);
    try {
      const v = await api<GoogleSettingsView>("PUT", "/settings/google-login", { clientId: clientId.trim(), clientSecret: secret.trim() || undefined });
      setView(v); setSecret(""); setDone(true);
    } catch (err) { setError(errText(err)); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true); setError(null); setDone(false);
    try { const v = await api<GoogleSettingsView>("DELETE", "/settings/google-login"); setView(v); setClientId(""); setSecret(""); } catch (err) { setError(errText(err)); }
    setBusy(false);
  };
  const otherOrigin = location.origin !== view.publicUrl;
  return (
    <>
      <h3 className="pane-heading">{g("settingsTitle")}</h3>
      <div className="google-settings">
        <p className="muted small">{g("settingsIntro")}</p>
        <p className={`google-status ${view.configured ? "is-on" : ""}`} role="status">
          <span className="google-dot" aria-hidden="true" /> {g(view.configured ? "statusOn" : "statusOff")}
        </p>
        {fromEnv && <p className="muted small">{g("fromEnv")}</p>}

        <details className="google-guide" open={!view.configured}>
          <summary>{g("guideTitle")}</summary>
          <ol>
            <li>{g("step1")}</li>
            <li>{g("step2")}</li>
            <li>{g("step3")}</li>
            <li>
              {g("step4")}
              <div className="google-uri">
                <code>{view.redirectUri}</code>
                <CopyButton text={view.redirectUri} />
              </div>
              {otherOrigin && <p className="google-warn">{g("originWarn", { here: location.origin, pub: view.publicUrl })}</p>}
            </li>
            <li>{g("step5")}</li>
          </ol>
          <p className="muted small">{g("scopesNote")}</p>
        </details>

        {!fromEnv && (
          <form className="google-form" onSubmit={save}>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}id`}>{g("clientId")}</label>
              <input id={`${uid}id`} className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setDone(false); }} spellCheck={false} autoComplete="off" placeholder="1234567890-abc.apps.googleusercontent.com" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}s`}>{g("clientSecret")}</label>
              <input id={`${uid}s`} className="input" type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setDone(false); }} spellCheck={false} autoComplete="off" placeholder={view.hasSecret ? g("secretKept") : "GOCSPX-…"} />
              <p className="field-hint">{g("secretHint")}</p>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="google-actions">
              {done && <span className="muted small" role="status">{g("saved")}</span>}
              {view.configured && <button type="button" className="btn btn-small" onClick={() => void remove()} disabled={busy}>{g("remove")}</button>}
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !clientId.trim() || (!view.hasSecret && !secret.trim())}>{g(busy ? "saving" : "save")}</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

interface AccountGoogle { enabled: boolean; linked: boolean; email: string | null; hasPassword: boolean }

/**
 * Settings → Account: an account created with Google has no password yet, so it chooses one here instead of the usual
 * change form (`children`); then the account's Google link (link / unlink).
 */
export function GoogleAccountBlock({ children }: { children: ReactNode }) {
  const g = useG();
  const uid = useId();
  const [info, setInfo] = useState<AccountGoogle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const load = () => api<AccountGoogle>("GET", "/account/google").then(setInfo, () => setInfo(null));
  useEffect(() => { void load(); }, []);
  if (!info) return <>{children}</>;

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;
  const setPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api("POST", "/account/google/password", { next }); setDone(true); setNext(""); setConfirm(""); await load(); } catch (err) { setError(errText(err)); }
    setBusy(false);
  };
  const link = async () => {
    setBusy(true); setError(null);
    try { const r = await api<{ url: string }>("POST", "/account/google/link"); location.assign(r.url); } catch (err) { setError(errText(err)); setBusy(false); }
  };
  const unlink = async () => {
    setBusy(true); setError(null);
    try { await api("DELETE", "/account/google"); await load(); } catch (err) { setError(err instanceof ApiError ? err.message : errText(err)); }
    setBusy(false);
  };

  return (
    <>
      {info.hasPassword ? children : (
        <form className="google-form" onSubmit={setPassword}>
          <p className="muted small">{g("setPasswordIntro")}</p>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}n`}>{g("newPassword")}</label>
            <input id={`${uid}n`} className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={tooShort || undefined} />
            <p className={`field-hint ${tooShort ? "is-error" : ""}`}>{g("passwordRule")}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}c`}>{g("confirmPassword")}</label>
            <input id={`${uid}c`} className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch || undefined} />
            {mismatch && <p className="field-hint is-error">{g("mismatch")}</p>}
          </div>
          <div className="google-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || next.length < 8 || next !== confirm}>{g("setPassword")}</button>
          </div>
        </form>
      )}
      {done && <p className="muted small" role="status">{g("passwordSet")}</p>}

      {(info.enabled || info.linked) && (
        <>
          <h3 className="pane-heading">{g("googleAccount")}</h3>
          <div className="action-row">
            <div className="google-account-text">
              <GoogleMark />
              <div>
                <p className="action-title">{info.linked ? g("linkedTo", { email: info.email ?? "" }) : g("notLinked")}</p>
                {info.linked && !info.hasPassword && <p className="muted small">{g("unlinkNeedsPassword")}</p>}
              </div>
            </div>
            {info.linked
              ? <button type="button" className="btn btn-small" onClick={() => void unlink()} disabled={busy || !info.hasPassword}>{g("unlink")}</button>
              : <button type="button" className="btn btn-small" onClick={() => void link()} disabled={busy || !info.enabled}>{g("link")}</button>}
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}
