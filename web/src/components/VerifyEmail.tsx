/**
 * E-mail verification of a new public account (server publicsignup.ts): the banner above the composer while the address
 * is not confirmed (the bots take no turns until then), and the page the e-mail's link opens (/?verify_email=…).
 */
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
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

/** Reads the signed-in person again (after a confirmation): the banner goes once the server says so. */
async function refreshUser(): Promise<User | null> {
  const me = await api<{ user: User | null }>("GET", "/me");
  if (me.user) useStore.setState({ user: me.user });
  return me.user;
}

export function VerifyBanner() {
  const user = useStore((s) => s.user);
  const showToast = useStore((s) => s.showToast);
  const t = useT();
  const [busy, setBusy] = useState<"resend" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user?.emailUnverified) return null;
  const resend = async () => {
    setBusy("resend"); setError(null);
    try {
      const r = await api<{ verified: boolean; email?: string }>("POST", "/account/verify-email/resend");
      if (r.verified) { await refreshUser(); showToast(t("verify.confirmed")); }
      else showToast(t("verify.sent", { email: r.email ?? user.email }));
    } catch (e) { setError(errText(e)); }
    setBusy(null);
  };
  const check = async () => {
    setBusy("check"); setError(null);
    try {
      const me = await refreshUser();
      showToast(me && !me.emailUnverified ? t("verify.confirmed") : t("verify.stillPending"));
    } catch (e) { setError(errText(e)); }
    setBusy(null);
  };
  return (
    <div className="verify-banner" role="status">
      <span className="verify-banner-icon" aria-hidden="true"><Icon name="mail" size={14} /></span>
      <div className="verify-banner-text">
        <b>{t("verify.bannerTitle")}</b> <span>{t("verify.bannerText", { email: user.email })}</span>
        <ErrorNote>{error}</ErrorNote>
      </div>
      <div className="verify-banner-actions">
        <button type="button" className="btn btn-small btn-ghost" disabled={!!busy} onClick={() => void check()}>{t("verify.done")}</button>
        <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void resend()}>{busy === "resend" ? t("verify.resending") : t("verify.resend")}</button>
      </div>
    </div>
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
