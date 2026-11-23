import { useState } from "react";
import { useT } from "../i18n";
import { ACTIVITY_FILTERS, activityCounts, parseFilter, type ActivityFilter } from "../lib/botactivity";
import type { Bot, Live } from "../types";
import "./BotActivityFilter.css";

const KEY = "sklubot.sidebar.activity";

/** L146: the sidebar's activity filter, remembered in this browser only. */
export function useActivityFilter(): [ActivityFilter, (f: ActivityFilter) => void] {
  const [f, setF] = useState<ActivityFilter>(() => { try { return parseFilter(localStorage.getItem(KEY)); } catch { return "all"; } });
  return [f, (next) => { setF(next); try { localStorage.setItem(KEY, next); } catch { /* not kept */ } }];
}

export function BotActivityFilter({ bots, live, value, onChange }: { bots: Bot[]; live: Record<string, Live | undefined>; value: ActivityFilter; onChange: (f: ActivityFilter) => void }) {
  const t = useT();
  const n = activityCounts(bots, live);
  return (
    <div className="bot-activity" role="group" aria-label={t("sidebar.activity.label")}>
      {ACTIVITY_FILTERS.map((f) => (
        <button key={f} type="button" className={`bot-activity-chip ${value === f ? "is-on" : ""}`} aria-pressed={value === f} onClick={() => onChange(value === f && f !== "all" ? "all" : f)}>
          {t(`sidebar.activity.${f}`)}<span className="bot-activity-n">{n[f]}</span>
        </button>
      ))}
      {value !== "all" && n[value] === 0 && <p className="bot-activity-none muted small">{t("sidebar.activity.none")}</p>}
    </div>
  );
}
