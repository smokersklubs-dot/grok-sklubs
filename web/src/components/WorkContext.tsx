import { useEffect, useState } from "react";
import { api, enc } from "../api";
import type { Bot, Engine } from "../types";
import { useStore } from "../store";
import { ENGINE_BRAND, prettyModel } from "../lib/engines";
import "./WorkContext.css";

interface Context { label: string; engine: Engine | null; state: string; target: string; shared?: string; limited: boolean; until: number | null }

export function WorkContext({bot}: {bot: Bot}) {
  const fr = useStore(s => s.locale === "fr");
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
  const labels: Record<string, [string,string]> = {
    checking:["Vérification…","Checking…"], unknown:["Connexion à vérifier","Connection unverified"],
    connected:["Abonnement connecté","Subscription connected"], personal:["Abonnement personnel connecté","Personal subscription connected"],
    missing:["Abonnement à connecter","Sign-in required"], demo:["Mode démo","Demo mode"],
    configured:["API configurée","API configured"], unavailable:["Modèle indisponible","Model unavailable"]
  };
  const target = relay?.name ?? data?.shared ?? ({own:fr?"Bureau de "+bot.name:bot.name+"'s desktop", shared:fr?"Bureau partagé":"Shared desktop",
    pool:fr?"Bureau temporaire":"Temporary desktop",browser:fr?"Navigateur du bot":"Bot browser", none:fr?"Aucun bureau":"No desktop"} as Record<string,string>)[data?.target ?? ""] ?? (fr?"Bureau à vérifier":"Desktop unverified");
  const model = data?.engine ? ENGINE_BRAND[data.engine] + " · " + (data.label.endsWith(":default") ? (fr?"modèle par défaut":"default model") : prettyModel(data.label.split(":").slice(1).join(":"))) : data?.label ?? bot.model;
  return <div className="work-context" aria-label={fr?"Contexte de travail":"Work context"}>
    <span>{model}</span><span>{target}</span>
    <span role="status">{labels[state]?.[fr?0:1]}{data?.limited && (fr?" · quota signalé":" · quota reported")}</span>
    {["missing","unavailable","demo"].includes(state) && <button className="link" onClick={() => useStore.getState().openAppSettings("models")}>{fr?"Modèles":"Models"}</button>}
    <button className="link" disabled={state==="checking"} onClick={() => refresh(n=>n+1)}>{fr?"Vérifier":"Check"}</button>
  </div>;
}
