import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { intlLocale, useT } from "../i18n";
import { createPasskey, getPasskey, PasskeyCancelled, PasskeyUnsupported, passkeysSupported } from "../lib/webauthn";
import { relTime } from "../lib/format";
import { useStore } from "../store";
import type { User } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote } from "./ui";
import "./Passkeys.css";

/*
 * L44 « Clés d'accès » and « Nouvel appareil » (server: passkeys.ts, newdevice.ts). Settings → Permissions → Sécurité:
 * the passkeys (add, rename, remove) and the sign-ins from new devices with « Ce n'est pas moi ». The sign-in page: « Se
 * connecter avec une clé d'accès ». A floor approval card: « Utiliser ma clé d'accès » in place of the two-factor code.
 */

interface PasskeyView { id: string; name: string; createdAt: number; lastUsedAt: number | null; synced: boolean }
interface PasskeyList { available: boolean; passkeys: PasskeyView[]; max: number; needsPassword: boolean }
interface SignIn { id: string; at: number; family: string; via: string; active: boolean; denied: boolean; current: boolean }

const day = (ts: number) => new Date(ts).toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" });

let mineOnce: Promise<PasskeyList | null> | null = null;
const loadMine = (fresh = false) => { if (fresh) mineOnce = null; return (mineOnce ??= api<PasskeyList>("GET", "/account/passkeys").catch(() => null)); };

/** The words for a browser error: nothing when the person just closed the window. */
function passkeyError(err: unknown, t: ReturnType<typeof useT>): string | null {
  if (err instanceof PasskeyCancelled) return null;
  if (err instanceof PasskeyUnsupported) return t("pk.unsupported");
  if (err instanceof Error && err.message === "already-saved") return t("pk.alreadySaved");
  return errText(err);
}

