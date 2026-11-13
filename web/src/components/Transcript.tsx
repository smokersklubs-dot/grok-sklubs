import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore, type Thread } from "../store";
import type { ActivityKind, Bot, Live, Origin, Row, RowBody } from "../types";
import { clockTime, dividerLabel, duration, elapsed, hostName, plural } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { Avatar, BotAvatar } from "./Avatar";
import { CardView } from "./Cards";
import { Icon, Spinner } from "./Icon";
import { useTick } from "./ui";

type MessageBody = Extract<RowBody, { kind: "message" }>;
type StepBody = Extract<RowBody, { kind: "step" }>;
type EventBody = Extract<RowBody, { kind: "event" }>;

type Item =
  | { t: "divider"; key: string; label: string }
  | { t: "msgs"; key: string; sender: string; mine: boolean; origin?: Origin; role: "user" | "assistant"; rows: Row[] }
  | { t: "steps"; key: string; rows: Row[] }
  | { t: "row"; key: string; row: Row };

const HOUR = 3_600_000;
const GROUP_WINDOW = 5 * 60_000;

function isMine(b: MessageBody): boolean {
  return b.role === "user" && (!b.origin || b.origin.kind === "voice");
}

function buildItems(rows: Row[], running: boolean): Item[] {
  const items: Item[] = [];
  let prevAt: number | null = null;
  for (const row of rows) {
    const b = row.body;
    if (b.kind === "message" && !b.text.trim() && !b.streaming) continue;
    if (b.kind === "step" && running && b.status === "running") continue;
    if (prevAt === null || row.createdAt - prevAt > HOUR) {
      items.push({ t: "divider", key: `d${row.seq}`, label: dividerLabel(row.createdAt) });
    }
    prevAt = row.createdAt;
    const last = items[items.length - 1];
    if (b.kind === "step") {
      if (last?.t === "steps") last.rows.push(row);
      else items.push({ t: "steps", key: `s${row.seq}`, rows: [row] });
    } else if (b.kind === "message") {
      const sender = `${b.role}:${b.origin ? `${b.origin.kind}:${b.origin.id}` : ""}`;
      const lastRow = last?.t === "msgs" ? last.rows[last.rows.length - 1] : null;
      if (last?.t === "msgs" && last.sender === sender && lastRow && row.createdAt - lastRow.createdAt <= GROUP_WINDOW) {
        last.rows.push(row);
      } else {
        items.push({ t: "msgs", key: `m${row.seq}`, sender, mine: isMine(b), origin: b.origin, role: b.role, rows: [row] });
      }
    } else {
      items.push({ t: "row", key: `r${row.seq}`, row });
    }
  }
  return items;
}

/* ---------- Messages ---------- */

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

function SenderLabel({ origin, role }: { origin: Origin; role: "user" | "assistant" }) {
  const bots = useStore((s) => s.bots);
  if (origin.kind === "bot") {
    const b = bots[origin.id];
    return (
      <div className="sender">
        {b ? <BotAvatar bot={b} size={18} /> : <Avatar shape="circle" color="slate" name={origin.name} size={18} />}
        <span>{role === "user" ? `from ${origin.name}` : origin.name}</span>
      </div>
    );
  }
  if (origin.kind === "routine") {
    return (
      <div className="sender">
        <Icon name="clock" size={14} />
        <span>routine · {origin.name}</span>
      </div>
    );
  }
  if (origin.kind === "webhook") {
    return (
      <div className="sender">
        <Icon name="hook" size={14} />
        <span>webhook · {origin.name}</span>
      </div>
    );
  }
  return (
    <div className="sender">
      <Icon name="wave" size={14} />
      <span>asked on a voice call</span>
    </div>
  );
}

