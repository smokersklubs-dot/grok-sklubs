import { useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import type { RowBody, SubscriptionLimitView } from "../types";
import { ENGINE_BRAND } from "../lib/engines";
import { clockTime, dateTime } from "../lib/format";
import { Icon } from "./Icon";

/**
 * A subscription at its usage limit (server/src/agent/sublimit.ts): "Me prévenir à la reprise" under the notice that the
 * bot's work waits for it, and the list of limited subscriptions shown on Today and Surveillance.
 */
type SubLimitAction = Extract<NonNullable<Extract<RowBody, { kind: "notice" }>["action"]>, { kind: "sublimit" }>;

/** The reminder switch under "your work waits": on by default; gone once the subscription is back. */
export function SubLimitNoticeActions({ action, botId, seq, readOnly }: { action: SubLimitAction; botId: string; seq: number; readOnly: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (action.status === "back") return <em className="notice-done sublimit-back"><Icon name="check" size={13} /> {t("sublimit.back")}</em>;
  if (readOnly) return null;
  const toggle = async () => {
    setBusy(true);
    setFailed(null);
    try { await api("POST", `/bots/${botId}/rows/${seq}/sublimit`, { notify: !action.notify }); } catch (e) { setFailed(errText(e)); }
    setBusy(false);
  };
  return (
    <div className="notice-actions" role="group">
      <button type="button" className={`btn btn-small ${action.notify ? "" : "btn-ghost"}`} aria-pressed={action.notify} disabled={busy}
        title={action.notify ? t("sublimit.notifyOn") : t("sublimit.notifyOff")} onClick={() => void toggle()}>
        <Icon name={action.notify ? "check" : "bell"} size={13} /> {t("sublimit.notify")}
      </button>
      {failed && <span className="notice-error" role="alert">{failed}</span>}
    </div>
  );
}

/** When a limit ends: the time only today, else the day too. */
const untilLabel = (ts: number) => (new Date(ts).toDateString() === new Date().toDateString() ? clockTime(ts) : dateTime(ts));

/** The subscriptions at their limit now, with when they come back (Today, Surveillance). Nothing when there are none. */
export function SubLimitList({ limits }: { limits: SubscriptionLimitView[] | undefined }) {
  const t = useT();
  if (!limits?.length) return null;
  return (
    <div className="sublimit-list" role="region" aria-label={t("sublimit.title")}>
      <h3 className="sublimit-title"><Icon name="clock" size={15} /> {t("sublimit.title")}</h3>
      <ul>
        {limits.map((l) => (
          <li key={`${l.account ?? ""}:${l.engine}`} className="sublimit-item">
            <strong>{t("sublimit.until", { brand: ENGINE_BRAND[l.engine], time: untilLabel(l.until) })}</strong>
            <span className="muted small">
              {t("sublimit.detail", { bots: l.bots, queued: l.queued })}
              {l.source === "default" && <> · {t("sublimit.guessed")}</>}
              {l.account && <> · {t("sublimit.account", { account: l.account })}</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
