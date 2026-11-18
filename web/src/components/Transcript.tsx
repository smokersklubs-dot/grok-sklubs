import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, enc, errText } from "../api";
import { t, tn, useT, type Key } from "../i18n";
import { useStore, type AppSection, type Thread } from "../store";
import { REACTIONS, type ActivityKind, type Attachment, type Bot, type Live, type Origin, type Reaction, type ReactionEmoji, type Row, type RowBody } from "../types";
import { isHumanSummary } from "../lib/callSummary";
import { callClock, clockTime, dividerLabel, elapsed, fileSize, hostName, liveDuration, workDuration } from "../lib/format";
import { accentStyle } from "../lib/colors";
import { renderMarkdown } from "../lib/markdown";
import { PagePreview } from "./PagePreview";
import { FirstTaskIdeas, MentionedFiles, previewable, usePreview } from "./SpendSkillsFiles";
import { Avatar, BotAvatar } from "./Avatar";
import { CardView } from "./Cards";
import { GrantLine } from "./RulesAndNudges";
import { Icon, Spinner } from "./Icon";
import { ListenButton, ListenPlayer } from "./ListenControls";
import { IconButton, useDialogFocus, useEscape, useTick } from "./ui";
import { PlanNoticeActions } from "./Hosted";
import { SubLimitNoticeActions } from "./SubLimit";
import { ENGINE_BRAND } from "../lib/engines";

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

