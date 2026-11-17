import { useEffect, useId, useState, type ReactNode } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { compactNumber, dateTime, money } from "../lib/format";
import { useStore } from "../store";
import type { CapMode, CapPeriod, CapStateView, CapUnit, Card, UsageAmount, UsageCapsView } from "../types";
import { Icon } from "./Icon";
import { ErrorNote, Loading } from "./ui";

/*
 * Usage caps (server usagecaps.ts): today and this month per bot and for the account, with each cap's bar; the editor
 * of the account's caps, of one bot's (its settings) and of the operator's on a customer (hosted administration); the
 * card a reached cap leaves in the chat.
 */

const amount = (unit: CapUnit, n: number) => (unit === "usd" ? money(n) : `${compactNumber(n)} tokens`);
const SLOTS: { period: CapPeriod; unit: CapUnit }[] = [
  { period: "day", unit: "usd" }, { period: "day", unit: "tokens" }, { period: "month", unit: "usd" }, { period: "month", unit: "tokens" },
];

/** One cap's bar: what is used of it, when it starts again, what it stops. */
function CapMeter({ s, timezone }: { s: CapStateView; timezone: string }) {
  const t = useT();
  const pct = Math.min(100, s.percent);
  const tone = s.reached ? "is-over" : s.warn ? "is-warn" : "";
  const label = t(`caps.slot.${s.period}.${s.unit}` as Key);
  return (
    <div className="cap-meter">
      <div className="meter-head">
        <span>{label}{s.setBy === "operator" && <span className="chip cap-chip">{t("caps.byOperator")}</span>}</span>
        <span className={`cap-figure ${tone}`}>{amount(s.unit, s.used)} / {amount(s.unit, s.limit)}</span>
      </div>
      <div className={`meter ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}><span style={{ width: `${pct}%` }} /></div>
      <p className="field-hint">
        {s.reached ? t(s.mode === "everything" ? "caps.reachedAll" : "caps.reachedUnattended") : s.warn ? t("caps.warnAt", { percent: s.percent }) : t(s.mode === "everything" ? "caps.modeAllShort" : "caps.modeUnattendedShort")}
        {" · "}{t("caps.resets", { when: dateTime(s.resetAt, timezone) })}
      </p>
    </div>
  );
}

/** One period of one row (the account or a bot): its figures, then the bars of its caps for that period. */
function PeriodColumn({ title, used, caps, timezone, extra }: { title: string; used: UsageAmount; caps: CapStateView[]; timezone: string; extra?: ReactNode }) {
  return (
    <div className="caps-period">
      <p className="caps-period-title">{title}</p>
      <p className="caps-figures"><strong>{money(used.usd)}</strong> · {compactNumber(used.tokens)} tokens</p>
      {caps.map((s) => <CapMeter key={s.key} s={s} timezone={timezone} />)}
      {extra}
    </div>
  );
}

function UsageRow({ name, today, month, caps, timezone, extra }: { name: string; today: UsageAmount; month: UsageAmount; caps: CapStateView[]; timezone: string; extra?: ReactNode }) {
  const t = useT();
  return (
    <li className="caps-row">
      <p className="caps-row-name">{name}</p>
      <div className="caps-periods">
        <PeriodColumn title={t("caps.today")} used={today} caps={caps.filter((c) => c.period === "day")} timezone={timezone} />
        <PeriodColumn title={t("caps.thisMonth")} used={month} caps={caps.filter((c) => c.period === "month")} timezone={timezone} extra={extra} />
      </div>
    </li>
  );
}

/**
 * The cap editor: the four caps (day / month × money / tokens) of the account (botId null) or of one bot, or the
 * operator's on a customer (`endpoint` of the administration). Each line saves on its own.
 */
export function CapsEditor({ botId, caps, endpoint = "/usage/caps", onSaved, compact }: { botId: string | null; caps: CapStateView[]; endpoint?: string; onSaved: (r: any) => void; compact?: boolean }) {
  const t = useT();
  return (
    <div className={`caps-editor ${compact ? "is-compact" : ""}`}>
      <div className="caps-editor-head" aria-hidden="true">
        <span>{t("caps.colCap")}</span><span>{t("caps.colLimit")}</span><span>{t("caps.colStops")}</span><span>{t("caps.colWarn")}</span><span />
      </div>
      {SLOTS.map((slot) => <CapLine key={`${slot.period}-${slot.unit}`} slot={slot} botId={botId} cap={caps.find((c) => c.period === slot.period && c.unit === slot.unit) ?? null} endpoint={endpoint} onSaved={onSaved} />)}
    </div>
  );
}

function CapLine({ slot, botId, cap, endpoint, onSaved }: { slot: { period: CapPeriod; unit: CapUnit }; botId: string | null; cap: CapStateView | null; endpoint: string; onSaved: (r: any) => void }) {
  const t = useT();
  const id = useId();
  const [limit, setLimit] = useState(cap ? String(cap.limit) : "");
  const [mode, setMode] = useState<CapMode>(cap?.mode ?? "unattended");
  const [warn, setWarn] = useState(String(cap?.warnPercent ?? 80));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setLimit(cap ? String(cap.limit) : ""); setMode(cap?.mode ?? "unattended"); setWarn(String(cap?.warnPercent ?? 80)); }, [cap?.limit, cap?.mode, cap?.warnPercent]);
  const dirty = limit !== (cap ? String(cap.limit) : "") || (limit !== "" && (mode !== (cap?.mode ?? "unattended") || warn !== String(cap?.warnPercent ?? 80)));
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await api("PUT", endpoint, { botId, period: slot.period, unit: slot.unit, limit: limit.trim() === "" ? null : Number(limit), mode, warnPercent: Number(warn) });
      onSaved(r);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const label = t(`caps.slot.${slot.period}.${slot.unit}` as Key);
  return (
    <div className="caps-line">
      <label className="caps-line-label" htmlFor={`${id}l`}>{label}</label>
      <div className="caps-line-limit">
        <input id={`${id}l`} className="input input-small" type="number" min={0} step={slot.unit === "usd" ? 0.5 : 1000} inputMode="decimal" placeholder={t("caps.none")} value={limit} onChange={(e) => setLimit(e.target.value)} />
        <span className="muted small">{slot.unit === "usd" ? "$" : "tokens"}</span>
      </div>
      <select className="input input-small" aria-label={`${label} — ${t("caps.colStops")}`} value={mode} disabled={limit === ""} onChange={(e) => setMode(e.target.value as CapMode)}>
        <option value="unattended">{t("caps.modeUnattended")}</option>
        <option value="everything">{t("caps.modeAll")}</option>
      </select>
      <div className="caps-line-warn">
        <input className="input input-small" type="number" min={1} max={99} aria-label={`${label} — ${t("caps.colWarn")}`} value={warn} disabled={limit === ""} onChange={(e) => setWarn(e.target.value)} />
        <span className="muted small">%</span>
      </div>
      <div className="caps-line-save">
        <button type="button" className="btn btn-small" disabled={busy || !dirty} onClick={() => void save()}>{t(busy ? "common.saving" : "common.save")}</button>
        {saved && <span className="chip state-ready" role="status">{t("common.saved")}</span>}
      </div>
      {error && <p className="card-error caps-line-error" role="alert">{error}</p>}
    </div>
  );
}

/** Settings → Usage: the bars of today and this month, the account's caps, and how they differ from the other limits. */
export function UsageCapsBlock() {
  const t = useT();
  const tick = useStore((s) => s.usageTick);
  const [view, setView] = useState<UsageCapsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<UsageCapsView>("GET", "/usage/caps").then((v) => !dead && setView(v), (e: unknown) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [tick]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!view) return <Loading />;
  const budget = view.budget.usd !== null && view.budget.usd > 0 ? (() => {
    const pct = Math.min(100, Math.round((view.budget.spentUsd / view.budget.usd!) * 100));
    return (
      <div className="cap-meter">
        <div className="meter-head"><span>{t("caps.budget")}</span><span className={`cap-figure ${pct >= 100 ? "is-over" : pct >= 80 ? "is-warn" : ""}`}>{money(view.budget.spentUsd)} / {money(view.budget.usd!)}</span></div>
        <div className={`meter ${pct >= 100 ? "is-over" : pct >= 80 ? "is-warn" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("caps.budget")}><span style={{ width: `${pct}%` }} /></div>
        <p className="field-hint">{t("caps.budgetHint")} · {t("caps.resets", { when: dateTime(view.budget.resetAt, view.timezone) })}</p>
      </div>
    );
  })() : null;
  const own = view.account.caps.filter((c) => c.setBy === "self");
  return (
    <>
      <h3 className="pane-heading">{t("caps.heading")}</h3>
      <p className="muted small">{t("caps.intro", { tz: view.timezone })}</p>
      <ul className="caps-rows">
        <UsageRow name={t("caps.account")} today={view.account.today} month={view.account.month} caps={view.account.caps} timezone={view.timezone} extra={budget} />
        {view.bots.map((b) => <UsageRow key={b.botId} name={b.name} today={b.today} month={b.month} caps={b.caps} timezone={view.timezone} />)}
      </ul>
      <h4 className="caps-subheading">{t("caps.accountCaps")}</h4>
      <p className="field-hint">{t("caps.editorHint")}</p>
      <CapsEditor botId={null} caps={own} onSaved={(v: UsageCapsView) => setView(v)} />
      <details className="caps-explain">
        <summary>{t("caps.diffTitle")}</summary>
        <ul>
          <li>{t("caps.diffCaps")}</li>
          <li>{t("caps.diffBudget")}</li>
          <li>{t("caps.diffCheckpoint")}</li>
          <li>{t("caps.diffSubscription")}</li>
        </ul>
      </details>
    </>
  );
}

