import { useState } from "react";
import { api } from "../api";
import { t, tn } from "../i18n";
import { useStore } from "../store";
import type { Bot, Live, Row } from "../types";
import { activityPhrase } from "./Transcript";
import { Icon } from "./Icon";
import { useEscape } from "./ui";

/**
 * Lanes (server agent/lanes.ts): a bot runs up to 3 tasks at once (its main chat, a routine, a teammate's request…).
 * While two or more run, the chat header shows how many, and each can be opened (its thread) or stopped on its own;
 * "Stop all" stops them all. Nothing shows with a single task: the composer's Stop button is enough then.
 */
type Task = NonNullable<Live["tasks"]>[number];

/** A task's name: the main chat, a routine, a teammate's request, or the start of the message its thread hangs on. */
export function taskLabel(thread: number, rows: Row[]): string {
  if (!thread) return t("lanes.main");
  const parent = rows.find((r) => r.seq === thread);
  if (parent?.body.kind === "message") {
    const o = parent.body.origin;
    if (o?.kind === "routine") return t("lanes.routine", { name: o.name });
    if (o?.kind === "bot") return t("lanes.from", { name: o.name });
    const words = parent.body.text.replace(/\s+/g, " ").trim();
    if (words) return t("lanes.thread", { text: words.length > 40 ? `${words.slice(0, 40)}…` : words });
  }
  return t("lanes.threadN", { n: thread });
}

export function stopTask(botId: string, thread?: number) {
  // L63: « Tout arrêter » also cancels what waits in the queue; the chat gets one line saying what was stopped.
  return thread === undefined ? api("POST", `/bots/${encodeURIComponent(botId)}/stop-all`) : api("POST", `/bots/${encodeURIComponent(botId)}/stop`, { thread });
}

export function TaskLanes({ bot, live }: { bot: Bot; live: Live }) {
  const rows = useStore((s) => s.threads[bot.id]?.rows) ?? [];
  const { openThreadPanel, showToast } = useStore.getState();
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState<Set<number | "all">>(new Set());
  const tasks = live.tasks ?? [];
  useEscape(() => setOpen(false), open);
  if (tasks.length < 2) return null;
  const stop = async (thread?: number) => {
    const key = thread ?? "all";
    setStopping((s) => new Set(s).add(key));
    try { await stopTask(bot.id, thread); } catch (e) { showToast(e instanceof Error ? e.message : t("lanes.stopFailed")); }
    finally { setStopping((s) => { const n = new Set(s); n.delete(key); return n; }); }
  };
  const phrase = (task: Task) => (task.activity?.kind === "waiting" && task.activity.detail ? task.activity.detail : activityPhrase({ running: task.running, activity: task.activity, awaiting: task.awaiting, startedAt: task.startedAt, queued: 0 }, rows, Date.now()));
  return (
    <div className="menu-wrap lanes-wrap">
      <button type="button" className="lanes-chip" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={t("lanes.title")}>
        <span className="lanes-dot" aria-hidden="true" />
        {tn("lanes.count", tasks.length)}
      </button>
      {open && (
        <div className="menu menu-right menu-bottom lanes-panel" role="dialog" aria-label={t("lanes.title")}>
          <p className="lanes-head">{t("lanes.title")}</p>
          <ul className="lanes-list">
            {tasks.map((task) => (
              <li key={task.thread} className="lanes-item">
                <span className="lanes-text">
                  <span className="lanes-name truncate">{taskLabel(task.thread, rows)}</span>
                  <span className="lanes-phrase muted truncate">{phrase(task)}</span>
                </span>
                {task.thread > 0 && (
                  <button type="button" className="btn btn-small" onClick={() => { setOpen(false); openThreadPanel(bot.id, task.thread); }}>
                    {t("lanes.open")}
                  </button>
                )}
                <button type="button" className="btn btn-small btn-ghost-danger" disabled={stopping.has(task.thread)} onClick={() => void stop(task.thread)} aria-label={t("lanes.stopOne", { name: taskLabel(task.thread, rows) })}>
                  <Icon name="stop" size={14} /> {t("lanes.stop")}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-small btn-ghost-danger lanes-stopall" disabled={stopping.has("all")} onClick={() => void stop()}>
            <Icon name="stop" size={14} /> {t("lanes.stopAll")}
          </button>
        </div>
      )}
    </div>
  );
}
