import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { openSignInWindow, onSignInDone } from "../lib/oauth";
import { useStore } from "../store";
import type { CatalogApp, NativeAccount, NativeApp, NativeVendorSetup } from "../types";
import { Icon, Spinner } from "./Icon";
import { ConfirmButton, CopyButton, ErrorNote } from "./ui";

/**
 * Built-in apps (Gmail, Google Calendar, Google Drive, Outlook, Slack). Each vendor needs an OAuth client the user creates
 * in their own console once (step-by-step instructions, the redirect URI to register, the scopes); after that, every
 * account is added with a label ("perso", "pro") and signed into in a popup.
 */

const letter = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();

/** Loads the built-in apps once, and again whenever a sign-in finishes in the popup. */
export function useNative() {
  const native = useStore((s) => s.native);
  const loadNative = useStore((s) => s.loadNative);
  useEffect(() => {
    void loadNative();
    return onSignInDone(() => void loadNative());
  }, [loadNative]);
  return native;
}

/** Sends the popup opened in the click to the vendor's sign-in page. */
function goTo(win: Window | null, url: string) {
  if (win && !win.closed) win.location.href = url;
  else window.location.assign(url);
}

/** The OAuth client form, with the vendor's steps, the exact redirect URI and the scopes. */
function ClientSetup({ vendor, app, onSaved, onCancel }: { vendor: NativeVendorSetup; app: NativeApp; onSaved: () => void; onCancel?: () => void }) {
  const t = useT();
  const loadNative = useStore((s) => s.loadNative);
  const ids = { id: useId(), secret: useId(), tenant: useId(), xapp: useId() };
  const [clientId, setClientId] = useState(vendor.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [tenant, setTenant] = useState(vendor.tenant && vendor.tenant !== "common" ? vendor.tenant : "");
  const [appToken, setAppToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = vendor.configured;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !clientId.trim() || (!changing && !secret.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await api("PUT", `/native/clients/${vendor.vendor}`, {
        clientId: clientId.trim(),
        ...(secret.trim() ? { clientSecret: secret.trim() } : {}),
        ...(vendor.vendor === "microsoft" ? { tenant: tenant.trim() } : {}),
        ...(vendor.vendor === "slack" && appToken.trim() ? { appToken: appToken.trim() } : {}),
      });
      await loadNative();
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="native-setup" onSubmit={save}>
      <p className="field-hint">{t("native.clientIntro", { vendor: vendor.name })}</p>
      <ol className="native-steps">
        {vendor.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="field">
        <span className="field-label">{t("native.redirectUri")}</span>
        <div className="copy-row">
          <input className="input mono" value={vendor.redirectUri} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={t("native.redirectUri")} />
          <CopyButton text={vendor.redirectUri} label={t("oauth.copy")} />
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t("native.scopes", { app: app.name })}</span>
        <ul className="native-scopes">
          {app.scopes.map((s) => <li key={s}><code>{s}</code></li>)}
        </ul>
      </div>
      <p className="field-hint native-docs">
        {t("native.docs")}{" "}
        {vendor.docs.map((d, i) => (
          <span key={d.url}>{i ? " · " : ""}<a href={d.url} target="_blank" rel="noopener noreferrer">{d.label}</a></span>
        ))}
      </p>
      <div className="form-cols">
        <div className="field">
          <label className="field-label" htmlFor={ids.id}>{t("oauth.clientId")}</label>
          <input id={ids.id} className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.secret}>{t("oauth.clientSecret")} {changing && <span className="muted">{t("native.keepSecret")}</span>}</label>
          <input id={ids.secret} className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      </div>
      {vendor.vendor === "microsoft" && (
        <div className="field">
          <label className="field-label" htmlFor={ids.tenant}>{t("native.tenant")} <span className="muted">{t("common.optional")}</span></label>
          <input id={ids.tenant} className="input" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="common" autoComplete="off" spellCheck={false} />
          <p className="field-hint">{t("native.tenantHint")}</p>
        </div>
      )}
      {vendor.vendor === "slack" && (
        <div className="field">
          <label className="field-label" htmlFor={ids.xapp}>{t("native.appToken")} <span className="muted">{vendor.hasAppToken ? t("native.appTokenSaved") : t("common.optional")}</span></label>
          <input id={ids.xapp} className="input" type="password" value={appToken} onChange={(e) => setAppToken(e.target.value)} placeholder="xapp-…" autoComplete="off" spellCheck={false} />
          <p className="field-hint">{t("native.appTokenHint")}</p>
        </div>
      )}
      <p className="field-hint">{t("native.sealed")}</p>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        {onCancel && <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>{t("common.cancel")}</button>}
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !clientId.trim() || (!changing && !secret.trim())}>
          {busy ? <><Spinner size={13} /> {t("common.saving")}</> : t("native.saveClient")}
        </button>
      </div>
    </form>
  );
}

