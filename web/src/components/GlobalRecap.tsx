import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { tn, useT } from "../i18n";
import { relTime } from "../lib/format";
import { useStore } from "../store";
import type { GlobalRecap, GlobalRecapBot } from "../types";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { CopyButton, ErrorNote, Loading } from "./ui";
import "../styles/finishing.css";

/**
 * L161 « récapitulatif global » (page Aujourd'hui): one recap of every bot over the last 7 or 30 days (server
 * globalrecap.ts) — what each finished, what waits, the goals still open, and first the bots left aside (open goals,
 * nothing for 14 days). The same text a bot gets from its global_recap tool can be copied.
 */
const SPANS = [7, 30] as const;

function RecapBot({ b }: { b: GlobalRecapBot }) {
  const t = useT();
  const bot = useStore((s) => s.bots[b.botId]);
  return (
    <li className={`recap-bot ${b.dormant ? "is-dormant" : ""}`}>
      <span className="recap-bot-avatar">{bot ? <BotAvatar bot={bot} size={26} /> : <Icon name="user" size={18} />}</span>
      <span className="recap-bot-name">
        {bot ? <button type="button" className="link" onClick={() => useStore.getState().selectBot(bot.id)}>{b.botName}</button> : b.botName}
        {b.dormant && <span className="chip state-waiting">{t("recap.dormant")}</span>}
        {b.shared && <span className="chip">{t("today.shared")}</span>}
      </span>
      <span className="recap-bot-line">
        {[tn("recap.finished", b.finished), b.waiting ? tn("recap.waiting", b.waiting) : "", b.lastActiveAt ? t("recap.lastActive", { when: relTime(b.lastActiveAt) }) : t("recap.never")].filter(Boolean).join(" · ")}
      </span>
      {(b.highlights[0] || b.openGoals[0]) && (
        <span className="recap-bot-line">{b.openGoals[0] ? t("recap.goal", { goal: b.openGoals[0] }) : t("recap.latest", { title: b.highlights[0] })}</span>
      )}
    </li>
  );
}

export function GlobalRecapBlock({ initial }: { initial?: GlobalRecap }) {
  const t = useT();
  const id = useId();
  const [days, setDays] = useState<number>(initial?.days ?? 7);
  const [recap, setRecap] = useState<GlobalRecap | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial && days === initial.days) return;
    let live = true;
    setRecap(null);
    api<GlobalRecap>("GET", `/recap?days=${days}`).then((r) => { if (live) setRecap(Array.isArray(r?.bots) ? r : { days, start: 0, end: 0, generatedAt: 0, totals: { finished: 0, minutes: 0, waiting: 0, bots: 0, dormant: 0 }, bots: [], text: "" }); }, (e: unknown) => { if (live) setError(errText(e)); });
    return () => { live = false; };
  }, [days, initial]);
  const shown = recap?.bots.filter((b) => b.finished || b.waiting || b.dormant || b.openGoals.length) ?? [];
  return (
    <section className="today-block recap-block" aria-labelledby={id}>
      <header className="today-block-head">
        <Icon name="users" size={17} />
        <h2 id={id}>{t("recap.title")}</h2>
        <div className="segmented recap-days" role="group" aria-label={t("recap.period")}>
          {SPANS.map((n) => (
            <button key={n} type="button" className={days === n ? "is-active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>{t("recap.days", { n })}</button>
          ))}
        </div>
      </header>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!recap && !error && <Loading />}
      {recap && (
        <>
          <p className="muted small">{t("recap.summary", { finished: recap.totals.finished, waiting: recap.totals.waiting, dormant: recap.totals.dormant, bots: recap.totals.bots })}</p>
          {shown.length === 0 ? <p className="muted small">{t("recap.empty")}</p> : <ul className="recap-list">{shown.map((b) => <RecapBot key={b.botId} b={b} />)}</ul>}
          <div className="recap-foot">
            <CopyButton text={recap.text} label={t("recap.copy")} />
            <span className="muted">{t("recap.hint")}</span>
          </div>
        </>
      )}
    </section>
  );
}
