import { useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Icon } from "./Icon";

/**
 * "Sign in to a site on <bot>'s computer": opens the address in the bot's own browser, then the large view of its screen
 * in control mode, so the owner signs in himself, once. The session (cookies) stays in that browser's profile, kept in
 * the computer's home volume: the bot is signed in from then on, and never saw the password. While the owner drives,
 * the bot's own screen actions wait (takeover.ts). Linux computers only (their browser keeps its profile).
 */
export function SignInSite({ botId, name, address = "" }: { botId: string; name: string; address?: string }) {
  const fieldId = useId();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${botId}/screen/input`, { type: "goto", url: /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}` });
      setOpen(false);
      setUrl("");
      useStore.getState().openViewer(botId, { control: true });
    } catch (err) {
      setError(errText(err));
    }
    setBusy(false);
  };
  if (!open) {
    return (
      <button type="button" className="btn btn-small btn-ghost signin-site-open" onClick={() => { setUrl(address); setOpen(true); }} title={t("signinSite.hint", { name })}>
        <Icon name="key" size={14} /> {t("signinSite.button")}
      </button>
    );
  }
  return (
    <form className="signin-site" onSubmit={(e) => void go(e)}>
      <p className="list-row-sub">{t("signinSite.hint", { name })}</p>
      <div className="viewer-url">
        <label className="sr-only" htmlFor={fieldId}>{t("signinSite.address")}</label>
        <input id={fieldId} className="input input-small" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("signinSite.placeholder")} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoFocus />
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !url.trim()}>{t("signinSite.go")}</button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => { setOpen(false); setError(null); }}>{t("common.cancel")}</button>
      </div>
      {error && <p className="viewer-error" role="alert">{error}</p>}
    </form>
  );
}
