import { useEffect, useState } from "react";
import { api, enc } from "../api";
import type { Bot, Engine } from "../types";
import { useStore } from "../store";
import { sideText, useLocale } from "../i18n";
import { ENGINE_BRAND, prettyModel } from "../lib/engines";
import "./WorkContext.css";

interface Context { label: string; engine: Engine | null; state: string; target: string; shared?: string; limited: boolean; until: number | null }

/** French and English here; other languages in their dictionary file, `side.work` (docs/LANGUES.md). */
const TEXT = {
  fr: {
    checking: "Vérification…", unknown: "Connexion à vérifier", connected: "Abonnement connecté", personal: "Abonnement personnel connecté",
    missing: "Abonnement à connecter", demo: "Mode démo", configured: "API configurée", unavailable: "Modèle indisponible",
    own: "Bureau de {name}", shared: "Bureau partagé", pool: "Bureau temporaire", browser: "Navigateur du bot", none: "Aucun bureau",
    unverified: "Bureau à vérifier", defaultModel: "modèle par défaut", aria: "Contexte de travail", quota: " · quota signalé", models: "Modèles", check: "Vérifier",
  },
  en: {
    checking: "Checking…", unknown: "Connection unverified", connected: "Subscription connected", personal: "Personal subscription connected",
    missing: "Sign-in required", demo: "Demo mode", configured: "API configured", unavailable: "Model unavailable",
    own: "{name}'s desktop", shared: "Shared desktop", pool: "Temporary desktop", browser: "Bot browser", none: "No desktop",
    unverified: "Desktop unverified", defaultModel: "default model", aria: "Work context", quota: " · quota reported", models: "Models", check: "Check",
  },
};
const STATES = new Set(["checking", "unknown", "connected", "personal", "missing", "demo", "configured", "unavailable"]);
const TARGETS = new Set(["own", "shared", "pool", "browser", "none"]);

export function WorkContext({bot}: {bot: Bot}) {
  const w = sideText("work", TEXT, useLocale());
  const relay = useStore(s => s.relay)?.find(d => d.session?.botId === bot.id && !d.locked && d.status === "online");
  const [data, setData] = useState<Context | null>(null);
  const [state, setState] = useState("checking");
  const [attempt, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function check() {
      setState("checking");
      try {
        const ctx = await api<Context>("GET", "/bots/" + enc(bot.id) + "/work-context", undefined, signal);
        if (signal.aborted) return;
        setData(ctx);
        if (!ctx.engine || ctx.state === "unavailable") { setState(ctx.state); return; }
        const auth = await api<{signedIn:boolean | null;personal?:boolean}>("GET", "/connect-subscription/status?bot=" + enc(bot.id) + "&engine=" + ctx.engine + (attempt ? "" : "&passive=1"), undefined, signal);
        if (!signal.aborted) setState(auth.signedIn == null ? "unknown" : auth.signedIn ? (auth.personal ? "personal" : "connected") : "missing");
      } catch { if (!signal.aborted) setState("unknown"); }
    }
    void check();
    return () => controller.abort();
  }, [bot.id, bot.model, bot.computerMode, attempt]);
  const t = data?.target ?? "";
  const target = relay?.name ?? data?.shared ?? (TARGETS.has(t) ? w[t as keyof typeof w].replace("{name}", bot.name) : w.unverified);
  const model = data?.engine ? ENGINE_BRAND[data.engine] + " · " + (data.label.endsWith(":default") ? w.defaultModel : prettyModel(data.label.split(":").slice(1).join(":"))) : data?.label ?? bot.model;
  return <div className="work-context" aria-label={w.aria}>
    <span>{model}</span><span>{target}</span>
    <span role="status">{STATES.has(state) ? w[state as keyof typeof w] : ""}{data?.limited && w.quota}</span>
    {["missing","unavailable","demo"].includes(state) && <button className="link" onClick={() => useStore.getState().openAppSettings("models")}>{w.models}</button>}
    <button className="link" disabled={state==="checking"} onClick={() => refresh(n=>n+1)}>{w.check}</button>
  </div>;
}