/** `viewer`: wave 6 — on a bot someone shares with you, only the messages you wrote (origin "member", your id) are yours. */
function isMine(b: MessageBody, viewer?: string): boolean {
  if (viewer) return b.role === "user" && b.origin?.kind === "member" && b.origin.id === viewer;
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
      } else if (finalBody && b.kind === "message" && b.role === "assistant" && i < final && senderKey(b) === senderKey(finalBody) && !b.attachments?.length) {
        // Files the bot made (a picture, a video) stay in view; only its in-between words fold away.
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

/** Groups the rows of one conversation for display. Thread replies are left out unless `thread` says which thread to show. */
export function buildItems(all: Row[], running: boolean, thread = 0, viewer?: string, ownerName?: string): Item[] {
  const rows = all.filter((r) => (r.thread ?? 0) === thread);
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
        items.push({ t: "msgs", key: `m${row.seq}`, sender, mine: isMine(b, viewer), origin: viewer && b.role === "user" && !b.origin ? { kind: "member", id: "", name: ownerName ?? "" } : b.origin, role: b.role, rows: [row] });
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
  if (origin.kind === "member") {
    return (
      <div className="sender">
        <Icon name="user" size={14} />
        <span>{origin.name}</span>
      </div>
    );
  }
  if (origin.kind === "api") {
    return (
      <div className="sender">
        <Icon name="key" size={14} />
        <span>{t("msg.api", { name: origin.name })}</span>
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
  const videos = files.filter((f) => f.mime === "video/mp4" || f.mime === "video/webm");
  const others = files.filter((f) => !f.mime.startsWith("image/") && !videos.includes(f));
  return (
    <div className="attachments">
      {videos.map((f) => (
        <figure key={f.path} className="attach-video">
          <video src={viewUrl(botId, f.path)} controls preload="metadata" playsInline aria-label={t("attach.video", { name: f.name })} />
          <figcaption>
            <Icon name="play" size={13} />
            <span className="truncate">{f.name}</span>
            <span className="attach-file-size">{fileSize(f.size)}</span>
            <a className="attach-video-dl" href={downloadUrl(botId, f.path)} download={f.name} title={t("attach.downloadName", { name: f.name })}>
              <Icon name="download" size={14} />
            </a>
          </figcaption>
        </figure>
      ))}
      {images.map((f) => (
        <button key={f.path} type="button" className="attach-image" onClick={() => setOpen(f)} aria-label={t("attach.open", { name: f.name })} title={f.name}>
          <img src={viewUrl(botId, f.path)} alt={f.name} loading="lazy" />
        </button>
      ))}
      {others.map((f) => (
        <span key={f.path} className="attach-file-wrap">
        {previewable(f.mime, f.name) && <button type="button" className="attach-preview" onClick={() => usePreview.getState().open(botId, f)} aria-label={t("preview.open", { name: f.name })} title={t("preview.open", { name: f.name })}><Icon name="eye" size={15} /></button>}
        <a className="attach-file" href={downloadUrl(botId, f.path)} download={f.name} title={t("attach.downloadName", { name: f.name })}>
          <span className="attach-file-icon">
            <Icon name="file" size={18} />
          </span>
          <span className="attach-file-text">
            <span className="attach-file-name truncate">{f.name}</span>
            <span className="attach-file-size">{fileSize(f.size)}</span>
          </span>
          <Icon name="download" size={15} className="attach-file-dl" />
        </a>
        </span>
      ))}
      {open && <Lightbox botId={botId} file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------- Reactions and threads ---------- */

/** Where rows are shown: the main chat, a thread panel, or a read-only earlier conversation (with every row, threads included). */
export const RowContext = createContext<{ mode: "main" | "thread" | "readonly"; all?: Row[] }>({ mode: "main" });

function ReactionBar({ row, reactions }: { row: Row; reactions: Reaction[] }) {
  const { mode } = useContext(RowContext);
  const bots = useStore((s) => s.bots);
  const t = useT();
  if (!reactions.length) return null;
  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r]);
  return (
    <div className="reactions" role="group" aria-label={t("react.list")}>
      {[...groups.entries()].map(([emoji, who]) => {
        const mine = who.some((w) => w.by === "user");
        const names = who.map((w) => (w.by === "user" ? t("common.you") : bots[w.by]?.name ?? w.name)).join(", ");
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction ${mine ? "is-mine" : ""}`}
            disabled={mode === "readonly"}
            aria-pressed={mine}
            title={t("react.who", { names, emoji })}
            onClick={() => void useStore.getState().react(row.botId, row.seq, emoji as ReactionEmoji)}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{who.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function MessageActions({ row, canThread, canListen }: { row: Row; canThread: boolean; canListen?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const pick = (emoji: ReactionEmoji) => {
    setOpen(false);
    void useStore.getState().react(row.botId, row.seq, emoji);
  };
  return (
    <div className={`msg-actions ${open ? "is-open" : ""}`}>
      {canListen && <ListenButton row={row} />}
      <button type="button" className="msg-action" aria-label={t("react.add")} title={t("react.add")} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="smile" size={15} />
      </button>
      {canThread && (
        <button type="button" className="msg-action" aria-label={t("thread.reply")} title={t("thread.reply")} onClick={() => useStore.getState().openThreadPanel(row.botId, row.seq)}>
          <Icon name="thread" size={15} />
        </button>
      )}
      {open && (
        <div className="emoji-pick" role="menu" aria-label={t("react.add")} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          {REACTIONS.map((e) => (
            <button key={e} type="button" role="menuitem" className="emoji-pick-item" onClick={() => pick(e)}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function RepliesLink({ row, count, lastAt }: { row: Row; count: number; lastAt: number }) {
  const { mode, all } = useContext(RowContext);
  const [open, setOpen] = useState(false);
  const t = useT();
  if (mode === "thread") return null;
  if (mode === "readonly") {
    // An earlier conversation: the thread opens in place.
    const replies = (all ?? []).filter((r) => r.thread === row.seq && r.body.kind === "message" && r.body.text.trim());
    return (
      <div className="replies-inline">
        <button type="button" className="replies" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="thread" size={13} /> {tn("count.reply", count)}
        </button>
        {open && replies.map((r) => (
          <div key={r.seq} className="reply-line" data-seq={r.seq}>
            <b>{r.body.kind === "message" && r.body.role === "user" && !r.body.origin ? t("common.you") : r.body.kind === "message" ? r.body.origin?.name ?? "" : ""}</b>
            <Markdown text={r.body.kind === "message" ? r.body.text : ""} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <button type="button" className="replies" onClick={() => useStore.getState().openThreadPanel(row.botId, row.seq)}>
      <Icon name="thread" size={13} />
      <span>{tn("count.reply", count)}</span>
      <span className="replies-when">{t("thread.last", { time: clockTime(lastAt) })}</span>
    </button>
  );
}

function MessageGroup({ item }: { item: Extract<Item, { t: "msgs" }> }) {
  const n = item.rows.length;
  const t = useT();
  const { mode } = useContext(RowContext);
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
            {!item.mine && !b.streaming && b.text.includes("~/files/") && <MentionedFiles botId={row.botId} text={b.text} />}
            {!item.mine && !b.streaming && b.text.includes("/p/") && <PagePreview text={b.text} />}
            <time className="msg-time" dateTime={new Date(row.createdAt).toISOString()}>{clockTime(row.createdAt)}</time>
            {mode !== "readonly" && !b.streaming && <MessageActions row={row} canThread={mode === "main"} canListen={!item.mine && b.role === "assistant" && !!b.text.trim()} />}
            {!item.mine && b.role === "assistant" && <ListenPlayer row={row} />}
            {b.reactions && b.reactions.length > 0 && <ReactionBar row={row} reactions={b.reactions} />}
            {b.replies && b.replies.count > 0 && <RepliesLink row={row} count={b.replies.count} lastAt={b.replies.lastAt} />}
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
        {body.grant && <GrantLine grant={body.grant} />}
      </div>
    </li>
  );
}

const hasProblem = (rows: Row[]) => rows.some((r) => r.body.kind === "step" && (r.body.status === "error" || r.body.status === "denied"));

/**
 * The steps of the turn still running: a compact toggle with the latest step. While it is the last thing in the chat
 * and the bot works (`active`), it shows a spinner, the label of the step under way (sliding in when it changes) and
 * the count, including steps the server already counted that have no row here yet (B-7.5); while the bot waits for the
 * user it is a closed pill with an amber dot.
 */
function StepGroup({ rows, active }: { rows: Row[]; active?: { surplus: number; waiting: boolean } }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const problem = hasProblem(rows);
  const steps = rows.map((r) => r.body as StepBody);
  const last = steps[steps.length - 1];
  const current = [...steps].reverse().find((b) => b.status === "running") ?? last;
  const count = rows.length + (active?.surplus ?? 0);
  if (active && !active.waiting && !open) {
    return (
      <div className="steps">
        <button type="button" className="steps-toggle steps-live" onClick={() => setOpen(true)} aria-expanded={false}>
          <Spinner size={13} />
          <span key={`${current.callId}-${current.label}`} className="steps-current truncate">{current.label || current.tool}</span>
          <span className="steps-sep" aria-hidden="true" />
          <span className="steps-count">{tn("count.step", count)}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="steps">
      <button type="button" className={`steps-toggle ${active?.waiting ? "steps-waiting" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="chevronRight" size={14} className={open ? "is-rotated" : ""} />
        <span>{tn("count.step", count)}</span>
        {!open && <span className="steps-last truncate">{last.label}</span>}
        {active?.waiting && !open && <span className="dot-inline dot-waiting" title={t("thinking.waitingDot")} />}
        {problem && !open && !active?.waiting && <span className="dot-inline dot-error" title={t("step.problem")} />}
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

type NoticeBody = Extract<RowBody, { kind: "notice" }>;

/** A server notice. One that says the bot stopped at its step limit carries a "Continue" button. */
function NoticeRow({ body, botId, seq, readOnly }: { body: NoticeBody; botId: string; seq: number; readOnly: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const action = body.action;
  return (
    <div className={`notice is-${body.tone} ${action ? "has-action" : ""}`} data-seq={seq}>
      <span>{body.text}</span>
      {action?.kind === "continue" && (action.status === "pending" && !readOnly ? (
        <button type="button" className="btn btn-small notice-action" disabled={busy} onClick={async () => {
          setBusy(true);
          setFailed(null);
          try { await api("POST", `/bots/${botId}/rows/${seq}/continue`); } catch (e) { setFailed(errText(e)); setBusy(false); }
        }}>
          <Icon name="play" size={13} /> {t(busy ? "notice.continuing" : "notice.continue")}
        </button>
      ) : action.status === "done" ? <em className="notice-done">{t("notice.continued")}</em> : null)}
      {action?.kind === "settings" && !readOnly && (
        <button type="button" className="btn btn-small notice-action" onClick={() => useStore.getState().openAppSettings(action.section as AppSection)}>
          {action.section === "usage" ? <><Icon name="chart" size={13} /> {t("caps.openUsage")}</> : <><Icon name="key" size={13} /> {t("health.openKeys")}</>}
        </button>
      )}
      {action?.kind === "plan" && !readOnly && <PlanNoticeActions action={action} />}
      {action?.kind === "watch" && <WatchNoticeActions action={action} botId={botId} seq={seq} readOnly={readOnly} />}
      {action?.kind === "sublimit" && <SubLimitNoticeActions action={action} botId={botId} seq={seq} readOnly={readOnly} />}
      {failed && <span className="notice-error" role="alert">{failed}</span>}
    </div>
  );
}

type WatchAction = Extract<NonNullable<NoticeBody["action"]>, { kind: "watch" }>;

/**
 * The turn watch's notices (server agent/watch.ts). "Not answering yet": Wait, Switch AI for this message (when the bot has
 * a next model), Check the Claude / ChatGPT connection (a subscription bot: its settings, where the engine's sign-in is).
 * "Seems stuck": Keep waiting, Stop and resume. Once answered, or once the turn moved on, the notice only tells.
 */
function WatchNoticeActions({ action, botId, seq, readOnly }: { action: WatchAction; botId: string; seq: number; readOnly: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState<"wait" | "switch" | "stop" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const open = action.status === "pending" || action.status === "waiting";
  if (!open || readOnly) return null;
  const choose = async (choice: "wait" | "switch" | "stop") => {
    setBusy(choice);
    setFailed(null);
    try { await api("POST", `/bots/${botId}/rows/${seq}/watch`, { choice }); } catch (e) { setFailed(errText(e)); }
    setBusy(null);
  };
  const checkEngine = () => {
    useStore.getState().openBotSettings(botId, "general");
    // The engine's box (sign-in state, Restart) sits under the brain picker: brought into view once the panel is open.
    window.setTimeout(() => document.querySelector(".engine-box")?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  };
  return (
    <div className="notice-actions" role="group" aria-label={action.watch === "silent" ? t("watch.silentGroup") : t("watch.stalledGroup")}>
      {action.status === "pending" && (
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void choose("wait")}>
          <Icon name="clock" size={13} /> {t(action.watch === "silent" ? "watch.wait" : "watch.keepWaiting")}
        </button>
      )}
      {action.status === "waiting" && <em className="notice-done">{t("watch.waiting")}</em>}
      {action.watch === "silent" && action.next && (
        <button type="button" className="btn btn-small" disabled={busy !== null} title={t("watch.switchTitle", { next: action.next })} onClick={() => void choose("switch")}>
          <Icon name="refresh" size={13} /> {t(busy === "switch" ? "common.working" : "watch.switch")}
        </button>
      )}
      {action.watch === "silent" && action.engine && (
        <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={checkEngine}>
          <Icon name="key" size={13} /> {t("watch.checkEngine", { brand: ENGINE_BRAND[action.engine] })}
        </button>
      )}
      {action.watch === "stalled" && (
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void choose("stop")}>
          <Icon name="play" size={13} /> {t(busy === "stop" ? "common.working" : "watch.stopResume")}
        </button>
      )}
      {failed && <span className="notice-error" role="alert">{failed}</span>}
    </div>
  );
}

function EventRow({ body, botName, botId, seq }: { body: EventBody; botName: string; botId: string; seq: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const call = body.call;
  const lines = call?.transcript ?? [];
  if (body.event === "progress") {
    // An interim update the bot posted during long work: a light line, not its reply.
    return (
      <div className="event is-progress" data-seq={seq}>
        <span className="event-line"><Icon name="clock" size={12} /> <span>{body.text}</span></span>
      </div>
    );
  }
  if (body.event === "selfupdate") {
    // The bot changed its own settings: one click puts them back.
    return (
      <div className="event is-selfupdate" data-seq={seq}>
        <span className="event-line">
          <Icon name="wrench" size={13} /> <span>{body.text}</span>
          {body.undo?.status === "available" && (
            <button type="button" className="link" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await api("POST", `/bots/${botId}/rows/${seq}/undo`); } catch { setBusy(false); }
            }}>{t("event.undoSelf")}</button>
          )}
          {body.undo?.status === "undone" && <em className="muted">{t("event.undoneSelf")}</em>}
        </span>
      </div>
    );
  }
  if (body.event === "cheer") {
    // The bot celebrated a gem it found (its character went wild at the same moment).
    return (
      <div className="event is-cheer" data-seq={seq}>
        <span className="event-line">
          <span className="cheer-spark" aria-hidden="true">
            <Icon name="star" size={13} />
          </span>
          <span className="cheer-text">{t("event.cheer", { reason: body.text })}</span>
          {body.gem && <span className="cheer-score">{t(`gem.kind.${body.gem.kind}`)} · {body.gem.score}/100</span>}
        </span>
        {body.gem && (body.gem.why || body.gem.value) && (
          <span className="cheer-why">
            {body.gem.why}
            {body.gem.value ? <b> · {body.gem.value}</b> : null}
          </span>
        )}
      </div>
    );
  }
  if (body.event === "relay") {
    // Something happened on the user's own computer (Sklubot Relais): control taken or ended, Stop, a refusal there.
    return (
      <div className={`event is-relay ${body.tone === "warn" ? "is-warn" : ""}`} data-seq={seq}>
        <span className="event-line"><Icon name={body.tone === "warn" ? "alert" : "monitor"} size={13} /> <span>{body.text}</span></span>
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
      {call?.summary && isHumanSummary(call.summary) && <span className="event-summary">{call.summary}</span>}
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
export function RowItems({ items, bot, readOnly, mode, all, openSteps }: { items: Item[]; bot: Bot; readOnly?: boolean; mode?: "main" | "thread"; all?: Row[]; /** The open steps group of the running turn (the last item), with its live extras. */ openSteps?: { key: string; surplus: number; waiting: boolean } | null }) {
  return (
    <RowContext.Provider value={{ mode: readOnly ? "readonly" : mode ?? "main", all }}>
      {items.map((item) => {
        switch (item.t) {
          case "divider":
            return <div key={item.key} className="divider"><span>{item.label}</span></div>;
          case "msgs":
            return <MessageGroup key={item.key} item={item} />;
          case "steps":
            return <StepGroup key={item.key} rows={item.rows} active={openSteps?.key === item.key ? openSteps : undefined} />;
          case "work":
            return <WorkGroup key={item.key} item={item} />;
          case "row": {
            const b = item.row.body;
            if (b.kind === "card") {
              const card = <CardView key={item.key} card={b.card} botId={bot.id} seq={item.row.seq} />;
              return readOnly ? <div key={item.key} inert>{card}</div> : card;
            }
            if (b.kind === "event") return <EventRow key={item.key} body={b} botName={bot.name} botId={bot.id} seq={item.row.seq} />;
            if (b.kind === "notice") return <NoticeRow key={item.key} body={b} botId={bot.id} seq={item.row.seq} readOnly={!!readOnly} />;
            return null;
          }
        }
      })}
    </RowContext.Provider>
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
  filming: ["activity.filming"],
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
  if (a.kind === "filming" && a.detail && /^\d+$/.test(a.detail)) return t("activity.filmingAt", { pct: a.detail });
  const list = PHRASES[a.kind] ?? WORKING;
  return t(list[Math.floor(Math.max(0, now - a.since) / 6000) % list.length]);
}

/** The short status word under the bot's name in the thinking block. */
const STATUS: Record<ActivityKind, Key> = {
  thinking: "thinking.status.thinking", writing: "thinking.status.writing", searching: "thinking.status.searching", reading: "thinking.status.reading",
  browsing: "thinking.status.browsing", computer: "thinking.status.computer", shell: "thinking.status.shell", messaging: "thinking.status.messaging",
  connector: "thinking.status.connector", waiting: "thinking.status.waiting", saving: "thinking.status.saving", remembering: "thinking.status.remembering",
  planning: "thinking.status.planning", filming: "thinking.status.filming",
};

/** Tool rows since the user's last message: what the server's step counter is compared with (B-7.5). */
export function toolRowsSinceUser(rows: Row[]): number {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const b = rows[i].body;
    if (b.kind === "message" && b.role === "user" && !b.origin) break;
    if (b.kind === "step") n++;
  }
  return n;
}

/**
 * The "thinking" block at the end of the chat while a turn runs (B-7): the bot's avatar floating over a dark pill with
 * its name and a pulsing status word, a small glowing bulb while it works (an amber dot while it waits for the user),
 * the caption on the right (why it waits, else a line from its reasoning, else a friendly phrase that changes every
 * 6 s, fading up when it changes), and a meta line "working for 1 min 23 s · 7 steps". When an open steps group is the
 * last thing in the chat, that group shows the count and this block does not (no double counting).
 */
export function ActivityLine({ bot, live, rows, stepsShownAbove = false }: { bot: Bot; live: Live; rows: Row[]; stepsShownAbove?: boolean }) {
  const now = useTick(1000);
  const t = useT();
  const waiting = !!live.awaiting;
  const since = waiting ? live.awaiting!.since : live.startedAt ?? live.activity?.since ?? now;
  const caption = (live.awaiting?.reason || live.caption || activityPhrase(live, rows, now)).replace(/\s+/g, " ").trim();
  const kind: ActivityKind = waiting ? "waiting" : live.activity?.kind ?? "thinking";
  const status = kind === "connector" && live.activity?.detail && !/_|^[a-z0-9-]+$/.test(live.activity.detail) ? t("thinking.status.connectorIn", { name: live.activity.detail }) : t(STATUS[kind]);
  const steps = live.steps ?? 0;
  const elapsedMs = Math.max(0, now - since);
  const showTime = waiting || elapsedMs >= 1000;
  const style = accentStyle(bot.color, bot.character.customColor);
  return (
    <div className={`thinking ${waiting ? "is-waiting" : ""}`} role="status" aria-live="polite" style={style}>
      <div className="thinking-badge">
        <span className="thinking-avatar">
          <BotAvatar bot={bot} size={36} />
          {waiting ? <span className="thinking-alert" aria-hidden="true" /> : <span className="thinking-bulb" aria-hidden="true"><Icon name="bulb" size={13} /></span>}
        </span>
        <span className="thinking-pill">
          <span className="thinking-name truncate">{bot.name}</span>
          <span className="thinking-status">{status}</span>
        </span>
      </div>
      <div className="thinking-body">
        <span key={caption} className="thinking-caption truncate" title={caption}>{caption}{waiting ? "" : "…"}</span>
        <span className="thinking-meta">
          {showTime && t(waiting ? "thinking.waitingFor" : "thinking.workingFor", { time: liveDuration(elapsedMs) })}
          {!stepsShownAbove && steps > 0 && <>{showTime ? " · " : ""}{tn("count.step", steps)}</>}
          {live.queued > 0 && <span className="chip thinking-queued">{tn("count.queued", live.queued)}</span>}
        </span>
      </div>
    </div>
  );
}

/* ---------- Transcript ---------- */

function EmptyChat({ bot }: { bot: Bot }) {
  const imageGeneration = useStore((s) => s.imageGeneration);
  const video = useStore((s) => s.video);
  const t = useT();
  const fallback = t(bot.kind === "room" ? "empty.room" : bot.mode === "teammate" ? "empty.teammate" : "empty.personal");
  return (
    <div className="chat-empty">
      <BotAvatar bot={bot} size={84} badge interactive />
      <h2>{bot.name}</h2>
      <p>{bot.description || fallback}</p>
      {imageGeneration && bot.kind !== "room" && <p className="chat-empty-hint">{t("empty.images")}</p>}
      {bot.kind !== "room" && <p className="chat-empty-hint">{t(video.higgsfield ? "empty.videoHiggsfield" : video.provider ? "empty.video" : "empty.videoOff")}</p>}
      {bot.kind === "agent" && bot.primary && <FirstTaskIdeas bot={bot} />}
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
  const viewer = useStore((s) => (bot.access ? s.user?.id : undefined));
  const items = useMemo(() => buildItems(rows, live.running && !live.thread, 0, viewer, bot.access?.ownerName), [rows, live.running, live.thread, t, viewer, bot.access?.ownerName]);
  const mainRows = useMemo(() => rows.filter((r) => !r.thread), [rows]);
  const lastBody = mainRows.length ? mainRows[mainRows.length - 1].body : null;
  const streaming = lastBody?.kind === "message" && !!lastBody.streaming;
  // A turn answering in a thread shows its activity in the thread panel, not here.
  const inThread = !!live.thread;
  const showActivity = !inThread && ((live.running && !streaming) || !!live.awaiting);
  // The running turn's steps group, when it is the last thing in the chat, carries the live count (B-7.4).
  const lastItem = items[items.length - 1];
  const turnOn = !inThread && (live.running || !!live.awaiting);
  const openSteps = turnOn && lastItem?.t === "steps" ? { key: lastItem.key, surplus: Math.max(0, (live.steps ?? 0) - toolRowsSinceUser(mainRows)), waiting: !!live.awaiting } : null;

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
          <RowItems items={items} bot={bot} openSteps={openSteps} />
          {loaded && inThread && live.thread && (
            <button type="button" className="activity is-elsewhere" onClick={() => useStore.getState().openThreadPanel(bot.id, live.thread!)}>
              <BotAvatar bot={bot} size={22} />
              <span className="activity-text">{t("thread.working", { name: bot.name })}</span>
            </button>
          )}
          {loaded && showActivity && <ActivityLine bot={bot} live={live} rows={rows} stepsShownAbove={!!openSteps} />}
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