/** In a bot's settings: its own caps (its helpers count with it), with its bars. */
export function BotCapsField({ botId }: { botId: string }) {
  const t = useT();
  const tick = useStore((s) => s.usageTick);
  const [view, setView] = useState<UsageCapsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<UsageCapsView>("GET", "/usage/caps").then(setView, (e: unknown) => setError(errText(e))); }, [tick]);
  const row = view?.bots.find((b) => b.botId === botId);
  return (
    <div className="field">
      <span className="field-label">{t("caps.botHeading")}</span>
      <p className="field-hint">{t("caps.botHint")}</p>
      <ErrorNote>{error}</ErrorNote>
      {!view && !error && <Loading />}
      {view && row && (
        <>
          {row.caps.length > 0 && <div className="caps-bot-meters">{row.caps.map((s) => <CapMeter key={s.key} s={s} timezone={view.timezone} />)}</div>}
          <CapsEditor botId={botId} caps={row.caps} onSaved={(v: UsageCapsView) => setView(v)} compact />
        </>
      )}
    </div>
  );
}

/** Hosted administration: the operator's caps on one customer. */
export function AdminCapsEditor({ uid }: { uid: string }) {
  const t = useT();
  const [caps, setCaps] = useState<CapStateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ caps: CapStateView[] }>("GET", `/admin/customers/${enc(uid)}/caps`).then((r) => setCaps(r.caps), (e: unknown) => setError(errText(e))); }, [uid]);
  return (
    <div className="hosted-box caps-admin">
      <p className="field-label">{t("caps.adminHeading")}</p>
      <p className="muted small">{t("caps.adminHint")}</p>
      <ErrorNote>{error}</ErrorNote>
      {caps && caps.filter((c) => c.reached || c.warn).map((s) => <CapMeter key={s.key} s={s} timezone="UTC" />)}
      {caps && <CapsEditor botId={null} caps={caps} endpoint={`/admin/customers/${enc(uid)}/caps`} onSaved={(r: { caps: CapStateView[] }) => setCaps(r.caps)} compact />}
    </div>
  );
}

