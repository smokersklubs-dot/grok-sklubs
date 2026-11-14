import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { enc } from "../api";
import { t, tn, useT, type Key } from "../i18n";
import { useStore, type Thread } from "../store";
import type { ActivityKind, Attachment, Bot, Live, Origin, Row, RowBody } from "../types";
import { callClock, clockTime, dividerLabel, elapsed, fileSize, hostName, workDuration } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { Avatar, BotAvatar } from "./Avatar";
import { CardView } from "./Cards";
import { Icon, Spinner } from "./Icon";
import { IconButton, useDialogFocus, useEscape, useTick } from "./ui";

type MessageBody = Extract<RowBody, { kind: "message" }>;
type StepBody = Extract<RowBody, { kind: "step" }>;
type EventBody = Extract<RowBody, { kind: "event" }>;

export type Item =
  | { t: "divider"; key: string; label: string }
  | { t: "msgs"; key: string; sender: string; mine: boolean; origin?: Origin; role: "user" | "assistant"; rows: Row[] }
  | { t: "steps"; key: string; rows: Row[] }
  /** A finished turn's steps and in-between messages, folded into one "Worked for …" chip. */
  | { t: "work"; key: string; rows: Row[]; ms: number; steps: number }
  | { t: "row"; key: string; row: Row };

const HOUR = 3_600_000;
const GROUP_WINDOW = 5 * 60_000;

function isMine(b: MessageBody): boolean {
  return b.role === "user" && (!b.origin || b.origin.kind === "voice");
}

function senderKey(b: MessageBody): string {
  return `${b.role}:${b.origin ? `${b.origin.kind}:${b.origin.id}` : ""}`;
}

function shown(row: Row, running: boolean): boolean {
  const b = row.body;
  if (b.kind === "message" && !b.text.trim() && !b.streaming && !b.attachments?.length) return false;
  if (b.kind === "step" && running && b.status === "running") return false;
  return true;
}

type WorkChip = { rows: Row[]; ms: number; steps: number };

/**
 * Finished turns fold their steps, and the bot's messages before its final reply, into one chip
 * placed just before that reply. A turn starts at a user message. The turn still running (the
 * latest one while the bot works) is left as it is, so its steps show live.
 * Returns the row indexes that fold away and, by row index, the chips to place there.
 */
function planWork(rows: Row[], running: boolean): { folded: Set<number>; chips: Map<number, WorkChip> } {
  const folded = new Set<number>();
  const chips = new Map<number, WorkChip>();
  const turn = (s: number, e: number) => {
    if (s >= e || (running && e === rows.length)) return;
    let final = -1;
    for (let i = e - 1; i >= s; i--) {
      const b = rows[i].body;
      if (b.kind === "message" && b.role === "assistant" && shown(rows[i], running)) {
        final = i;
        break;
      }
    }
    const finalBody = final >= 0 ? (rows[final].body as MessageBody) : null;
    if (finalBody?.streaming) return;
    const picked: number[] = [];
    let steps = 0;
    for (let i = s; i < e; i++) {
      if (i === final || !shown(rows[i], running)) continue;
      const b = rows[i].body;
      if (b.kind === "step") {
        picked.push(i);
        steps++;
      } else if (finalBody && b.kind === "message" && b.role === "assistant" && i < final && senderKey(b) === senderKey(finalBody)) {
        // In a room only the replying bot's own earlier messages fold; other bots' replies stay visible.
        picked.push(i);
      }
    }
    if (steps === 0) return;
    const head = rows[s].body;
    const from = head.kind === "message" && head.role === "user" ? rows[s] : rows[picked[0]];
    const to = final >= 0 ? rows[final] : rows[picked[picked.length - 1]];
    for (const i of picked) folded.add(i);
    chips.set(final >= 0 ? final : picked[0], { rows: picked.map((i) => rows[i]), ms: to.createdAt - from.createdAt, steps });
  };
  let start = 0;
  rows.forEach((row, i) => {
    const b = row.body;
    if (i > start && b.kind === "message" && b.role === "user") {
      turn(start, i);
      start = i;
    }
  });
  turn(start, rows.length);
  return { folded, chips };
}

