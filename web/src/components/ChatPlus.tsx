import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { money, relTime } from "../lib/format";
import { useStore } from "../store";
import type { Bot, PollCard, ViewCard } from "../types";
import { firstLink, myChoices, nextChoice, pollResults } from "../../../mobile/shared/chatPlus";
import { Icon } from "./Icon";
import { ErrorNote, IconButton, Modal } from "./ui";
import { ViewCardView } from "./ViewCard";
import "./ChatPlus.css";

/**
 * L184 (non-paid parts) in the web app:
 *  - PollCardView / PollCreatorHost: « Sondage » from the composer's menu; the card in the chat or the group, the owner
 *    votes with a tap, the bots with poll_vote (server polls.ts).
 *  - PinViewButton / PinnedDashboard: a view drawn in the chat pinned to « Aujourd'hui »; the pin follows the newest
 *    view with the same title (server dashboardpins.ts).
 *  - LinkPreview: under a message, the title and description of its first web address, read by the server (no picture,
 *    private addresses refused: server linkpreview.ts).
 *  - AppEventsSection: the apps' own notices in the bot's Activity tab (server appevents.ts).
 *  - UsageMetricsPanel: the account's numbers (server metrics.ts).
 */

/* ---------- Polls ---------- */

export function PollCardView({ card }: { card: PollCard }) {
  const t = useT();
  const me = useStore((s) => s.user?.id ?? "");
  const [poll, setPoll] = useState(card);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPoll(card), [card]);
  const mine = myChoices(poll, `user:${me}`);
  const send = async (path: string, payload?: unknown) => {
    setBusy(true); setError(null);
    try { const r = await api<{ poll?: PollCard }>("POST", `/polls/${enc(poll.pollId)}/${path}`, payload); if (r?.poll) setPoll(r.poll); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const open = poll.status === "open";
  return (
    <div className="card poll-card" role="group" aria-label={poll.question}>
      <div className="card-head">
        <span className="view-card-icon" aria-hidden="true"><Icon name="chart" size={16} /></span>
        <div className="card-head-text">
          <div className="card-title">{poll.question}</div>
          <div className="card-sub">{t(poll.multi ? "poll.multi" : "poll.single")} · {t(open ? "poll.open" : "poll.closed")} · {t("poll.voters", { n: poll.votes.length })}</div>
        </div>
      </div>
      <ul className="poll-options">
        {pollResults(poll).map((r, i) => (
          <li key={i}>
            <button type="button" className={`poll-option${mine.includes(i) ? " is-mine" : ""}`} aria-pressed={mine.includes(i)} disabled={!open || busy} onClick={() => void send("vote", { choices: nextChoice(poll, mine, i) })}>
              <span className="poll-bar" style={{ width: `${r.pct}%` }} aria-hidden="true" />
              <span className="poll-label">{mine.includes(i) && <Icon name="check" size={13} />} {r.label}</span>
              <span className="poll-count">{r.count} · {r.pct} %</span>
            </button>
            {r.names.length > 0 && <span className="poll-names">{r.names.join(", ")}</span>}
          </li>
        ))}
      </ul>
      {poll.votes.some((v) => v.reason) && <ul className="poll-reasons">{poll.votes.filter((v) => v.reason).map((v) => <li key={v.by}><strong>{v.name}</strong> : {v.reason}</li>)}</ul>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {open && <div className="card-actions"><button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void send("close")}>{t("poll.close")}</button></div>}
    </div>
  );
}

let creatorFor: string | null = null;
const creatorListeners = new Set<() => void>();
/** Opens the « Sondage » window for this chat (the composer's menu). */
export function openPollCreator(botId: string) { creatorFor = botId; creatorListeners.forEach((f) => f()); }
const closeCreator = () => { creatorFor = null; creatorListeners.forEach((f) => f()); };

export function PollCreatorHost({ botId, thread = 0 }: { botId: string; thread?: number }) {
  const open = useSyncExternalStore((f) => { creatorListeners.add(f); return () => { creatorListeners.delete(f); }; }, () => creatorFor === botId);
  return open ? <PollCreator botId={botId} thread={thread} /> : null;
}

function PollCreator({ botId, thread }: { botId: string; thread: number }) {
  const t = useT();
  const id = useId();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = options.filter((o) => o.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api("POST", `/bots/${enc(botId)}/polls`, { question, options: filled, multi, thread }); closeCreator(); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={t("poll.new")} onClose={closeCreator} size="md">
      <form className="modal-body poll-form" onSubmit={submit}>
        <p className="muted">{t("poll.newHint")}</p>
        <div className="field"><label className="field-label" htmlFor={`${id}-q`}>{t("poll.question")}</label><input id={`${id}-q`} className="input" value={question} maxLength={300} autoFocus onChange={(e) => setQuestion(e.target.value)} /></div>
        {options.map((o, i) => (
          <div key={i} className="field poll-form-option">
            <label className="field-label" htmlFor={`${id}-o${i}`}>{t("poll.option", { n: i + 1 })}</label>
            <div className="field-inline">
              <input id={`${id}-o${i}`} className="input" value={o} maxLength={120} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              {options.length > 2 && <IconButton icon="close" size={14} label={t("poll.removeOption", { n: i + 1 })} onClick={() => setOptions(options.filter((_, j) => j !== i))} />}
            </div>
          </div>
        ))}
        {options.length < 10 && <button type="button" className="btn btn-small btn-ghost" onClick={() => setOptions([...options, ""])}><Icon name="plus" size={13} /> {t("poll.addOption")}</button>}
        <label className="check-row"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> {t("poll.allowMulti")}</label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={closeCreator}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-accent" disabled={busy || !question.trim() || filled.length < 2}>{t("poll.post")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Pinned dashboard ---------- */

export function PinViewButton({ botId, seq }: { botId: string; seq: number }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-small btn-ghost" disabled={done} onClick={async () => {
      try { await api("POST", `/bots/${enc(botId)}/cards/${seq}/pin`); setDone(true); useStore.getState().showToast(t("dash.pinned")); } catch (e) { useStore.getState().showToast(errText(e)); }
    }}><Icon name="pin" size={13} /> {t(done ? "dash.pinnedShort" : "dash.pin")}</button>
  );
}