/* ---------- The card in the chat ---------- */

export function CapCardView({ card, botId }: { card: Extract<Card, { type: "cap" }>; botId: string }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [raiseTo, setRaiseTo] = useState(String(card.cap.unit === "usd" ? Math.round(card.cap.limit * 200) / 100 : card.cap.limit * 2));
  const act = async (action: "wait" | "continue" | "raise") => {
    setBusy(action); setError(null);
    try { await api("POST", `/usage/caps/stops/${enc(card.stopId)}`, action === "raise" ? { action, limit: Number(raiseTo) } : { action }); setRaising(false); }
    catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const c = card.cap;
  const who = c.setBy === "operator" ? t("caps.whoOperator") : c.botId ? card.botName : t("caps.account");
  const pct = Math.min(100, Math.round((card.used / Math.max(1e-9, c.limit)) * 100));
  const resets = dateTime(card.resetAt, card.timezone);
  return (
    <div className="card cap-card">
      <div className="card-head">
        <span className="logo-tile is-spend" aria-hidden="true"><Icon name="chart" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("caps.cardTitle")}</p>
          <p className="card-sub">{who} · {t(`caps.slot.${c.period}.${c.unit}` as Key)} · {amount(c.unit, card.used)} / {amount(c.unit, c.limit)}</p>
        </div>
      </div>
      <div className="spend-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <p className="card-reason">{t(c.mode === "everything" ? "caps.cardAll" : "caps.cardUnattended", { when: resets, tz: card.timezone })}</p>
      {(card.held > 0 || card.skipped > 0) && (
        <p className="muted small">{[card.held > 0 ? t("caps.held", { n: card.held }) : "", card.skipped > 0 ? t("caps.skipped", { n: card.skipped }) : ""].filter(Boolean).join(" · ")}</p>
      )}
      {card.status === "pending" ? (
        <>
          {raising && (
            <div className="field-inline cap-raise">
              <label className="sr-only" htmlFor={`raise-${card.stopId}`}>{t("caps.raiseTo")}</label>
              <input id={`raise-${card.stopId}`} className="input input-small input-narrow" type="number" min={0} step={c.unit === "usd" ? 0.5 : 1000} value={raiseTo} onChange={(e) => setRaiseTo(e.target.value)} />
              <span className="muted small">{c.unit === "usd" ? "$" : "tokens"}</span>
              <button type="button" className="btn btn-accent btn-small" disabled={busy !== null || !(Number(raiseTo) > c.limit)} onClick={() => void act("raise")}>{t(busy === "raise" ? "common.working" : "caps.raiseConfirm")}</button>
            </div>
          )}
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("wait")} title={t("caps.waitTitle", { when: resets })}>{t("caps.wait")}</button>
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => useStore.getState().openBotSettings(botId, "general")}>{t("caps.switchModel")}</button>
            <span className="spacer" />
            {card.canRaise && !raising && <button type="button" className="btn" disabled={busy !== null} onClick={() => setRaising(true)}>{t("caps.raise")}</button>}
            {card.held > 0 && <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void act("continue")}>{t(busy === "continue" ? "common.working" : "caps.continue")}</button>}
          </div>
          {!card.canRaise && <p className="muted small">{t("caps.operatorNote")}</p>}
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status === "waiting" ? "denied" : "allowed"}`}>
          <Icon name={card.status === "waiting" ? "clock" : "check"} size={14} /> {t(`caps.status.${card.status}` as Key, { when: resets, limit: amount(c.unit, c.limit) })}
        </p>
      )}
    </div>
  );
}