export function buildItems(rows: Row[], running: boolean): Item[] {
  const items: Item[] = [];
  const { folded, chips } = planWork(rows, running);
  let prevAt: number | null = null;
  const stamp = (at: number, seq: number) => {
    if (prevAt === null || at - prevAt > HOUR) {
      items.push({ t: "divider", key: `d${seq}`, label: dividerLabel(at) });
    }
    prevAt = at;
  };
  rows.forEach((row, index) => {
    const chip = chips.get(index);
    if (chip) {
      const first = chip.rows[0];
      stamp(first.createdAt, first.seq);
      items.push({ t: "work", key: `w${first.seq}`, ...chip });
      prevAt = chip.rows[chip.rows.length - 1].createdAt;
    }
    if (folded.has(index) || !shown(row, running)) return;
    const b = row.body;
    stamp(row.createdAt, row.seq);
    const last = items[items.length - 1];
    if (b.kind === "step") {
      if (last?.t === "steps") last.rows.push(row);
      else items.push({ t: "steps", key: `s${row.seq}`, rows: [row] });
    } else if (b.kind === "message") {
      const sender = senderKey(b);
      const lastRow = last?.t === "msgs" ? last.rows[last.rows.length - 1] : null;
      if (last?.t === "msgs" && last.sender === sender && lastRow && row.createdAt - lastRow.createdAt <= GROUP_WINDOW) {
        last.rows.push(row);
      } else {
        items.push({ t: "msgs", key: `m${row.seq}`, sender, mine: isMine(b), origin: b.origin, role: b.role, rows: [row] });
      }
    } else {
      items.push({ t: "row", key: `r${row.seq}`, row });
    }
  });
  return items;
}

/* ---------- Messages ---------- */

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

function SenderLabel({ origin, role }: { origin: Origin; role: "user" | "assistant" }) {
  const bots = useStore((s) => s.bots);
  const t = useT();
  if (origin.kind === "bot") {
    const b = bots[origin.id];
    return (
      <div className="sender">
        {b ? <BotAvatar bot={b} size={18} /> : <Avatar shape="circle" color="slate" name={origin.name} size={18} />}
        <span>{role === "user" ? t("msg.from", { name: origin.name }) : origin.name}</span>
      </div>
    );
  }
  if (origin.kind === "routine") {
    return (
      <div className="sender">
        <Icon name="clock" size={14} />
        <span>{t("msg.routine", { name: origin.name })}</span>
      </div>
    );
  }
  if (origin.kind === "webhook") {
    return (
      <div className="sender">
        <Icon name="hook" size={14} />
        <span>{t("msg.webhook", { name: origin.name })}</span>
      </div>
    );
  }
  return (
    <div className="sender">
      <Icon name="wave" size={14} />
      <span>{t("msg.voice")}</span>
    </div>
  );
}

/* ---------- Attachments ---------- */

const viewUrl = (botId: string, path: string) => `/api/bots/${botId}/files/view?path=${enc(path)}`;
const downloadUrl = (botId: string, path: string) => `/api/bots/${botId}/files/download?path=${enc(path)}`;

/** Full-window view of one image. Escape or a click outside the picture closes it. */
function Lightbox({ botId, file, onClose }: { botId: string; file: Attachment; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const t = useT();
  useEscape(onClose);
  useDialogFocus(root);
  const closeOnBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };
  return (
    <div className="lightbox" ref={root} role="dialog" aria-modal="true" aria-label={t("attach.viewer")} tabIndex={-1} onMouseDown={closeOnBackdrop}>
      <header className="lightbox-bar">
        <span className="lightbox-name truncate">{file.name}</span>
        <a className="btn btn-small" href={downloadUrl(botId, file.path)} download={file.name}>
          <Icon name="download" size={14} /> {t("attach.download")}
        </a>
        <IconButton icon="close" label={t("common.close")} onClick={onClose} />
      </header>
      <div className="lightbox-stage" onMouseDown={closeOnBackdrop}>
        <img src={viewUrl(botId, file.path)} alt={file.name} />
      </div>
    </div>
  );
}

