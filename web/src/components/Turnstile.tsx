/**
 * Cloudflare Turnstile on the sign-up form (only when the server sends a site key: TURNSTILE_SITE_KEY, see server
 * publicsignup.ts). Explicit rendering, from Cloudflare's documentation
 * (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ and …/widget-configurations/):
 * the script https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit, then
 * turnstile.render(container, { sitekey, callback, "expired-callback", "error-callback", theme, language, size, action })
 * and turnstile.remove(widgetId). The token goes to POST /api/auth/signup as `turnstileToken`; the server checks it
 * with Siteverify. A token is valid 300 s and single use: after a refused sign-up the form asks for a new one (reset).
 */
import { useEffect, useRef, useState } from "react";
import { sideText, useLocale } from "../i18n";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
interface TurnstileApi {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  remove(id: string): void;
  reset(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    s.onerror = () => { loading = null; reject(new Error("turnstile")); };
    document.head.appendChild(s);
  });
  return loading;
}

const TEXT = {
  fr: { loading: "Vérification anti-robot…", failed: "La vérification anti-robot ne s'est pas chargée. Vérifie ta connexion, puis recharge la page.", label: "Vérification anti-robot" },
  en: { loading: "Anti-robot check…", failed: "The anti-robot check did not load. Check your connection, then reload the page.", label: "Anti-robot check" },
};

/** The widget. `resetKey` changing renders a fresh one (a token is single use). */
export function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (token: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const t = sideText("turnstile", TEXT, locale);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let id: string | null = null;
    let gone = false;
    onToken(null);
    loadTurnstile().then((ts) => {
      if (gone || !box.current) return;
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      id = ts.render(box.current, {
        sitekey: siteKey, action: "signup", theme: dark ? "dark" : "light", language: locale, size: "flexible",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => { onToken(null); },
      });
      setState("ready");
    }, () => { if (!gone) setState("failed"); });
    return () => { gone = true; if (id && window.turnstile) { try { window.turnstile.remove(id); } catch { /* already gone */ } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, resetKey, locale]);
  return (
    <div className="turnstile" aria-label={t.label}>
      <div ref={box} className="turnstile-box" />
      {state === "loading" && <p className="field-hint" role="status">{t.loading}</p>}
      {state === "failed" && <p className="field-hint is-error" role="alert">{t.failed}</p>}
    </div>
  );
}
