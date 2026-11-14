import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { IDLE_LIVE, useStore } from "../store";
import type { Row } from "../types";
import { accentStyle } from "../lib/colors";
import { Icon } from "./Icon";
import { ActivityLine, buildItems, RowItems } from "./Transcript";
import { IconButton } from "./ui";

const EMPTY: Row[] = [];

/** A side conversation on one message: the message, its replies, and a small composer. */
export function ThreadPanel({ botId, seq }: { botId: string; seq: number }) {
  const bot = useStore((s) => s.bots[botId]);
  const rows = useStore((s) => s.threads[botId]?.rows ?? EMPTY);
  const live = useStore((s) => s.live[botId]) ?? IDLE_LIVE;
  const closeThread = useStore((s) => s.closeThread);
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const parent = rows.find((r) => r.seq === seq && !r.thread);
  const replies = useMemo(() => rows.filter((r) => r.thread === seq), [rows, seq]);
  const here = live.thread === seq;
  const running = here && live.running;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const head = useMemo(() => (parent ? buildItems([parent], false) : []), [parent, t]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => buildItems(rows, running, seq), [rows, running, seq, t]);
  const last = replies[replies.length - 1]?.body;
  const streaming = last?.kind === "message" && !!last.streaming;
  const showActivity = here && ((live.running && !streaming) || !!live.awaiting);

  useEffect(() => {
    input.current?.focus();
  }, [seq]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, showActivity, replies.length]);

  if (!bot) return null;

  const send = async () => {
    const words = text.trim();
    if (!words || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await api<{ row: Row }>("POST", `/bots/${botId}/messages`, { text: words, thread: seq });
      useStore.getState().addRows(botId, [r.row]);
      setText("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") closeThread();
  };

  return (
    <aside className="details thread-panel" style={accentStyle(bot.color, bot.character?.customColor)} aria-label={t("thread.title", { name: bot.name })}>
      <div className="details-top thread-top">
        <span className="thread-title">
          <Icon name="thread" size={16} />
          <strong>{t("thread.heading")}</strong>
          <span className="thread-sub truncate">{bot.name}</span>
        </span>
        <IconButton icon="close" label={t("thread.close")} onClick={closeThread} />
      </div>
      <div className="thread-body" ref={scroller}>
        <div className="transcript-inner thread-inner">
          {parent ? <div className="thread-parent"><RowItems items={head} bot={bot} mode="thread" /></div> : <p className="muted small">{t("thread.parentGone")}</p>}
          <div className="thread-divider"><span>{replies.filter((r) => r.body.kind === "message").length ? t("thread.replies") : t("thread.none")}</span></div>
          <RowItems items={items} bot={bot} mode="thread" />
          {showActivity && <ActivityLine bot={bot} live={live} rows={replies} />}
        </div>
      </div>
      <form
        className="thread-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="thread-input">{t("thread.placeholder")}</label>
        <textarea
          id="thread-input"
          ref={input}
          className="input thread-input"
          rows={2}
          value={text}
          placeholder={t("thread.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={!text.trim() || sending} aria-label={t("thread.send")} title={t("thread.send")}>
          <Icon name="send" size={16} />
        </button>
      </form>
      {error && <p className="thread-error" role="alert">{error}</p>}
    </aside>
  );
}