interface Pin { id: string; botId: string; botName: string; title: string; seq: number; updatedAt: number; card: ViewCard | null }

export function PinnedDashboard({ start }: { /** Gallery: fixed pins, no server call. */ start?: Pin[] }) {
  const t = useT();
  const [pins, setPins] = useState<Pin[] | null>(start ?? null);
  useEffect(() => { if (!start) api<{ pins: Pin[] }>("GET", "/dashboard/pins").then((r) => setPins(r.pins), () => setPins([])); }, [start]);
  const act = async (method: "DELETE" | "POST", path: string, payload?: unknown) => {
    try { setPins((await api<{ pins: Pin[] }>(method, path, payload)).pins); } catch (e) { useStore.getState().showToast(errText(e)); }
  };
  if (!pins?.length) return null;
  return (
    <section className="dash" aria-labelledby="dash-title">
      <h2 id="dash-title" className="dash-title"><Icon name="pin" size={15} /> {t("dash.title")}</h2>
      <div className="dash-grid">
        {pins.map((p, i) => (
          <div key={p.id} className="dash-item">
            <div className="dash-item-head">
              <span className="muted small">{t("dash.from", { bot: p.botName, when: relTime(p.updatedAt) })}</span>
              <span className="dash-item-tools">
                {i > 0 && <IconButton icon="arrowUp" size={14} label={t("dash.up", { title: p.title })} onClick={() => void act("POST", `/dashboard/pins/${enc(p.id)}/move`, { dir: -1 })} />}
                {i < pins.length - 1 && <IconButton icon="arrowDown" size={14} label={t("dash.down", { title: p.title })} onClick={() => void act("POST", `/dashboard/pins/${enc(p.id)}/move`, { dir: 1 })} />}
                <IconButton icon="close" size={14} label={t("dash.unpin", { title: p.title })} onClick={() => void act("DELETE", `/dashboard/pins/${enc(p.id)}`)} />
              </span>
            </div>
            {p.card ? <ViewCardView card={p.card} botId={p.botId} seq={p.seq} pinned /> : <p className="muted small">{t("dash.gone", { title: p.title })}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Link preview ---------- */

interface Preview { url: string; host: string; title: string; description: string; siteName: string }
const previews = new Map<string, Promise<Preview | null>>();
const fetchPreview = (url: string) => {
  let p = previews.get(url);
  if (!p) { p = api<{ preview: Preview | null }>("GET", `/link-preview?url=${encodeURIComponent(url)}`).then((r) => r.preview ?? null, () => null); previews.set(url, p); }
  return p;
};

export function LinkPreview({ text, start }: { text: string; /** Gallery: a fixed preview. */ start?: Preview }) {
  const url = start ? start.url : firstLink(text);
  const [p, setP] = useState<Preview | null>(start ?? null);
  useEffect(() => {
    if (start || !url) return;
    let live = true;
    void fetchPreview(url).then((v) => { if (live) setP(v); });
    return () => { live = false; };
  }, [url, start]);
  if (!p) return null;
  return (
    <a className="link-preview" href={p.url} target="_blank" rel="noopener noreferrer nofollow">
      <span className="link-preview-site"><Icon name="globe" size={12} /> {p.siteName}</span>
      <span className="link-preview-title">{p.title}</span>
      {p.description && <span className="link-preview-desc">{p.description}</span>}
    </a>
  );
}

/* ---------- Apps' own notices ---------- */

interface AppEvent { id: number; connectorId: string; name: string; kind: "log" | "tools" | "resource" | "resources" | "prompts"; level: string; text: string; at: number }

export function AppEventsSection({ bot, start }: { bot: Bot; start?: AppEvent[] }) {
  const t = useT();
  const [events, setEvents] = useState<AppEvent[] | null>(start ?? null);
  useEffect(() => { if (!start) api<{ events: AppEvent[] }>("GET", `/bots/${enc(bot.id)}/app-events`).then((r) => setEvents(r.events), () => setEvents([])); }, [bot.id, start]);
  if (!events?.length) return null;
  return (
    <section className="details-section app-events" aria-labelledby={`appev-${bot.id}`}>
      <h3 id={`appev-${bot.id}`} className="details-heading"><Icon name="plug" size={14} /> {t("appEvents.title")}</h3>
      <p className="field-hint">{t("appEvents.hint")}</p>
      <ul className="app-events-list">
        {events.slice(0, 20).map((e) => (
          <li key={e.id}>
            <span className={`chip${e.level === "error" || e.level === "critical" || e.level === "warning" ? " state-needs_auth" : ""}`}>{e.name}</span>{" "}
            <span>{e.kind === "log" ? e.text : t(`appEvents.kind.${e.kind}` as Key, { text: e.text })}</span>{" "}
            <span className="muted small">{relTime(e.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Metrics ---------- */

interface Metrics { bots: number; rooms: number; connectors: number; messages: { user: number; assistant: number }; messages24h: number; tokens: { input: number; output: number; cached: number }; costUsd: number; costUsd30d: number; tokens24h: number; approvalsPending: number; routineRuns: { ok: number; failed: number; other: number } }

export function UsageMetricsPanel({ start }: { start?: Metrics }) {
  const t = useT();
  const [m, setM] = useState<Metrics | null>(start ?? null);
  useEffect(() => { if (!start) api<{ metrics: Metrics }>("GET", "/usage-metrics").then((r) => setM(r.metrics), () => setM(null)); }, [start]);
  if (!m) return null;
  const n = (v: number) => v.toLocaleString(document.documentElement.lang || undefined);
  const items: [Key, string, string][] = [
    ["metrics.bots", n(m.bots), t("metrics.groups", { n: m.rooms })],
    ["metrics.messages", n(m.messages.user + m.messages.assistant), t("metrics.last24h", { n: n(m.messages24h) })],
    ["metrics.tokens", n(m.tokens.input + m.tokens.output), t("metrics.last24h", { n: n(m.tokens24h) })],
    ["metrics.cost", money(m.costUsd), t("metrics.last30d", { v: money(m.costUsd30d) })],
    ["metrics.routines", n(m.routineRuns.ok), t("metrics.runs", { ok: n(m.routineRuns.ok), failed: n(m.routineRuns.failed) })],
    ["metrics.waiting", n(m.approvalsPending), ""],
    ["metrics.apps", n(m.connectors), ""],
  ];
  return (
    <section className="usage-metrics" aria-labelledby="metrics-title">
      <h3 id="metrics-title" className="pane-heading">{t("metrics.title")}</h3>
      <dl className="view-stats">
        {items.map(([k, v, sub]) => <div key={k} className="view-stat"><dt>{t(k)}</dt><dd>{v}</dd>{sub && <span className="view-stat-hint">{sub}</span>}</div>)}
      </dl>
      <p className="field-hint">{t("metrics.hint")}</p>
    </section>
  );
}
