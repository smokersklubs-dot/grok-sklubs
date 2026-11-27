import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import type { EngineWarmup, WarmState } from "../../../server/src/guidetypes";
import { Icon } from "./Icon";
import "./StepGuide.css";

/**
 * L145 « tour de chauffe des moteurs » (server enginewarmup.ts): above the composer of a bot that runs on a Claude or
 * ChatGPT subscription, the state of its engine since Sklubot restarted — « Préchauffage… » (asked again every 2 s),
 * « Moteur prêt » (with the time it took; shown for a short while), « pas encore préchauffé » with « Préchauffer » (opening
 * the chat of a cold engine primes it once by itself), or the
 * reason it failed with « Réessayer ». Priming asks the model nothing (no tokens, no subscription usage). Wrong-shaped
 * answers show nothing.
 */
const STATES: WarmState[] = ["cold", "warming", "ready", "failed", "off"];
const valid = (w: unknown): w is EngineWarmup => !!w && typeof w === "object" && STATES.includes((w as EngineWarmup).state);
export const isEngineBot = (bot: Pick<Bot, "model" | "kind">) => bot.kind === "agent" && /^(claude-code|codex):/.test(bot.model ?? "");
const READY_SHOWN_MS = 60_000;
/** Bots primed on opening during this page's life (once each; « Préchauffer » stays for another try). */
const autoWarmed = new Set<string>();

export function EngineWarmupLine({ bot }: { bot: Bot }) {
  const engine = isEngineBot(bot);
  const [w, setW] = useState<EngineWarmup | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!engine) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined, tries = 0;
    const load = () => api<{ warmup?: unknown }>("GET", `/bots/${enc(bot.id)}/engine-warmup`).then((r) => {
      if (!live) return;
      const next = valid(r?.warmup) ? r.warmup : null;
      // Opening the chat of a cold engine primes it once (free: no tokens), so the first message is not slow.
      if (next?.state === "cold" && !autoWarmed.has(bot.id)) { autoWarmed.add(bot.id); void api<{ warmup?: unknown }>("POST", `/bots/${enc(bot.id)}/engine-warmup`).then((p) => { if (live && valid(p?.warmup)) setW(p.warmup); }, () => undefined); }
      setW(next);
      if (next?.state === "warming" && ++tries < 60) timer = setTimeout(load, 2000);
    }, () => { if (live) setW(null); });
    void load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [bot.id, bot.model, engine, w?.state === "warming"]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!engine || !w) return null;
  const warm = async () => {
    setError(null);
    try { const r = await api<{ warmup?: unknown }>("POST", `/bots/${enc(bot.id)}/engine-warmup`); if (valid(r?.warmup)) setW(r.warmup); } catch (e) { setError(errText(e)); }
  };
  return <EngineWarmupView w={w} onWarm={() => void warm()} error={error} />;
}

export function EngineWarmupView({ w, onWarm, error, now = Date.now() }: { w: EngineWarmup; onWarm: () => void; error?: string | null; now?: number }) {
  const t = useT();
  if (w.state === "off") return null;
  if (w.state === "ready" && (!w.at || now - w.at > READY_SHOWN_MS)) return null;
  const secs = w.ms !== null ? (Math.round(w.ms / 100) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "";
  return (
    <div className={`warmup-line is-${w.state}`} role="status">
      <Icon name={w.state === "ready" ? "check" : w.state === "failed" ? "alert" : "bolt"} size={14} className={w.state === "warming" ? "warmup-spin" : undefined} />
      <span className="warmup-text">
        {w.state === "warming" ? t("warmup.warming") : w.state === "ready" ? t("warmup.ready", { s: secs }) : w.state === "failed" ? t("warmup.failed", { reason: w.reason ?? "?" }) : t("warmup.cold")}
      </span>
      {(w.state === "cold" || w.state === "failed") && <button type="button" className="btn btn-small" onClick={onWarm}>{t(w.state === "failed" ? "warmup.retry" : "warmup.warm")}</button>}
      {error && <span className="card-error" role="alert">{error}</span>}
    </div>
  );
}
