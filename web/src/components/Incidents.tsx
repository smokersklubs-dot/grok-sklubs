/**
 * « Coordinateur d'échecs » (server agent/failures.ts) in the app:
 *  - FailureCardView: the one card a failure ends on — what happened, what was tried on its own, and the buttons that
 *    unblock it (Réessayer cette étape, Continuer sans, Reconnecter mon compte, Redémarrer l'ordinateur…).
 *  - IncidentsSection: the bot's « Incidents » in the Activité tab (time, kind, what was tried, result).
 *  - FailureSummary: the line on « Aujourd'hui » ("2 incidents réglés automatiquement, 1 attend ta décision") and the
 *    notice of a provider that fails for several bots at once (one notice, not one card per bot).
 */
import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { tn, useT, type Key } from "../i18n";
import { clockTime, relTime } from "../lib/format";
import { useStore } from "../store";
import type { Bot, Card, FailureClass, FailureRemedy, FailureSummary as Summary, FailureTry, FailureView } from "../types";
import { Icon, type IconName } from "./Icon";
import { ErrorNote, IconButton, Loading } from "./ui";
import "./Incidents.css";

type FailureCard = Extract<Card, { type: "failure" }>;

const CLASS_ICON: Record<FailureClass, IconName> = {
  provider_down: "globe", rate_limited: "clock", subscription_limit: "clock", auth_expired: "key", out_of_budget: "chart",
  tool_error: "wrench", computer_down: "monitor", timeout: "clock", loop_detected: "refresh", bad_input: "info", unknown: "alert",
};
const REMEDY_ICON: Record<FailureRemedy, IconName> = {
  retry: "refresh", continue_without: "play", reconnect: "key", connect_account: "plug", restart_computer: "monitor", switch_model: "brain", handoff: "users",
};

/** "Réessayé automatiquement (n'a pas marché)" etc. */
function TriedLine({ x }: { x: FailureTry }) {
  const t = useT();
  const result = x.ok === null ? "failure.tried.pending" : x.ok ? "failure.tried.ok" : "failure.tried.ko";
  return (
    <li className={`failure-try is-${x.ok === null ? "pending" : x.ok ? "ok" : "ko"}`}>
      <Icon name={x.ok === null ? "clock" : x.ok ? "check" : "close"} size={13} />
      <span>{t(`failure.auto.${x.action}` as Key, { note: x.note ?? "" })}</span>
      <span className="muted">· {t(result as Key)} · {clockTime(x.at)}</span>
    </li>
  );
}

