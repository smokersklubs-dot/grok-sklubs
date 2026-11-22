import { useEffect } from "react";
import { useT, type Key } from "../i18n";
import { IDLE_LIVE, useStore } from "../store";
import type { Bot } from "../types";
import { endedRuns, refreshStopCauses, startedRuns, useStopCauses } from "../lib/stopcauses";
import type { StopCause } from "../../../server/src/stopcause";
import { BotAvatar } from "./Avatar";
import "./SidebarStatus.css";

/**
 * L142 in the sidebar: a chip on a bot's line saying why its last work stopped (« Limite d'étapes », « Erreur »…, from
 * GET /bots/stop-causes), and the « qui travaille » bar above the list: who is working right now, one tap to open them.
 */
const CAUSE_KEY: Record<StopCause, Key> = {
  steps: "stop.cause.steps", timeout: "stop.cause.timeout", busy: "stop.cause.busy", interrupted: "stop.cause.interrupted",
  plan: "stop.cause.plan", sublimit: "stop.cause.sublimit", stopped: "stop.cause.stopped", loop: "stop.cause.loop", error: "stop.cause.error",
};

/** Keeps the chips fresh: once at start, then after any bot stops; a bot that starts again loses its chip at once. */
export function useStopCauseSync(): void {
  const signedIn = useStore((s) => !!s.user);
  useEffect(() => {
    if (!signedIn) return;
    refreshStopCauses();
    return useStore.subscribe((s, prev) => {
      if (s.live === prev.live) return;
      const started = startedRuns(prev.live, s.live);
      if (started.length) {
        const causes = { ...useStopCauses.getState().causes };
        for (const id of started) delete causes[id];
        useStopCauses.setState({ causes });
      }
      if (endedRuns(prev.live, s.live).length) refreshStopCauses(1500);
    });
  }, [signedIn]);
}

export function StopCauseChip({ bot }: { bot: Bot }) {
  const t = useT();
  const v = useStopCauses((s) => s.causes[bot.id]);
  const running = useStore((s) => !!s.live[bot.id]?.running);
  if (!v || running) return null;
  const label = t(CAUSE_KEY[v.cause]);
  return <span className={`stop-chip is-${v.cause === "stopped" ? "info" : v.cause === "error" || v.cause === "loop" ? "error" : "warn"}`} title={v.text || label}>{label}</span>;
}

export function WorkingBar({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const live = useStore((s) => s.live);
  const selectBot = useStore((s) => s.selectBot);
  const working = Object.values(bots).filter((b) => (live[b.id] ?? IDLE_LIVE).running && !b.listHidden).sort((a, b) => (live[a.id]?.startedAt ?? 0) - (live[b.id]?.startedAt ?? 0));
  if (!working.length || collapsed) return null;
  return (
    <div className="working-bar" role="group" aria-label={t("working.label", { n: working.length })}>
      <span className="working-bar-dot" aria-hidden="true" />
      <span className="working-bar-text">{t("working.label", { n: working.length })}</span>
      <span className="working-bar-faces">
        {working.slice(0, 6).map((b) => (
          <button key={b.id} type="button" className="working-bar-face" title={t("working.open", { name: b.name })} aria-label={t("working.open", { name: b.name })} onClick={() => selectBot(b.id)}>
            <BotAvatar bot={b} size={24} />
          </button>
        ))}
        {working.length > 6 && <span className="working-bar-more">+{working.length - 6}</span>}
      </span>
    </div>
  );
}