function MessageGroup({ item }: { item: Extract<Item, { t: "msgs" }> }) {
  const n = item.rows.length;
  return (
    <div className={`group ${item.mine ? "is-mine" : "is-theirs"}`}>
      {item.origin && <SenderLabel origin={item.origin} role={item.role} />}
      {item.rows.map((row, i) => {
        const b = row.body as MessageBody;
        const pos = n === 1 ? "only" : i === 0 ? "first" : i === n - 1 ? "last" : "mid";
        return (
          <div key={row.seq} className={`msg is-${pos}`}>
            <div className={`bubble ${b.streaming ? "is-streaming" : ""}`}>
              {item.mine ? <p className="plain">{b.text}</p> : <Markdown text={b.text} />}
              {b.streaming && <span className="stream-dots" aria-label="Still writing"><i /><i /><i /></span>}
            </div>
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

const STEP_MARK: Partial<Record<StepBody["status"], string>> = { error: "failed", denied: "not allowed", waiting: "waiting for approval", running: "in progress" };

function StepGroup({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const steps = rows.map((r) => ({ seq: r.seq, body: r.body as StepBody }));
  const problem = steps.some((s) => s.body.status === "error" || s.body.status === "denied");
  const last = steps[steps.length - 1].body;
  return (
    <div className="steps">
      <button type="button" className="steps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="chevronRight" size={14} className={open ? "is-rotated" : ""} />
        <span>{plural(steps.length, "step")}</span>
        {!open && <span className="steps-last truncate">{last.label}</span>}
        {problem && !open && <span className="dot-inline dot-error" title="A step failed or was not allowed" />}
      </button>
      {open && (
        <ol className="steps-list">
          {steps.map(({ seq, body }) => (
            <li key={seq} className="step" title={body.tool}>
              <span className={`dot-inline dot-step-${body.status}`} />
              <div className="step-text">
                <span className="step-label">
                  {body.label || body.tool}
                  {STEP_MARK[body.status] && <span className={`step-mark is-${body.status}`}>{STEP_MARK[body.status]}</span>}
                </span>
                {body.summary && <span className="step-summary">{body.summary}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------- Events and notices ---------- */

function EventRow({ body, botName }: { body: EventBody; botName: string }) {
  const [open, setOpen] = useState(false);
  const call = body.call;
  const lines = call?.transcript ?? [];
  return (
    <div className="event">
      <span>
        {body.text}
        {call?.phase === "ended" && typeof call.durationMs === "number" ? ` · ${duration(call.durationMs)}` : ""}
      </span>
      {call?.summary && <span className="event-summary">{call.summary}</span>}
      {lines.length > 0 && (
        <>
          <button type="button" className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide transcript" : "Show transcript"}
          </button>
          {open && (
            <div className="event-transcript">
              {lines.map((l, i) => (
                <p key={i}>
                  <b>{l.role === "user" ? "You" : botName}</b> {l.text}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Activity line ---------- */

const PHRASES: Record<ActivityKind, string[]> = {
  thinking: ["Thinking it through", "Mulling it over", "Working out an approach"],
  writing: ["Writing a reply"],
  searching: ["Searching the web"],
  reading: ["Reading up"],
  browsing: ["Browsing a page"],
  computer: ["Using its desktop"],
  shell: ["Running a command"],
  messaging: ["Checking with a teammate"],
  connector: ["Working in a connected app"],
  waiting: ["Needs your input"],
  saving: ["Saving a file"],
  remembering: ["Making a note to remember"],
  planning: ["Planning the next steps"],
};
const WORKING = ["Working on it", "Making progress", "Still at it", "Pulling things together", "Getting it done"];

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
  if (live.awaiting) return live.awaiting.reason || "Needs your input";
  const a = live.activity;
  if (!a) return WORKING[Math.floor(Math.max(0, now - (live.startedAt ?? now)) / 6000) % WORKING.length];
  if (a.kind === "messaging") {
    const who = teammateName(rows, a.detail);
    return who ? `Checking with ${who}` : PHRASES.messaging[0];
  }
  if (a.kind === "connector" && a.detail) return `Working in ${a.detail}`;
  const list = PHRASES[a.kind] ?? WORKING;
  return list[Math.floor(Math.max(0, now - a.since) / 6000) % list.length];
}

function ActivityLine({ bot, live, rows }: { bot: Bot; live: Live; rows: Row[] }) {
  const now = useTick(1000);
  const since = live.startedAt ?? live.activity?.since ?? now;
  const waiting = !!live.awaiting;
  return (
    <div className={`activity ${waiting ? "is-waiting" : ""}`} role="status">
      <BotAvatar bot={bot} size={22} />
      <span className={waiting ? "activity-text" : "activity-text shimmer"}>{activityPhrase(live, rows, now)}{waiting ? "" : "…"}</span>
      {!waiting && now - since >= 1000 && <span className="activity-time">{elapsed(now - since)}</span>}
      {live.queued > 0 && <span className="chip">{plural(live.queued, "message")} queued</span>}
    </div>
  );
}

/* ---------- Transcript ---------- */

function EmptyChat({ bot }: { bot: Bot }) {
  const fallback =
    bot.kind === "room"
      ? "A shared room. Mention a bot with @ to bring it into the conversation."
      : bot.mode === "teammate"
        ? "A teammate with its own job. Tell it what to take on, and it will keep you posted."
        : "Your personal assistant. Ask for anything — it remembers what matters and can act on your behalf.";
  return (
    <div className="chat-empty">
      <BotAvatar bot={bot} size={84} badge />
      <h2>{bot.name}</h2>
      <p>{bot.description || fallback}</p>
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

  const rows = thread?.rows ?? [];
  const items = useMemo(() => buildItems(rows, live.running), [rows, live.running]);
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

  return (
    <div className="transcript-wrap">
      <div className="transcript" ref={scroller} onScroll={onScroll} tabIndex={-1}>
        <div className="transcript-inner" ref={content} aria-live="polite" aria-relevant="additions">
          {!loaded && thread?.loading && (
            <div className="transcript-loading"><Spinner /></div>
          )}
          {!loaded && thread?.error && (
            <div className="chat-empty">
              <p>Couldn't load this conversation. {thread.error}</p>
              <button type="button" className="btn" onClick={() => void loadRows(bot.id, true)}>Try again</button>
            </div>
          )}
          {loaded && items.length === 0 && !showActivity && <EmptyChat bot={bot} />}
          {loaded && thread?.hasMore && (
            <div className="earlier">
              <button type="button" className="btn btn-small" onClick={earlier} disabled={thread.loadingEarlier}>
                {thread.loadingEarlier ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          )}
          {items.map((item) => {
            switch (item.t) {
              case "divider":
                return <div key={item.key} className="divider"><span>{item.label}</span></div>;
              case "msgs":
                return <MessageGroup key={item.key} item={item} />;
              case "steps":
                return <StepGroup key={item.key} rows={item.rows} />;
              case "row": {
                const b = item.row.body;
                if (b.kind === "card") return <CardView key={item.key} card={b.card} botId={bot.id} seq={item.row.seq} />;
                if (b.kind === "event") return <EventRow key={item.key} body={b} botName={bot.name} />;
                if (b.kind === "notice") return <div key={item.key} className={`notice is-${b.tone}`}><span>{b.text}</span></div>;
                return null;
              }
            }
          })}
          {loaded && showActivity && <ActivityLine bot={bot} live={live} rows={rows} />}
          {loaded && !showActivity && live.queued > 0 && (
            <div className="activity"><span className="chip">{plural(live.queued, "message")} queued</span></div>
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="jump"
          aria-label="Jump to latest"
          title="Jump to latest"
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