export function FailureCardView({ card, botId }: { card: FailureCard; botId: string }) {
  const t = useT();
  const own = useStore((s) => !s.bots[botId]?.access);
  const hosted = useStore((s) => s.hosted);
  const [busy, setBusy] = useState<FailureRemedy | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const { openAppSettings, openBotSettings, openViewer } = useStore.getState();
  const act = async (action: FailureRemedy | "dismiss") => {
    setError(null);
    // These open the place where it is fixed; the card stays until a turn goes through again.
    if (action === "connect_account") { openAppSettings(hosted ? "subscription" : "keys"); return; }
    if (action === "switch_model") { openBotSettings(botId, "general"); return; }
    setBusy(action);
    try {
      const r = await api<{ openViewer?: boolean }>("POST", `/bots/${enc(botId)}/failures/${enc(card.failureId)}`, { action });
      if (action === "reconnect") { setHint(t("failure.reconnectHint")); if (r.openViewer) openViewer(botId, { control: true }); }
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const open = card.status === "pending" || card.status === "retrying";
  const brand = card.engine === "codex" ? "ChatGPT" : "Claude";
  const label = (r: FailureRemedy) => t(r === "retry" && card.cls !== "tool_error" ? "failure.remedy.retryWork" : `failure.remedy.${r}` as Key, { brand, tool: card.tool ?? "", name: card.teammate?.name ?? t("failure.aTeammate") });
  return (
    <div className={`card failure-card is-${card.status}`}>
      <div className="card-head">
        <span className={`logo-tile ${open ? "is-warn" : "is-ok"}`} aria-hidden="true"><Icon name={CLASS_ICON[card.cls]} size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t(`failure.class.${card.cls}` as Key, { tool: card.tool ?? "", brand })}</p>
          <p className="card-sub">{t(`failure.status.${card.status}` as Key, { name: card.teammate?.name ?? "" })}{card.count > 1 && <> · <span className="failure-count">{tn("failure.count", card.count)}</span></>}</p>
        </div>
      </div>
      <p className="card-reason">{t(`failure.explain.${card.cls}` as Key, { tool: card.tool ?? "", brand })}</p>
      {card.detail && <pre className="card-detail">{card.detail}</pre>}
      {card.tried.length > 0 && (
        <div className="failure-tried">
          <p className="small muted">{t("failure.triedTitle")}</p>
          <ul>{card.tried.map((x, i) => <TriedLine key={i} x={x} />)}</ul>
        </div>
      )}
      <p className="card-note"><Icon name="shield" size={13} /> {t("failure.kept")}</p>
      {card.status === "retrying" && card.retryAt && card.retryAt > Date.now() && <p className="card-note"><Icon name="clock" size={13} /> {t("failure.retryAt", { time: clockTime(card.retryAt) })}</p>}
      {open && own && (
        <div className="card-actions failure-actions">
          <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("dismiss")}>{t("common.dismiss")}</button>
          <span className="spacer" />
          {card.remedies.map((r, i) => (
            <button key={r} type="button" className={`btn ${i === 0 ? "btn-accent" : ""}`} disabled={busy !== null} onClick={() => void act(r)}>
              <Icon name={REMEDY_ICON[r]} size={14} /> {busy === r ? t("common.working") : label(r)}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="card-note" role="status">{hint}</p>}
      {card.status === "resolved" && <p className="card-outcome is-allowed"><Icon name="check" size={14} /> {t("failure.resolved")}</p>}
      {card.status === "handed" && <p className="card-outcome is-allowed"><Icon name="users" size={14} /> {t("failure.handed", { name: card.teammate?.name ?? "" })}</p>}
      {card.status === "dismissed" && <p className="card-outcome is-denied"><Icon name="close" size={14} /> {t("failure.dismissed")}</p>}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- « Incidents » in the Activité tab ---------- */

const RESULT_TONE: Record<FailureView["status"], "ok" | "warn" | "muted"> = { resolved: "ok", handed: "ok", auto: "warn", retrying: "warn", waiting: "warn", dismissed: "muted" };

export function IncidentsSection({ bot }: { bot: Bot }) {
  const t = useT();
  const [list, setList] = useState<FailureView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Reloaded whenever the bot's conversation changes (a failure card appears or settles there).
  const rowsCount = useStore((s) => s.threads[bot.id]?.rows.length ?? 0);
  const load = () => api<{ failures: FailureView[] }>("GET", `/bots/${enc(bot.id)}/failures`).then((r) => { setList(r.failures); setError(null); }, (e) => setError(errText(e)));
  useEffect(() => { void load(); }, [bot.id, rowsCount]);
  const shown = list ? (all ? list : list.slice(0, 5)) : [];
  return (
    <section className="section incidents">
      <div className="section-head">
        <h3>{t("incidents.title")}</h3>
        <IconButton icon="refresh" size={15} label={t("incidents.refresh")} onClick={() => void load()} />
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!list && !error && <Loading />}
      {list && list.length === 0 && <p className="muted small">{t("incidents.empty")}</p>}
      {list && list.length > 0 && (
        <ul className="list incident-list">
          {shown.map((x) => (
            <li key={x.id} className={`incident-row is-${RESULT_TONE[x.status]}`}>
              <span className="incident-icon" aria-hidden="true"><Icon name={CLASS_ICON[x.cls]} size={15} /></span>
              <div className="incident-text">
                <span className="incident-title">{t(`failure.class.${x.cls}` as Key, { tool: x.tool, brand: x.provider === "codex" ? "ChatGPT" : "Claude" })}{x.count > 1 && <span className="muted"> ×{x.count}</span>}</span>
                <span className="incident-sub">
                  {relTime(x.lastAt)} · {x.tried.length ? x.tried.map((y) => t(`failure.auto.${y.action}` as Key, { note: y.note ?? "" })).join(", ") : t("incidents.nothingTried")}
                </span>
              </div>
              <span className={`incident-result is-${RESULT_TONE[x.status]}`}>{t(`incidents.result.${x.status === "resolved" && x.resolvedBy === "user" ? "resolvedUser" : x.status}` as Key)}</span>
            </li>
          ))}
        </ul>
      )}
      {list && list.length > 5 && (
        <button type="button" className="link small" onClick={() => setAll((v) => !v)}>{t(all ? "incidents.less" : "incidents.more", { n: list.length })}</button>
      )}
    </section>
  );
}

/* ---------- « Aujourd'hui » ---------- */

const PROVIDER_NAME: Record<string, string> = { "claude-code": "Claude", codex: "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" };

export function FailureSummaryLine({ summary, onChanged }: { summary?: Summary; onChanged?: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!summary || (!summary.autoFixed && !summary.waiting && !summary.outages.length)) return null;
  const retry = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try { await api("POST", "/failures/outages/retry", { provider }); onChanged?.(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const parts = [summary.autoFixed ? tn("incidents.summary.auto", summary.autoFixed) : "", summary.waiting ? tn("incidents.summary.waiting", summary.waiting) : ""].filter(Boolean);
  return (
    <div className="failure-summary" role="status">
      {parts.length > 0 && (
        <p className={`failure-summary-line ${summary.waiting ? "is-warn" : "is-ok"}`}>
          <Icon name={summary.waiting ? "alert" : "check"} size={15} /> <span>{parts.join(", ")}</span>
        </p>
      )}
      {summary.outages.map((o) => (
        <div key={o.provider} className="failure-outage">
          <Icon name="globe" size={16} />
          <div className="failure-outage-text">
            <p className="failure-outage-title">{t("incidents.outage.title", { provider: PROVIDER_NAME[o.provider] ?? o.provider })}</p>
            <p className="muted small">{tn("incidents.outage.text", o.bots, { since: clockTime(o.since) })}</p>
          </div>
          <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void retry(o.provider)}>
            <Icon name="refresh" size={14} /> {t(busy === o.provider ? "common.working" : "incidents.outage.retry")}
          </button>
        </div>
      ))}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