/** Adds one labelled account of an app: the label, then the vendor's sign-in page in a popup. */
function AddAccount({ app, existing, onStarted }: { app: NativeApp; existing: NativeAccount[]; onStarted: () => void }) {
  const t = useT();
  const id = useId();
  const [label, setLabel] = useState(existing.length ? "" : t("native.labelDefault"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadNative = useStore((s) => s.loadNative);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !label.trim()) return;
    const win = openSignInWindow();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ authorizeUrl: string }>("POST", "/native/accounts", { app: app.id, label: label.trim() });
      goTo(win, r.authorizeUrl);
      await loadNative();
      setLabel("");
      onStarted();
    } catch (err) {
      win?.close();
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="native-add" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={id}>{t("native.label")}</label>
        <input id={id} className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} placeholder={t("native.labelPlaceholder")} autoComplete="off" />
        <p className="field-hint">{t("native.labelHint", { app: app.name, label: label.trim() || t("native.labelPlaceholder") })}</p>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !label.trim()}>
          {busy ? <><Spinner size={13} /> {t("connector.signingIn")}</> : t("oauth.signInWith", { name: app.name })}
        </button>
      </div>
    </form>
  );
}

/** A catalogue card for a built-in app: client set-up when needed, then "add an account" (as many as wanted). */
export function NativeCatalogCard({ entry, open, onToggle }: { entry: CatalogApp; open: boolean; onToggle: () => void }) {
  const t = useT();
  const native = useNative();
  const [editClient, setEditClient] = useState(false);
  const app = native?.apps.find((a) => a.id === entry.native);
  const vendor = app && native?.vendors.find((v) => v.vendor === app.vendor);
  const mine = (native?.accounts ?? []).filter((a) => a.app === entry.native);
  return (
    <li className={`catalog-card ${open ? "is-open" : ""}`}>
      <div className="catalog-card-main">
        <span className={`logo-tile native-${entry.native}`} aria-hidden="true">{letter(entry.name)}</span>
        <div className="list-row-text">
          <span className="list-row-title">{entry.name} <span className="chip chip-quiet">{t("native.builtIn")}</span></span>
          <span className="list-row-sub">{entry.description}</span>
        </div>
        {mine.length > 0 && !open && (
          <span className="chip state-ready"><Icon name="check" size={12} /> {t(mine.length === 1 ? "native.accounts_one" : "native.accounts_other", { n: mine.length })}</span>
        )}
        <button type="button" className="btn btn-small" aria-expanded={open} onClick={onToggle} aria-label={t("catalog.addName", { name: entry.name })}>
          {open ? t("common.cancel") : mine.length ? t("native.addAnother") : t("catalog.add")}
        </button>
      </div>
      {open && app && vendor && (
        <div className="catalog-form">
          {!vendor.configured || editClient ? (
            <ClientSetup vendor={vendor} app={app} onSaved={() => setEditClient(false)} onCancel={editClient ? () => setEditClient(false) : undefined} />
          ) : (
            <>
              <p className="muted small native-client-line">
                <Icon name="check" size={12} /> {t("native.clientReady", { vendor: vendor.name, id: vendor.clientId ?? "" })}{" "}
                <button type="button" className="link" onClick={() => setEditClient(true)}>{t("native.changeClient")}</button>
              </p>
              <AddAccount app={app} existing={mine} onStarted={() => undefined} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** One signed-in account in the "connected" list: status, sign in again, disconnect. */
export function NativeAccountRow({ acc }: { acc: NativeAccount }) {
  const t = useT();
  const loadNative = useStore((s) => s.loadNative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    const win = openSignInWindow();
    setBusy(true);
    setError(null);
    try {
      goTo(win, (await api<{ authorizeUrl: string }>("POST", `/native/accounts/${acc.id}/signin`, {})).authorizeUrl);
    } catch (err) {
      win?.close();
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await api("DELETE", `/native/accounts/${acc.id}`);
      await loadNative();
    } catch (err) {
      setError(errText(err));
    }
  };
  const needs = acc.status === "needs_auth";
  return (
    <li className="connector">
      <div className="connector-main">
        <span className={`logo-tile native-${acc.app}`} aria-hidden="true">{letter(acc.name)}</span>
        <div className="list-row-text">
          <span className="list-row-title">
            {acc.name}
            <span className={`chip state-${acc.status}`}>{t(`connector.status.${acc.status}`)}</span>
          </span>
          <span className="list-row-sub truncate">{acc.identity ?? t("native.notSignedYet")} · {t("native.builtIn")}</span>
        </div>
        {needs && (
          <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void signIn()} aria-label={t("native.signInAgainName", { name: acc.name })}>
            {busy ? <><Spinner size={13} /> {t("connector.signingIn")}</> : acc.identity ? t("native.signInAgain") : t("connector.signIn")}
          </button>
        )}
        <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("native.disconnect")} confirmLabel={t("native.confirmDisconnect")} busyLabel={t("connector.removing")} onConfirm={remove} />
      </div>
      {needs && <p className="field-hint connector-note">{acc.identity ? t("native.needsAuthHint") : t("native.pendingHint")}</p>}
      <ErrorNote>{error}</ErrorNote>
    </li>
  );
}
