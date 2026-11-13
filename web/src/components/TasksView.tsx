import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { relTime, sortTasks } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { Empty, IconButton, Loading, useTick } from "./ui";

type Filter = "open" | "done" | "all";

export function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const bots = useStore((s) => s.bots);
  const { loadTasks, selectBot, setMobileNav } = useStore.getState();
  const [filter, setFilter] = useState<Filter>("open");
  const now = useTick(30_000);
  const t = useT();

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openCount = tasks?.filter((t) => t.state !== "done").length ?? 0;
  const shown = useMemo(() => {
    if (!tasks) return null;
    return sortTasks(tasks.filter((t) => (filter === "all" ? true : filter === "done" ? t.state === "done" : t.state !== "done")));
  }, [tasks, filter]);

  const filters: { id: Filter; label: string }[] = [
    { id: "open", label: openCount ? t("tasks.filter.openCount", { n: openCount }) : t("tasks.filter.open") },
    { id: "done", label: t("tasks.filter.done") },
    { id: "all", label: t("tasks.filter.all") },
  ];

  return (
    <section className="main tasks-view" aria-label={t("sidebar.tasks")}>
      <header className="tasks-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
        <h1>{t("sidebar.tasks")}</h1>
        <div className="segmented" role="group" aria-label={t("tasks.filterLabel")}>
          {filters.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "is-active" : ""} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </header>
      <div className="tasks-body">
        {!shown && <Loading label={t("tasks.loading")} />}
        {shown && shown.length === 0 && (
          <Empty icon="tasks" title={t(filter === "done" ? "tasks.emptyDoneTitle" : "tasks.emptyOpenTitle")}>
            {t(filter === "done" ? "tasks.emptyDoneText" : "tasks.emptyOpenText")}
          </Empty>
        )}
        {shown && shown.length > 0 && (
          <ul className="task-list">
            {shown.map((task) => {
              const bot = bots[task.botId];
              return (
                <li key={task.id}>
                  <button type="button" className={`task-row is-${task.state}`} onClick={() => bot && selectBot(bot.id)} disabled={!bot}>
                    <span className="task-check">
                      <Icon name={task.state === "done" ? "tasks" : "ring"} size={20} />
                    </span>
                    <span className="task-main">
                      <span className="task-title">{task.title}</span>
                      {task.note && <span className="task-note">{task.note}</span>}
                      <span className="task-meta">
                        {bot ? (
                          <>
                            <BotAvatar bot={bot} size={16} /> {bot.name}
                          </>
                        ) : (
                          t("common.removedBot")
                        )}
                        <span aria-hidden="true">·</span>
                        {t(`task.verb.${task.state}`, { when: relTime(task.updatedAt, now) })}
                      </span>
                    </span>
                    <span className={`chip state-${task.state}`}>{t(`task.chip.${task.state}`)}</span>
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