function AddPasskey({ needsPassword, onAdded, onCancel }: { needsPassword: boolean; onAdded: (l: PasskeyView[]) => void; onCancel: () => void }) {
  const t = useT();
  const uid = useId();
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const o = await api<{ flow: string; options: unknown }>("POST", "/account/passkeys/options", needsPassword ? { password } : {});
      const response = await createPasskey(o.options);
      const r = await api<{ passkeys: PasskeyView[] }>("POST", "/account/passkeys", { flow: o.flow, response, name: name.trim() || undefined });
      onAdded(r.passkeys);
    } catch (err) { setError(passkeyError(err, t)); setBusy(false); }
  };
  return (
    <form className="pk-panel" onSubmit={submit}>
      <p className="muted small">{t("pk.addHint")}</p>
      <div className={needsPassword ? "form-cols is-even" : undefined}>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}n`}>{t("pk.name")}</label>
          <input id={`${uid}n`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("pk.namePlaceholder")} />
        </div>
        {needsPassword && (
          <div className="field">
            <label className="field-label" htmlFor={`${uid}p`}>{t("account.currentPassword")}</label>
            <input id={`${uid}p`} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end pk-actions">
        <button type="button" className="btn btn-small" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || (needsPassword && !password)}><Icon name="key" size={14} /> {t(busy ? "pk.adding" : "pk.create")}</button>
      </div>
    </form>
  );
}

function PasskeyRow({ pk, needsPassword, onChange }: { pk: PasskeyView; needsPassword: boolean; onChange: (l: PasskeyView[]) => void }) {
  const t = useT();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState(pk.name);
  const [error, setError] = useState<string | null>(null);
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try { await api("PATCH", `/account/passkeys/${encodeURIComponent(pk.id)}`, { name }); setEditing(false); const l = await loadMine(true); if (l) onChange(l.passkeys); }
    catch (err) { setError(errText(err)); }
  };
  const remove = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    try { const r = await api<{ passkeys: PasskeyView[] }>("DELETE", `/account/passkeys/${encodeURIComponent(pk.id)}`, needsPassword ? { password } : {}); mineOnce = null; onChange(r.passkeys); }
    catch (err) { setError(errText(err)); }
  };
  return (
    <li className="list-row is-card pk-row">
      {editing ? (
        <form className="pk-rename" onSubmit={rename}>
          <label className="field-label" htmlFor={`${uid}r`}>{t("pk.name")}</label>
          <input id={`${uid}r`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          <div className="pk-actions">
            <button type="button" className="btn btn-small" onClick={() => { setEditing(false); setName(pk.name); }}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>{t("common.save")}</button>
          </div>
        </form>
      ) : (
        <>
          <Icon name="key" size={18} />
          <div className="list-row-text">
            <span className="list-row-title"><span className="truncate">{pk.name}</span>{pk.synced && <span className="chip">{t("pk.synced")}</span>}</span>
            <span className="list-row-sub">{t("pk.added", { date: day(pk.createdAt) })} · {pk.lastUsedAt ? t("pk.used", { when: relTime(pk.lastUsedAt) }) : t("pk.neverUsed")}</span>
          </div>
          <div className="pk-actions">
            <button type="button" className="btn btn-small" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> {t("pk.rename")}</button>
            {needsPassword
              ? <button type="button" className="btn btn-small btn-danger" onClick={() => setRemoving(!removing)} aria-expanded={removing}>{t("pk.remove")}</button>
              : <ConfirmButton className="btn btn-small btn-danger" label={t("pk.remove")} confirmLabel={t("pk.removeConfirm")} onConfirm={() => remove()} />}
          </div>
          {removing && (
            <form className="pk-rename" onSubmit={remove}>
              <label className="field-label" htmlFor={`${uid}x`}>{t("pk.removePassword")}</label>
              <input id={`${uid}x`} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
              <div className="pk-actions">
                <button type="button" className="btn btn-small" onClick={() => { setRemoving(false); setPassword(""); }}>{t("common.cancel")}</button>
                <button type="submit" className="btn btn-small btn-danger" disabled={!password}>{t("pk.removeConfirm")}</button>
              </div>
            </form>
          )}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </li>
  );
}

/** Settings → Permissions → Sécurité → « Clés d'accès ». */
export function PasskeySettings({ onChange }: { onChange?: (has: boolean) => void }) {
  const t = useT();
  const [data, setData] = useState<PasskeyList | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { void loadMine().then(setData); }, []);
  const update = (passkeys: PasskeyView[]) => { setData((d) => (d ? { ...d, passkeys } : d)); onChange?.(passkeys.length > 0); };
  if (!data) return null;
  const supported = passkeysSupported();
  return (
    <div className="pk-block">
      <h4 className="pk-heading"><Icon name="key" size={15} /> {t("pk.heading")}</h4>
      <p className="muted small">{t("pk.hint")}</p>
      {!data.available && <p className="pk-note" role="note"><Icon name="info" size={14} /> <span>{t("pk.serverOff")}</span></p>}
      {data.available && !supported && <p className="pk-note" role="note"><Icon name="info" size={14} /> <span>{t("pk.unsupported")}</span></p>}
      {data.passkeys.length > 0 && <ul className="list pk-list">{data.passkeys.map((pk) => <PasskeyRow key={pk.id} pk={pk} needsPassword={data.needsPassword} onChange={update} />)}</ul>}
      {adding ? (
        <AddPasskey needsPassword={data.needsPassword} onCancel={() => setAdding(false)} onAdded={(l) => { mineOnce = null; update(l); setAdding(false); setNotice(t("pk.addedNotice")); }} />
      ) : (
        <div className="pk-actions">
          <button type="button" className="btn btn-small btn-primary" disabled={!data.available || !supported || data.passkeys.length >= data.max} onClick={() => { setAdding(true); setNotice(null); }}>
            <Icon name="plus" size={14} /> {t("pk.add")}
          </button>
        </div>
      )}
      {notice && <p className="muted small" role="status">{notice}</p>}
      <p className="muted small pk-foot">{t("pk.recovery")}</p>
      <p className="muted small pk-foot"><Icon name="smartphone" size={13} /> {t("pk.mobileNote")}</p>
    </div>
  );
}

/** Settings → Permissions → Sécurité → « Connexions depuis un nouvel appareil ». */
export function SignInAlerts() {
  const t = useT();
  const [list, setList] = useState<SignIn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => { void api<{ signIns: SignIn[] }>("GET", "/account/sign-ins").then((r) => setList(r.signIns), () => setList([])); }, []);
  const notMe = async (id: string) => {
    setError(null);
    try { const r = await api<{ signIns: SignIn[] }>("POST", `/account/sign-ins/${encodeURIComponent(id)}/not-me`); setList(r.signIns); setDenied(true); }
    catch (err) { setError(errText(err)); }
  };
  if (!list) return null;
  return (
    <div className="pk-block">
      <h4 className="pk-heading"><Icon name="smartphone" size={15} /> {t("newdev.heading")}</h4>
      <p className="muted small">{t("newdev.hint")}</p>
      {denied && (
        <div className="pk-note is-warn" role="alert">
          <Icon name="alert" size={14} />
          <span>{t("newdev.changePassword")}</span>
          <button type="button" className="btn btn-small btn-primary" onClick={() => useStore.getState().openAppSettings("account")}>{t("newdev.changePasswordBtn")}</button>
        </div>
      )}
      {list.length === 0 ? <p className="muted small">{t("newdev.empty")}</p> : (
        <ul className="list pk-list">
          {list.map((s) => (
            <li key={s.id} className="list-row is-card pk-row">
              <Icon name="monitor" size={18} />
              <div className="list-row-text">
                <span className="list-row-title"><span className="truncate">{s.family}</span>
                  <span className={`chip ${s.current ? "state-working" : s.denied ? "state-warn" : ""}`}>{t(s.current ? "newdev.current" : s.denied ? "newdev.denied" : s.active ? "newdev.active" : "newdev.ended")}</span>
                </span>
                <span className="list-row-sub">{relTime(s.at)} · {s.via}</span>
              </div>
              {s.active && !s.current && !s.denied && (
                <ConfirmButton className="btn btn-small btn-danger" label={t("newdev.notMe")} confirmLabel={t("newdev.notMeConfirm")} onConfirm={() => notMe(s.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

/** The sign-in page: « Se connecter avec une clé d'accès » (hidden where the browser has no passkeys). */
export function PasskeySignInButton({ onDone, onError }: { onDone: (u: User) => void | Promise<void>; onError: (msg: string | null) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!passkeysSupported()) return null;
  const go = async () => {
    if (busy) return;
    setBusy(true); onError(null);
    try {
      const o = await api<{ flow: string; options: unknown }>("POST", "/auth/passkey/options", {});
      const response = await getPasskey(o.options);
      const r = await api<{ user: User }>("POST", "/auth/passkey/verify", { flow: o.flow, response });
      await onDone(r.user);
    } catch (err) { onError(passkeyError(err, t)); setBusy(false); }
  };
  return (
    <button type="button" className="btn btn-block auth-btn pk-signin" onClick={() => void go()} disabled={busy}>
      <Icon name="key" size={15} /> {t(busy ? "pk.signingIn" : "pk.signIn")}
    </button>
  );
}

/** Whether the signed-in account has a passkey (for the floor card). */
export function useHasPasskey(enabled: boolean): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => { if (enabled && passkeysSupported()) void loadMine().then((l) => setHas(!!l?.passkeys.length)); }, [enabled]);
  return has;
}

/** « Utiliser ma clé d'accès »: a one-time proof for this purpose ("floor:<approval id>", "floor-off"), handed to `onProof`. */
export function PasskeyProofButton({ purpose, onProof }: { purpose: string; onProof: (proof: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const o = await api<{ flow: string; options: unknown }>("POST", "/account/passkey-proof/options", { purpose });
      const response = await getPasskey(o.options);
      onProof((await api<{ proof: string }>("POST", "/account/passkey-proof", { flow: o.flow, response })).proof);
    } catch (err) { setError(passkeyError(err, t)); }
    setBusy(false);
  };
  return (
    <>
      <button type="button" className="btn btn-small pk-proof" onClick={() => void go()} disabled={busy}><Icon name="key" size={14} /> {t(busy ? "pk.checking" : "pk.useForApproval")}</button>
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}
