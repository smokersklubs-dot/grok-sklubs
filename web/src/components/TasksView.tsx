import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Task } from "../types";
import { relTime, sortTasks } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { Empty, IconButton, Loading, useTick } from "./ui";

type Filter = "open" | "done" | "all";
const CHIP: Record<Task["state"], string> = { working: "Working on it", needs_input: "Waiting on you", done: "Done" };
const VERB: Record<Task["state"], string> = { working: "Updated", needs_input: "Asked", done: "Completed" };

export function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const bots = useStore((s) => s.bots);
  const { loadTasks, selectBot, setMobileNav } = useStore.getState();
  const [filter, setFilter] = useState<Filter>("open");
  const now = useTick(30_000);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openCount = tasks?.filter((t) => t.state !== "done").length ?? 0;
  const shown = useMemo(() => {
    if (!tasks) return null;
    return sortTasks(tasks.filter((t) => (filter === "all" ? true : filter === "done" ? t.state === "done" : t.state !== "done")));
  }, [tasks, filter]);

  const filters: { id: Filter; label: string }[] = [
    { id: "open", label: `In progress${openCount ? ` (${openCount})` : ""}` },
    { id: "done", label: "Done" },
    { id: "all", label: "All" },
  ];

  return (
    <section className="main tasks-view" aria-label="Tasks">
      <header className="tasks-head">
        <IconButton icon="menu" label="Open menu" className="only-mobile" onClick={() => setMobileNav(true)} />
        <h1>Tasks</h1>
        <div className="segmented" role="group" aria-label="Filter tasks">
          {filters.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "is-active" : ""} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </header>
      <div className="tasks-body">
        {!shown && <Loading label="Loading tasks…" />}
        {shown && shown.length === 0 && (
          <Empty icon="tasks" title={filter === "done" ? "Nothing finished yet" : "No tasks right now"}>
            {filter === "done"
              ? "Tasks your bots complete will be listed here."
              : "When you hand a bot a longer job, it tracks it here and tells you when it needs you."}
          </Empty>
        )}
        {shown && shown.length > 0 && (
          <ul className="task-list">
            {shown.map((t) => {
              const bot = bots[t.botId];
              return (
                <li key={t.id}>
                  <button type="button" className={`task-row is-${t.state}`} onClick={() => bot && selectBot(bot.id)} disabled={!bot}>
                    <span className="task-check">
                      <Icon name={t.state === "done" ? "tasks" : "ring"} size={20} />
                    </span>
                    <span className="task-main">
                      <span className="task-title">{t.title}</span>
                      {t.note && <span className="task-note">{t.note}</span>}
                      <span className="task-meta">
                        {bot ? (
                          <>
                            <BotAvatar bot={bot} size={16} /> {bot.name}
                          </>
                        ) : (
                          "Removed bot"
                        )}
                        <span aria-hidden="true">·</span>
                        {VERB[t.state]} {relTime(t.updatedAt, now)}
                      </span>
                    </span>
                    <span className={`chip state-${t.state}`}>{CHIP[t.state]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