function Attachments({ botId, files }: { botId: string; files: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  const t = useT();
  const images = files.filter((f) => f.mime.startsWith("image/"));
  const others = files.filter((f) => !f.mime.startsWith("image/"));
  return (
    <div className="attachments">
      {images.map((f) => (
        <button key={f.path} type="button" className="attach-image" onClick={() => setOpen(f)} aria-label={t("attach.open", { name: f.name })} title={f.name}>
          <img src={viewUrl(botId, f.path)} alt={f.name} loading="lazy" />
        </button>
      ))}
      {others.map((f) => (
        <a key={f.path} className="attach-file" href={downloadUrl(botId, f.path)} download={f.name} title={t("attach.downloadName", { name: f.name })}>
          <span className="attach-file-icon">
            <Icon name="file" size={18} />
          </span>
          <span className="attach-file-text">
            <span className="attach-file-name truncate">{f.name}</span>
            <span className="attach-file-size">{fileSize(f.size)}</span>
          </span>
          <Icon name="download" size={15} className="attach-file-dl" />
        </a>
      ))}
      {open && <Lightbox botId={botId} file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MessageGroup({ item }: { item: Extract<Item, { t: "msgs" }> }) {
  const n = item.rows.length;
  const t = useT();
  return (
    <div className={`group ${item.mine ? "is-mine" : "is-theirs"}`}>
      {item.origin && <SenderLabel origin={item.origin} role={item.role} />}
      {item.rows.map((row, i) => {
        const b = row.body as MessageBody;
        const pos = n === 1 ? "only" : i === 0 ? "first" : i === n - 1 ? "last" : "mid";
        return (
          <div key={row.seq} className={`msg is-${pos}`} data-seq={row.seq}>
            {b.attachments && b.attachments.length > 0 && <Attachments botId={row.botId} files={b.attachments} />}
            {(b.text.trim() || b.streaming) && (
              <div className={`bubble ${b.streaming ? "is-streaming" : ""}`}>
                {item.mine ? <p className="plain">{b.text}</p> : <Markdown text={b.text} />}
                {b.streaming && <span className="stream-dots" aria-label={t("msg.stillWriting")}><i /><i /><i /></span>}
              </div>
            )}
            <time className="msg-time" dateTime={new Date(row.createdAt).toISOString()}>{clockTime(row.createdAt)}</time>
            {b.sources && b.sources.length > 0 && (
              <div className="sources">
                {b.sources.slice(0, 6).map((s, j) => (
                  <a key={j} className="chip chip-link" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title ?? s.url}>
                    <Icon name="globe" size={12} />
                    {hostName(s.url)}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Steps ---------- */

const STEP_MARK: Partial<Record<StepBody["status"], Key>> = { error: "step.mark.error", denied: "step.mark.denied", waiting: "step.mark.waiting", running: "step.mark.running" };

function StepLine({ seq, body }: { seq: number; body: StepBody }) {
  const t = useT();
  const mark = STEP_MARK[body.status];
  return (
    <li className="step" title={body.tool} data-seq={seq}>
      <span className={`dot-inline dot-step-${body.status}`} />
      <div className="step-text">
        <span className="step-label">
          {body.label || body.tool}
          {mark && <span className={`step-mark is-${body.status}`}>{t(mark)}</span>}
        </span>
        {body.summary && <span className="step-summary">{body.summary}</span>}
      </div>
    </li>
  );
}

const hasProblem = (rows: Row[]) => rows.some((r) => r.body.kind === "step" && (r.body.status === "error" || r.body.status === "denied"));

/** The steps of the turn still running: a compact toggle with the latest step. */
function StepGroup({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const problem = hasProblem(rows);
  const last = rows[rows.length - 1].body as StepBody;
  return (
    <div className="steps">
      <button type="button" className="steps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="chevronRight" size={14} className={open ? "is-rotated" : ""} />
        <span>{tn("count.step", rows.length)}</span>
        {!open && <span className="steps-last truncate">{last.label}</span>}
        {problem && !open && <span className="dot-inline dot-error" title={t("step.problem")} />}
      </button>
      {open && (
        <ol className="steps-list">
          {rows.map((r) => <StepLine key={r.seq} seq={r.seq} body={r.body as StepBody} />)}
        </ol>
      )}
    </div>
  );
}

/** A finished turn's work: "Worked for 2 min 10 s · 7 steps". Opens into the steps and in-between messages. */
function WorkGroup({ item }: { item: Extract<Item, { t: "work" }> }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const botId = item.rows[0].botId;
  // A search hit inside the folded rows opens the chip, so the message is on the page to scroll to.
  const jumpSeq = useStore((s) => (s.jump?.botId === botId ? s.jump.seq : null));
  if (!open && jumpSeq !== null && item.rows.some((r) => r.seq === jumpSeq)) setOpen(true);
  const problem = hasProblem(item.rows);
  return (
    <div className="steps work">
      <button type="button" className="steps-toggle work-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="chevronRight" size={14} className={open ? "is-rotated" : ""} />
        <span>{t("work.summary", { time: workDuration(item.ms), steps: tn("count.step", item.steps) })}</span>
        {problem && !open && <span className="dot-inline dot-error" title={t("step.problem")} />}
      </button>
      {open && (
        <ol className="steps-list">
          {item.rows.map((r) => {
            const b = r.body;
            if (b.kind === "step") return <StepLine key={r.seq} seq={r.seq} body={b} />;
            if (b.kind !== "message") return null;
            return (
              <li key={r.seq} className="step work-note" data-seq={r.seq}>
                <Icon name="chat" size={13} className="work-note-icon" />
                <div className="step-text">
                  {b.attachments && b.attachments.length > 0 && <Attachments botId={r.botId} files={b.attachments} />}
                  {b.text.trim() && <Markdown text={b.text} />}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ---------- Events and notices ---------- */

function EventRow({ body, botName, seq }: { body: EventBody; botName: string; seq: number }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const call = body.call;
  const lines = call?.transcript ?? [];
  if (body.event === "cheer") {
    // The bot celebrated a gem it found (its character went wild at the same moment).
    return (
      <div className="event is-cheer" data-seq={seq}>
        <span className="event-line">
          <span className="cheer-spark" aria-hidden="true">
            <Icon name="star" size={13} />
          </span>
          <span className="cheer-text">{t("event.cheer", { reason: body.text })}</span>
        </span>
      </div>
    );
  }
  if (body.event !== "call") {
    return (
      <div className="event" data-seq={seq}>
        <span>{body.text}</span>
      </div>
    );
  }
  const ended = call?.phase === "ended" && typeof call.durationMs === "number";
  return (
    <div className="event is-call" data-seq={seq}>
      <span className="event-line">
        <Icon name="phone" size={13} />
        <span>{body.text}</span>
        {ended && (
          <span className="event-duration" title={t("event.callDuration")}>
            <span className="sr-only">{t("event.callDuration")} </span>
            {callClock(call?.durationMs ?? 0)}
          </span>
        )}
      </span>
      {call?.summary && <span className="event-summary">{call.summary}</span>}
      {lines.length > 0 && (
        <>
          <button type="button" className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {t(open ? "event.hideTranscript" : "event.showTranscript")}
          </button>
          {open && (
            <div className="event-transcript">
              {lines.map((l, i) => (
                <p key={i}>
                  <b>{l.role === "user" ? t("common.you") : botName}</b> {l.text}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The rows of a conversation, already grouped. `readOnly` is for earlier conversations: cards can't be answered. */
export function RowItems({ items, bot, readOnly }: { items: Item[]; bot: Bot; readOnly?: boolean }) {
  return (
    <>
      {items.map((item) => {
        switch (item.t) {
          case "divider":
            return <div key={item.key} className="divider"><span>{item.label}</span></div>;
          case "msgs":
            return <MessageGroup key={item.key} item={item} />;
          case "steps":
            return <StepGroup key={item.key} rows={item.rows} />;
          case "work":
            return <WorkGroup key={item.key} item={item} />;
          case "row": {
            const b = item.row.body;
            if (b.kind === "card") {
              const card = <CardView key={item.key} card={b.card} botId={bot.id} seq={item.row.seq} />;
              return readOnly ? <div key={item.key} inert>{card}</div> : card;
            }
            if (b.kind === "event") return <EventRow key={item.key} body={b} botName={bot.name} seq={item.row.seq} />;
            if (b.kind === "notice") return <div key={item.key} className={`notice is-${b.tone}`}><span>{b.text}</span></div>;
            return null;
          }
        }
      })}
    </>
  );
}

/** Scroll one message into view and flash it. Returns false when it isn't on the page. */
export function revealRow(root: HTMLElement | null, seq: number): boolean {
  const el = root?.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  el.classList.remove("is-flash");
  void el.offsetWidth; // restart the animation when the same row is revealed twice
  el.classList.add("is-flash");
  window.setTimeout(() => el.classList.remove("is-flash"), 2200);
  return true;
}

/* ---------- Activity line ---------- */

const PHRASES: Record<ActivityKind, Key[]> = {
  thinking: ["activity.thinking.0", "activity.thinking.1", "activity.thinking.2"],
  writing: ["activity.writing"],
  searching: ["activity.searching"],
  reading: ["activity.reading"],
  browsing: ["activity.browsing"],
  computer: ["activity.computer"],
  shell: ["activity.shell"],
  messaging: ["activity.messaging"],
  connector: ["activity.connector"],
  waiting: ["activity.waiting"],
  saving: ["activity.saving"],
  remembering: ["activity.remembering"],
  planning: ["activity.planning"],
};
const WORKING: Key[] = ["activity.working.0", "activity.working.1", "activity.working.2", "activity.working.3", "activity.working.4"];

function teammateName(rows: Row[], detail?: string): string | null {
  for (let i = rows.length - 1; i >= 0 && i >= rows.length - 30; i--) {
    const b = rows[i].body;
    if (b.kind !== "step" || b.status !== "running") continue;
    for (const key of ["bot", "name", "to", "botName", "recipient"]) {
      const v = b.args[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return detail?.trim() || null;
}

export function activityPhrase(live: Live, rows: Row[], now: number): string {
  if (live.awaiting) return live.awaiting.reason || t("activity.waiting");
  const a = live.activity;
  if (!a) return t(WORKING[Math.floor(Math.max(0, now - (live.startedAt ?? now)) / 6000) % WORKING.length]);
  if (a.kind === "messaging") {
    const who = teammateName(rows, a.detail);
    return who ? t("activity.checkingWith", { name: who }) : t("activity.messaging");
  }
  if (a.kind === "connector" && a.detail) return t("activity.workingIn", { name: a.detail });
  const list = PHRASES[a.kind] ?? WORKING;
  return t(list[Math.floor(Math.max(0, now - a.since) / 6000) % list.length]);
}

function ActivityLine({ bot, live, rows }: { bot: Bot; live: Live; rows: Row[] }) {
  const now = useTick(1000);
  useT();
  const since = live.startedAt ?? live.activity?.since ?? now;
  const waiting = !!live.awaiting;
  const caption = live.caption?.replace(/\s+/g, " ").trim();
  return (
    <div className={`activity ${waiting ? "is-waiting" : ""}`} role="status">
      <BotAvatar bot={bot} size={22} />
      <span className={waiting ? "activity-text" : "activity-text shimmer"}>{activityPhrase(live, rows, now)}{waiting ? "" : "…"}</span>
      {!waiting && now - since >= 1000 && <span className="activity-time">{elapsed(now - since)}</span>}
      {live.queued > 0 && <span className="chip">{tn("count.queued", live.queued)}</span>}
      {!waiting && caption && (
        <span key={caption} className="activity-caption truncate" title={caption}>{caption}</span>
      )}
    </div>
  );
}

/* ---------- Transcript ---------- */

function EmptyChat({ bot }: { bot: Bot }) {
  const imageGeneration = useStore((s) => s.imageGeneration);
  const t = useT();
  const fallback = t(bot.kind === "room" ? "empty.room" : bot.mode === "teammate" ? "empty.teammate" : "empty.personal");
  return (
    <div className="chat-empty">
      <BotAvatar bot={bot} size={84} badge interactive />
      <h2>{bot.name}</h2>
      <p>{bot.description || fallback}</p>
      {imageGeneration && bot.kind !== "room" && <p className="chat-empty-hint">{t("empty.images")}</p>}
    </div>
  );
}

export function Transcript({ bot, thread, live }: { bot: Bot; thread: Thread | undefined; live: Live }) {
  const loadEarlier = useStore((s) => s.loadEarlier);
  const loadRows = useStore((s) => s.loadRows);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restore = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const t = useT();

  const rows = thread?.rows ?? [];
  // `t` changes with the language, so the date dividers are rebuilt when it does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => buildItems(rows, live.running), [rows, live.running, t]);
  const lastBody = rows.length ? rows[rows.length - 1].body : null;
  const streaming = lastBody?.kind === "message" && !!lastBody.streaming;
  const showActivity = (live.running && !streaming) || !!live.awaiting;

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useLayoutEffect(() => {
    pinned.current = true;
    setShowJump(false);
    toBottom();
  }, [bot.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
    } else if (pinned.current) {
      toBottom();
    }
  }, [items, showActivity, thread?.loaded]);

  useEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = dist <= 40;
    setShowJump(dist > 200);
  };

  const earlier = () => {
    const el = scroller.current;
    if (el) restore.current = el.scrollHeight - el.scrollTop;
    pinned.current = false;
    void loadEarlier(bot.id);
  };

  const loaded = !!thread?.loaded;

  // A search hit: load earlier rows until the message is on the page (best effort), then scroll to it and flash it.
  const jump = useStore((s) => s.jump);
  const jumpTries = useRef({ tick: 0, n: 0 });
  useEffect(() => {
    if (!jump || jump.botId !== bot.id || !thread?.loaded) return;
    const { clearJump, showToast } = useStore.getState();
    if (jumpTries.current.tick !== jump.tick) jumpTries.current = { tick: jump.tick, n: 0 };
    if (scroller.current?.querySelector(`[data-seq="${jump.seq}"]`)) {
      pinned.current = false;
      revealRow(scroller.current, jump.seq);
      clearJump();
      return;
    }
    const first = thread.rows[0]?.seq;
    if (thread.hasMore && first !== undefined && first > jump.seq && jumpTries.current.n < 25) {
      if (!thread.loadingEarlier) {
        jumpTries.current.n++;
        pinned.current = false;
        void loadEarlier(bot.id);
      }
      return;
    }
    clearJump();
    showToast(t("search.notFound"));
  }, [jump, bot.id, thread?.loaded, thread?.rows, thread?.hasMore, thread?.loadingEarlier, loadEarlier, t]);

  return (
    <div className="transcript-wrap">
      <div className="transcript" ref={scroller} onScroll={onScroll} tabIndex={-1}>
        <div className="transcript-inner" ref={content} aria-live="polite" aria-relevant="additions">
          {!loaded && thread?.loading && (
            <div className="transcript-loading"><Spinner /></div>
          )}
          {!loaded && thread?.error && (
            <div className="chat-empty">
              <p>{t("transcript.loadFailed", { error: thread.error })}</p>
              <button type="button" className="btn" onClick={() => void loadRows(bot.id, true)}>{t("common.tryAgain")}</button>
            </div>
          )}
          {loaded && items.length === 0 && !showActivity && <EmptyChat bot={bot} />}
          {loaded && thread?.hasMore && (
            <div className="earlier">
              <button type="button" className="btn btn-small" onClick={earlier} disabled={thread.loadingEarlier}>
                {t(thread.loadingEarlier ? "common.loading" : "transcript.loadEarlier")}
              </button>
            </div>
          )}
          <RowItems items={items} bot={bot} />
          {loaded && showActivity && <ActivityLine bot={bot} live={live} rows={rows} />}
          {loaded && !showActivity && live.queued > 0 && (
            <div className="activity"><span className="chip">{tn("count.queued", live.queued)}</span></div>
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="jump"
          aria-label={t("transcript.jump")}
          title={t("transcript.jump")}
          onClick={() => {
            pinned.current = true;
            toBottom();
            setShowJump(false);
          }}
        >
          <Icon name="arrowDown" size={18} />
        </button>
      )}
    </div>
  );
}
