/**
 * The steps reached from a link of the "Connexion ou inscription" screen:
 *  - /?email_link=… (server emaillink.ts): signs the account in, or — for a new address — asks for a first name and the
 *    terms (hosted mode), then creates the account. With two-factor on, the code step follows (/?second=1).
 *  - /?google_signup=… (server googlelogin.ts, hosted mode): back from Google for a new account whose terms were not
 *    ticked yet — the name from Google, prefilled, and the terms; nothing exists before this step is sent.
 * Both tokens are read once and removed from the address.
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { User } from "../types";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import { HostedSignupFields, type HostedSignup } from "./Hosted";
import { AuthBrand } from "./SignIn";
import { useA } from "./authText";

function take(param: string): string | null {
  const url = new URL(location.href);
  const token = url.searchParams.get(param);
  if (!token) return null;
  url.searchParams.delete(param);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return token;
}
export const takeEmailLink = () => take("email_link");
export const takeGoogleSignup = () => take("google_signup");

type Answer = { user?: User; twoFactor?: { token: string }; profile?: { email: string; terms: boolean } };

/** One page, centred like the sign-in screen. */
function Page({ children }: { children: ReactNode }) {
  return (
    <main className="signin auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="signin-card auth-card"><div className="auth-form">{children}</div></div>
    </main>
  );
}

function Finish({ email, terms, google, name: initialName, onSubmit }: { email: string; terms: boolean; google?: boolean; name?: string; onSubmit: (f: { name: string; acceptTerms: boolean }) => Promise<void> }) {
  const a = useA();
  const id = useId();
  const [name, setName] = useState(initialName ?? "");
  const [form, setForm] = useState<HostedSignup>({ acceptTerms: false });
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (terms && !form.acceptTerms) { setMissing(true); setError(a("termsNeeded")); return; }
    setBusy(true); setError(null);
    try { await onSubmit({ name: name.trim(), acceptTerms: form.acceptTerms }); } catch (err) { setError(errText(err)); setBusy(false); }
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <AuthBrand />
      <div className="auth-head">
        <h1 className="auth-title">{a("finishTitle")}</h1>
        <p className="auth-lead">{a(google ? "finishGoogleLead" : "finishLead", { email })}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={id}>{a("name")}</label>
        <input id={id} className="input auth-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={80} placeholder={a("namePh")} autoFocus />
      </div>
      {terms && <HostedSignupFields value={form} onChange={(v) => { setForm(v); if (v.acceptTerms) setMissing(false); }} missing={missing} />}
      <ErrorNote>{error}</ErrorNote>
      <button type="submit" className="btn btn-primary btn-block auth-btn" disabled={busy}>{busy ? a("creating") : a("create")}</button>
    </form>
  );
}

function Expired({ text }: { text: string }) {
  const a = useA();
  return (
    <>
      <AuthBrand />
      <p className="signin-notice" role="alert"><Icon name="info" size={16} /><span>{text}</span></p>
      <a className="btn btn-primary btn-block auth-btn" href="/?auth=login">{a("newLink")}</a>
    </>
  );
}

const enter = async (r: Answer) => {
  // Two-factor on: the server set the pending step's cookie; the sign-in screen asks for the code.
  if (r.twoFactor) { location.assign("/?second=1"); return; }
  if (r.user) await useStore.getState().signedIn(r.user);
};

export function EmailLinkPage({ token, onDone }: { token: string; onDone: () => void }) {
  const a = useA();
  const locale = useStore((s) => s.locale);
  const [state, setState] = useState<{ kind: "opening" } | { kind: "profile"; email: string; terms: boolean } | { kind: "error"; text: string }>({ kind: "opening" });
  useEffect(() => {
    api<Answer>("POST", "/auth/email-link/use", { token, locale }).then(async (r) => {
      if (r.profile) setState({ kind: "profile", email: r.profile.email, terms: r.profile.terms });
      else { await enter(r); onDone(); }
    }, (err) => setState({ kind: "error", text: errText(err) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (state.kind === "opening") return <Page><AuthBrand /><p className="muted auth-center" role="status">{a("linkOpening")}</p></Page>;
  if (state.kind === "error") return <Page><Expired text={state.text || a("linkExpired")} /></Page>;
  return (
    <Page>
      <Finish email={state.email} terms={state.terms} onSubmit={async (f) => {
        const r = await api<Answer>("POST", "/auth/email-link/use", { token, locale, profile: true, ...f });
        await enter(r); onDone();
      }} />
    </Page>
  );
}

export function GoogleSignupPage({ token, onDone }: { token: string; onDone: () => void }) {
  const a = useA();
  const locale = useStore((s) => s.locale);
  const [state, setState] = useState<{ kind: "opening" } | { kind: "form"; email: string; name: string } | { kind: "error"; text: string }>({ kind: "opening" });
  useEffect(() => {
    api<{ email: string; name: string }>("POST", "/auth/google/pending", { token, locale }).then((r) => setState({ kind: "form", ...r }), (err) => setState({ kind: "error", text: errText(err) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (state.kind === "opening") return <Page><AuthBrand /><p className="muted auth-center" role="status">{a("linkOpening")}</p></Page>;
  if (state.kind === "error") return <Page><Expired text={state.text} /></Page>;
  return (
    <Page>
      <Finish google email={state.email} name={state.name} terms onSubmit={async (f) => {
        const r = await api<Answer>("POST", "/auth/google/finish", { token, locale, ...f });
        await enter(r); onDone();
      }} />
    </Page>
  );
}
