import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { intlLocale, t } from "../i18n";
import { Field, Modal } from "./ui";
import "./meetingbot.css";

/**
 * L177 « Envoyer le bot dans une réunion » (server meetingbot/routes.ts): the owner pastes a Google Meet, Zoom, Teams
 * or Jitsi link, checks the review card (the link, the name the bot shows, the longest stay, muted, no login, the
 * consent warning), then sends it. While it is there: its state and « Faire partir le bot ». Below: the settings
 * (default longest stay, extra refusal words) and the last meetings.
 */
export type MeetingStatus = "joining" | "lobby" | "live" | "leaving" | "ended" | "failed";
export interface MeetingSessionView { id: string; platform: "meet" | "zoom" | "teams" | "jitsi"; url: string; guestName: string; status: MeetingStatus; reason: string | null; maxMinutes: number; allowPaid: boolean; transcriptFile: string | null; notesFile: string | null; createdAt: number; startedAt: number | null; endedAt: number | null }
export interface MeetingInfo { available: boolean; sessions: MeetingSessionView[]; settings: { maxMinutes: number; words: string[] }; defaults: { words: string[]; min: number; max: number }; name: string }
export interface MeetingReview { platform: string; label: string; url: string; name: string; maxMinutes: number }

const LABEL: Record<MeetingSessionView["platform"], string> = { meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", jitsi: "Jitsi Meet" };
const ACTIVE: MeetingStatus[] = ["joining", "lobby", "live", "leaving"];
const REASONS = ["owner", "refused", "max", "ended", "login", "not_admitted", "no_join", "no_chat", "no_stt", "paid_stt", "error", "interrupted"] as const;
const reasonText = (r: string | null) => (REASONS as readonly string[]).includes(r ?? "") ? t(`meetingbot.reason.${r as (typeof REASONS)[number]}`) : t("meetingbot.reason.ended");
const when = (ms: number) => new Date(ms).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The review card: what the owner approves before the bot goes (also shown in the gallery). */
export function MeetingReviewCard({ review, allowPaid, busy, onSend, onBack }: { review: MeetingReview; allowPaid: boolean; busy: boolean; onSend: () => void; onBack: () => void }) {
  return <section className="mb-review" aria-labelledby="mb-review-title">
    <h3 id="mb-review-title">{t("meetingbot.review.title")}</h3>
    <dl className="mb-facts">
      <dt>{t("meetingbot.review.meeting")}</dt><dd>{review.label}</dd>
      <dt>{t("meetingbot.review.link")}</dt><dd className="mb-url">{review.url}</dd>
      <dt>{t("meetingbot.review.name")}</dt><dd>{review.name}</dd>
      <dt>{t("meetingbot.review.max")}</dt><dd>{t("meetingbot.minutes", { n: review.maxMinutes })}</dd>
    </dl>
    <ul className="mb-rules">
      <li>{t("meetingbot.rule.announce")}</li>
      <li>{t("meetingbot.rule.muted")}</li>
      <li>{t("meetingbot.rule.login")}</li>
      <li>{t("meetingbot.rule.files")}</li>
      {allowPaid && <li>{t("meetingbot.rule.paid")}</li>}
    </ul>
    <p className="mb-warning" role="note">{t("meetingbot.consent")}</p>
    <div className="mb-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onSend}>{busy ? t("meetingbot.sending") : t("meetingbot.send")}</button>
      <button type="button" className="btn" disabled={busy} onClick={onBack}>{t("meetingbot.back")}</button>
    </div>
  </section>;
}

/** One meeting: its state, and « Faire partir le bot » while it is there. */
export function MeetingSessionLine({ s, onLeave, busy }: { s: MeetingSessionView; onLeave?: () => void; busy?: boolean }) {
  const active = ACTIVE.includes(s.status);
  return <div className={`mb-session${active ? " is-active" : ""}`}>
    <div className="mb-session-head">
      <strong>{LABEL[s.platform]}</strong>
      <span className={`mb-badge mb-${s.status}`}>{t(`meetingbot.status.${s.status}`)}</span>
      <span className="mb-when">{when(s.startedAt ?? s.createdAt)}</span>
    </div>
    {active ? <p>{t("meetingbot.live", { name: s.guestName, n: s.maxMinutes })}</p> : <p>{reasonText(s.reason)}</p>}
    {s.notesFile && <p className="mb-file">{t("meetingbot.notesIn", { file: s.notesFile })}</p>}
    {active && onLeave && s.status !== "leaving" && <button type="button" className="btn" disabled={busy} onClick={onLeave}>{t("meetingbot.leave")}</button>}
  </div>;
}

export function MeetingBotDialog({ botId, close }: { botId: string; close: () => void }) {
  const [info, setInfo] = useState<MeetingInfo | null>(null);
  const [url, setUrl] = useState("");
  const [minutes, setMinutes] = useState("");
  const [allowPaid, setAllowPaid] = useState(false);
  const [review, setReview] = useState<MeetingReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [words, setWords] = useState("");
  const [defMinutes, setDefMinutes] = useState("");
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const base = `/bots/${encodeURIComponent(botId)}`;

  const load = async () => {
    const d = await api<MeetingInfo>("GET", `${base}/meeting-bots`);
    if (!alive.current) return;
    setInfo(d);
    setDefMinutes((v) => v || String(d.settings.maxMinutes));
    setWords((v) => v || d.settings.words.join(", "));
  };
  useEffect(() => { alive.current = true; void load().catch((e) => setError(errorText(e))); return () => { alive.current = false; }; }, [botId]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = info?.sessions.find((s) => ACTIVE.includes(s.status)) ?? null;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => void load().catch(() => undefined), 4000);
    return () => window.clearInterval(id);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { if (alive.current) setError(errorText(e)); } finally { if (alive.current) setBusy(false); } };
  const check = () => run(async () => { const r = await api<MeetingReview>("POST", `${base}/meeting-bots/check`, { url, maxMinutes: minutes || undefined }); if (alive.current) setReview(r); });
  const send = () => run(async () => { await api("POST", `${base}/meeting-bots`, { url, maxMinutes: review?.maxMinutes, allowPaid, confirm: true }); if (!alive.current) return; setReview(null); setUrl(""); await load(); });
  const leave = (id: string) => run(async () => { await api("POST", `${base}/meeting-bots/${encodeURIComponent(id)}/leave`); await load(); });
  const saveSettings = () => run(async () => {
    const list = words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
    const r = await api<{ settings: MeetingInfo["settings"] }>("PUT", `${base}/meeting-bot-settings`, { maxMinutes: Number(defMinutes), words: list });
    if (!alive.current) return;
    setInfo((i) => (i ? { ...i, settings: r.settings } : i)); setSaved(true); window.setTimeout(() => alive.current && setSaved(false), 2500);
  });

  const past = (info?.sessions ?? []).filter((s) => s !== active).slice(0, 5);
  return <Modal title={t("meetingbot.title")} onClose={close} size="md">
    <div className="mb-body">
      <p>{t("meetingbot.intro")}</p>
      {info && !info.available && <p className="mb-warning" role="note">{t("meetingbot.unavailable")}</p>}
      {active && <MeetingSessionLine s={active} busy={busy} onLeave={() => void leave(active.id)} />}
      {info?.available && !active && (review
        ? <MeetingReviewCard review={review} allowPaid={allowPaid} busy={busy} onSend={() => void send()} onBack={() => setReview(null)} />
        : <form className="mb-form" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void check(); }}>
          <Field label={t("meetingbot.link")} htmlFor="mb-url" hint={t("meetingbot.linkHint")}>
            <input id="mb-url" className="input" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" />
          </Field>
          <Field label={t("meetingbot.max")} htmlFor="mb-min" hint={t("meetingbot.maxHint", { min: info.defaults.min, max: info.defaults.max, n: info.settings.maxMinutes })}>
            <input id="mb-min" className="input mb-num" type="number" min={info.defaults.min} max={info.defaults.max} value={minutes} placeholder={String(info.settings.maxMinutes)} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <label className="mb-check"><input type="checkbox" checked={allowPaid} onChange={(e) => setAllowPaid(e.target.checked)} /> {t("meetingbot.allowPaid")}</label>
          <p className="mb-warning" role="note">{t("meetingbot.consent")}</p>
          <div className="mb-actions"><button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>{t("meetingbot.check")}</button></div>
        </form>)}
      {error && <p className="mb-error" role="alert">{error}</p>}
      {info?.available && <details className="mb-settings">
        <summary>{t("meetingbot.settings")}</summary>
        <Field label={t("meetingbot.defaultMax")} htmlFor="mb-defmin">
          <input id="mb-defmin" className="input mb-num" type="number" min={info.defaults.min} max={info.defaults.max} value={defMinutes} onChange={(e) => setDefMinutes(e.target.value)} />
        </Field>
        <Field label={t("meetingbot.words")} htmlFor="mb-words" hint={t("meetingbot.wordsHint", { list: info.defaults.words.slice(0, 6).join(", ") })}>
          <input id="mb-words" className="input" value={words} onChange={(e) => setWords(e.target.value)} placeholder={t("meetingbot.wordsPlaceholder")} />
        </Field>
        <div className="mb-actions"><button type="button" className="btn" disabled={busy} onClick={() => void saveSettings()}>{t("meetingbot.save")}</button>{saved && <span role="status">{t("meetingbot.saved")}</span>}</div>
      </details>}
      {past.length > 0 && <section className="mb-past"><h3>{t("meetingbot.past")}</h3>{past.map((s) => <MeetingSessionLine key={s.id} s={s} />)}</section>}
    </div>
  </Modal>;
}
