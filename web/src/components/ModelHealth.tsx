/**
 * Model health (nod items 3 and 4, L59, L60; server modelhealth.ts). A tiny real request tells whether a bot's model
 * answers before anyone sends a message:
 *  - ModelHealthBanner, above the composer: shown only when the model does not answer, with the reason in plain words
 *    and the button that fixes it ("Reconnecter" for a refused key opens Settings → Models).
 *  - ModelHealthLine: the result of a check, right after a model is chosen (bot settings) and in the first-run guide.
 * The server keeps results a few minutes, so opening a chat costs nothing most of the time.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Icon } from "./Icon";
import "./ModelHealth.css";

export type HealthStatus = "ok" | "reconnect" | "no_credit" | "down" | "none" | "skipped";
export interface ModelHealth { ref: string; label: string; status: HealthStatus; reason: string | null; ms: number | null; checkedAt: number; fix: "models" | "subscription" | "bot" | null }

const BAD: HealthStatus[] = ["reconnect", "no_credit", "down", "none"];
const titleKey = (s: HealthStatus) => (s === "reconnect" ? "modelHealth.toReconnect" : s === "no_credit" ? "modelHealth.noCredit" : "modelHealth.notAnswering");

/** The bot's model health; `fresh` checks again now (a model just chosen, the "Vérifier" button). */
export function useModelHealth(botId: string | null, model: string, fresh = false): { health: ModelHealth | null; checking: boolean; recheck: () => void } {
  const [health, setHealth] = useState<ModelHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!botId) return;
    let live = true;
    setChecking(true);
    api<{ health: ModelHealth }>("GET", `/bots/${encodeURIComponent(botId)}/model-health${fresh || nonce ? "?fresh=1" : ""}`)
      .then((r) => { if (live) setHealth(r.health); }, () => { if (live) setHealth(null); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [botId, model, fresh, nonce]);
  return { health, checking, recheck: () => setNonce((n) => n + 1) };
}

function FixButton({ health, botId }: { health: ModelHealth; botId: string }) {
  const t = useT();
  const open = () => {
    const s = useStore.getState();
    if (health.fix === "subscription") s.openAppSettings("subscription");
    else if (health.fix === "bot") s.openBotSettings(botId, "general");
    else s.openAppSettings("models");
  };
  if (!health.fix) return null;
  return (
    <button type="button" className="btn btn-small btn-primary" onClick={open}>
      <Icon name={health.fix === "subscription" ? "bolt" : "key"} size={14} />
      {t(health.status === "reconnect" ? "modelHealth.reconnect" : health.fix === "subscription" ? "modelHealth.addCredit" : "modelHealth.openModels")}
    </button>
  );
}

/** Above the composer: only when the bot's model does not answer. */
export function ModelHealthBanner({ bot }: { bot: Bot }) {
  const { health, checking, recheck } = useModelHealth(bot.kind === "agent" ? bot.id : null, bot.model);
  return <ModelHealthBannerView health={health} botId={bot.id} checking={checking} onRetry={recheck} />;
}

/** The banner itself (also shown by the gallery with made-up results). */
export function ModelHealthBannerView({ health, botId, checking, onRetry }: { health: ModelHealth | null; botId: string; checking: boolean; onRetry: () => void }) {
  const t = useT();
  if (!health || !BAD.includes(health.status)) return null;
  return (
    <div className={`model-health-banner is-${health.status}`} role="alert">
      <Icon name="alert" size={16} />
      <span className="model-health-text">
        <b>{t(titleKey(health.status), { model: health.label })}</b>
        {health.reason ? <span className="model-health-reason">{health.reason}</span> : null}
      </span>
      <span className="model-health-actions">
        <FixButton health={health} botId={botId} />
        <button type="button" className="btn btn-small" onClick={onRetry} disabled={checking}><Icon name="refresh" size={14} />{t(checking ? "modelHealth.checking" : "modelHealth.retry")}</button>
      </span>
    </div>
  );
}

/** The result of a check, in plain words (bot settings after a model is chosen; the first-run guide's test call). */
export function ModelHealthLine({ botId, model, fresh = true, intro }: { botId: string; model: string; fresh?: boolean; intro?: string }) {
  const { health, checking, recheck } = useModelHealth(botId, model, fresh);
  return <ModelHealthLineView health={health} checking={checking} botId={botId} intro={intro} onRetry={recheck} />;
}

export function ModelHealthLineView({ health, checking, botId, intro, onRetry }: { health: ModelHealth | null; checking: boolean; botId: string; intro?: string; onRetry: () => void }) {
  const t = useT();
  if (!checking && !health) return null;
  if (health?.status === "skipped" && !checking) return null;
  const ok = health?.status === "ok";
  return (
    <div className={`model-health-line ${checking ? "is-checking" : ok ? "is-ok" : "is-bad"}`} role="status" aria-live="polite">
      <Icon name={checking ? "clock" : ok ? "check" : "alert"} size={15} />
      <span className="model-health-text">
        {intro ? <b>{intro}</b> : null}
        <span>{checking ? t("modelHealth.testing") : ok
          ? t("modelHealth.okLine", { model: health!.label, s: ((health!.ms ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) })
          : `${t(titleKey(health!.status), { model: health!.label })} ${health!.reason ?? ""}`}</span>
      </span>
      {!checking && health && !ok && <span className="model-health-actions"><FixButton health={health} botId={botId} /><button type="button" className="btn btn-small" onClick={onRetry}>{t("modelHealth.retry")}</button></span>}
    </div>
  );
}
