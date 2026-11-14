import { useCallback, useEffect, useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { t, useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, FileEntry, Routine } from "../types";
import { accentStyle } from "../lib/colors";
import { botTitle, dateTime, fileSize, hostName, relTime, sortTasks } from "../lib/format";
import { endCall, startCall } from "../lib/call";
import { useScreen } from "../lib/screen";
import { canCall, canSpeak, makeUtterance, useVoices } from "../lib/speech";
import { BotAvatar } from "./Avatar";
import { SubscriptionBadge } from "./Brain";
import { LiveScreen } from "./LiveScreen";
import { Icon, Spinner } from "./Icon";
import { Empty, ErrorNote, IconButton, Loading, Toggle } from "./ui";

type Tab = "activity" | "tasks" | "library";

export function routineWhen(r: Routine): string {
  if (!r.enabled) return t("routine.paused");
  if (r.trigger === "webhook") return t("routine.webhookWhen");
  if (r.trigger === "watch") return r.watch ? t(r.watch.kind === "url" ? "routine.watchUrl" : "routine.watchFile", { target: r.watch.kind === "url" ? hostName(r.watch.target) : r.watch.target }) : t("routine.watchWhen");
  if (r.trigger === "once") return r.runAt ? t("routine.once", { date: dateTime(r.runAt, r.timezone || undefined) }) : t("routine.onceNoDate");
  return r.describe || r.schedule;
}

export function TriggerChip({ trigger }: { trigger: Routine["trigger"] }) {
  const t = useT();
  return (
    <span className="chip">
      <Icon name={trigger === "webhook" ? "hook" : trigger === "watch" ? "eye" : "clock"} size={12} />
      {t(`routine.trigger.${trigger}`)}
    </span>
  );
}

/* ---------- Activity tab sections ---------- */

function Upcoming({ bot }: { bot: Bot }) {
  const routines = useStore((s) => s.bundles[bot.id]?.routines);
  const { toggleRoutine, openBotSettings } = useStore.getState();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="section">
      <div className="section-head">
        <h3>{t("details.upcoming")}</h3>
        <button type="button" className="link" onClick={() => openBotSettings(bot.id, "routines")}>{t("details.manage")}</button>
      </div>
      {!routines && <Loading />}
      {routines && routines.length === 0 && (
        <p className="muted small">{t("details.noRoutines")}</p>
      )}
      {routines && routines.length > 0 && (
        <ul className="list">
          {routines.map((r) => (
            <li key={r.id} className="list-row" title={r.prompt}>
              <div className="list-row-text">
                <span className="list-row-title truncate">{r.name}</span>
                <span className="list-row-sub truncate">{routineWhen(r)}</span>
              </div>
              <Toggle
                checked={r.enabled}
                label={t(r.enabled ? "routine.pause" : "routine.resume", { name: r.name })}
                onChange={(next) => {
                  setError(null);
                  toggleRoutine(r, next).catch((e: unknown) => setError(errText(e)));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function Members({ room }: { room: Bot }) {
  const bots = useStore((s) => s.bots);
  const loadBots = useStore((s) => s.loadBots);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const members = room.memberIds.map((id) => bots[id]).filter((b): b is Bot => !!b);
  const candidates = Object.values(bots).filter((b) => b.kind === "agent" && !room.memberIds.includes(b.id));

  const save = async (botIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await api("PUT", `/rooms/${room.id}/members`, { botIds });
      await loadBots();
      setAdding(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h3>{t("details.members")}</h3>
        {busy && <Spinner size={14} />}
      </div>
      {members.length === 0 ? (
        <p className="muted small">{t("details.noMembers")}</p>
      ) : (
        <ul className="list">
          {members.map((m) => (
            <li key={m.id} className="list-row">
              <BotAvatar bot={m} size={28} />
              <div className="list-row-text">
                <span className="list-row-title truncate">{m.name}</span>
                {m.label && <span className="list-row-sub truncate">{m.label}</span>}
              </div>
              <IconButton
                icon="close"
                size={15}
                label={t("details.removeMember", { name: m.name })}
                title={members.length <= 2 ? t("details.needTwo") : t("details.removeMember", { name: m.name })}
                disabled={busy || members.length <= 2}
                onClick={() => void save(room.memberIds.filter((id) => id !== m.id))}
              />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        candidates.length === 0 ? (
          <p className="muted small">{t("details.allIn")}</p>
        ) : (
          <ul className="list list-pick">
            {candidates.map((c) => (
              <li key={c.id}>
                <button type="button" className="list-row list-row-btn" disabled={busy} onClick={() => void save([...room.memberIds, c.id])}>
                  <BotAvatar bot={c} size={24} />
                  <span className="list-row-title truncate">{botTitle(c)}</span>
                  <Icon name="plus" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <button type="button" className="btn btn-small" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> {t("details.addBot")}
        </button>
      )}
      <p className="muted small">{t("details.mentionHint")}</p>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

/** True while the browser tab is visible. */
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

function ComputerSection({ bot }: { bot: Bot }) {
  const computer = useStore((s) => s.computer);
  const viewerOpen = useStore((s) => !!s.viewerBotId);
  const { openViewer, showToast } = useStore.getState();
  const t = useT();
  const tabVisible = useTabVisible();
  const desktop = computer?.desktops.find((d) => d.botId === bot.id);
  const engine = computer ? computer.browser : true;
  const linux = computer?.kind === "linux";
  // A small watch-only live stream while the computer is open and the panel can be seen (this section
  // only exists on the Activity tab). The polled screenshot stays the fallback if the stream fails.
  const liveKey = `${bot.id}-${desktop?.open}`;
  const [liveFailedFor, setLiveFailedFor] = useState<string | null>(null);
  const [liveUp, setLiveUp] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const live = linux && !!desktop?.open && tabVisible && !viewerOpen && liveFailedFor !== liveKey;
  const { url, status, refresh } = useScreen(bot.id, 4000, engine && !(live && liveUp));
  const [busy, setBusy] = useState<"tidy" | "wake" | null>(null);

  const tidy = async () => {
    setBusy("tidy");
    try {
      await api("POST", `/bots/${bot.id}/desktop/tidy`);
      showToast(t("details.tidied"));
    } catch (e) {
      showToast(t("details.tidyFailed", { error: errText(e) }));
    }
    setBusy(null);
    refresh();
  };
  const wake = async () => {
    setBusy("wake");
    try { await api("POST", `/bots/${bot.id}/desktop/wake`); } catch { /* the status line shows the problem */ }
    setBusy(null);
    refresh();
  };

  const asleep = status === "none" && !(live && liveUp);
  const text = !engine
    ? t("computer.noneTitle")
    : live && liveUp
      ? desktop?.url || t("computer.awake")
      : status === "ok"
        ? desktop?.url || (linux ? t("computer.awake") : t("details.desktopOpen"))
        : status === "none"
          ? linux ? t("computer.asleep") : t("details.noDesktop")
          : status === "error"
            ? t("details.unreachable")
            : t("details.checking");
  return (
    <section className="section">
      <div className="section-head">
        <h3>{t("details.computer")}</h3>
      </div>
      <div className="screen-card-wrap">
        <button type="button" className="screen-card" onClick={() => openViewer(bot.id)} aria-label={t("details.openComputer", { name: bot.name })}>
          <span className={`screen-thumb ${live ? "is-live" : ""}`}>
            {live && (
              <LiveScreen
                key={attempt}
                botId={bot.id}
                control={false}
                label={t("viewer.screenAlt", { name: bot.name })}
                onConnect={() => setLiveUp(true)}
                onClose={() => {
                  // A stream that drops after working reconnects once; one that never opened falls back to screenshots.
                  if (liveUp) setAttempt((n) => n + 1);
                  else setLiveFailedFor(liveKey);
                  setLiveUp(false);
                }}
              />
            )}
            {live && liveUp ? null : url ? <img src={url} alt="" /> : (status === "loading" || live) && engine ? <span className="dot-inline dot-pulse" /> : <Icon name="monitor" size={22} />}
          </span>
          <span className="screen-card-text">
            <span className="list-row-title">{t(linux ? "details.linuxOf" : "details.desktopOf", { name: bot.name })}</span>
            <span className="list-row-sub truncate">
              {live && liveUp && <span className="dot-inline dot-live" />}
              {text}
            </span>
          </span>
        </button>
        {engine && (
          <div className="screen-actions" role="group" aria-label={t("details.screenActions")}>
            <IconButton icon="expand" size={14} label={t("details.watch")} onClick={() => openViewer(bot.id)} />
            <IconButton icon="cursor" size={14} label={t("details.takeControl")} onClick={() => openViewer(bot.id, { control: true })} />
            {linux && !asleep && (
              <IconButton icon="tidy" size={14} label={t("details.tidy")} disabled={busy !== null} className={busy === "tidy" ? "is-busy" : ""} onClick={() => void tidy()} />
            )}
            {linux && asleep && (
              <IconButton icon="bolt" size={14} label={t("details.wake")} disabled={busy !== null} className={busy === "wake" ? "is-busy" : ""} onClick={() => void wake()} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const RATES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];

function VoiceSection({ bot }: { bot: Bot }) {
  const voices = useVoices();
  const inCall = useStore((s) => s.call?.botId === bot.id);
  const upsertBot = useStore((s) => s.upsertBot);
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const speech = canSpeak();
  const callable = canCall();
  const voice = bot.voice;

  const names = useMemo(() => {
    const list = [...new Set(voices.map((v) => v.name))];
    if (voice.name && !list.includes(voice.name)) list.unshift(voice.name);
    return list;
  }, [voices, voice.name]);
  const langs = useMemo(() => {
    const list = [...new Set(voices.map((v) => v.lang).filter(Boolean))].sort();
    if (voice.lang && voice.lang !== "auto" && !list.includes(voice.lang)) list.unshift(voice.lang);
    return list;
  }, [voices, voice.lang]);
  const rates = RATES.includes(voice.rate) ? RATES : [...RATES, voice.rate].sort((a, b) => a - b);

  const save = async (patch: Partial<Bot["voice"]>) => {
    const before = bot;
    const next = { ...voice, ...patch };
    upsertBot({ ...bot, voice: next });
    setError(null);
    try {
      const r = await api<{ bot: Bot }>("PATCH", `/bots/${bot.id}`, { voice: next });
      upsertBot(r.bot);
    } catch (e) {
      const cur = useStore.getState().bots[bot.id];
      if (cur) upsertBot({ ...cur, voice: before.voice });
      setError(errText(e));
    }
  };

  const preview = () => {
    if (!speech) return;
    window.speechSynthesis.cancel();
    const u = makeUtterance(t("voice.sample", { name: bot.name }), voice);
    u.onend = u.onerror = () => setPreviewing(false);
    setPreviewing(true);
    window.speechSynthesis.speak(u);
  };

  const off = !speech ? t("voice.unsupported") : undefined;
  return (
    <section className="section">
      <div className="section-head">
        <h3>{t("voice.heading")}</h3>
      </div>
      <div className="form-grid" title={off}>
        <label className="field-label" htmlFor={`voice-${bot.id}`}>{t("voice.voice")}</label>
        <div className="row-gap">
          <select id={`voice-${bot.id}`} className="input input-small" value={voice.name} disabled={!speech} onChange={(e) => void save({ name: e.target.value })}>
            <option value="">{t("voice.default")}</option>
            {names.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button type="button" className="btn btn-small" onClick={preview} disabled={!speech || previewing} title={off ?? t("voice.hear")}>
            <Icon name="play" size={12} /> {t(previewing ? "voice.playing" : "voice.preview")}
          </button>
        </div>
        <label className="field-label" htmlFor={`rate-${bot.id}`}>{t("voice.speed")}</label>
        <select id={`rate-${bot.id}`} className="input input-small" value={String(voice.rate)} disabled={!speech} onChange={(e) => void save({ rate: Number(e.target.value) })}>
          {rates.map((r) => (
            <option key={r} value={String(r)}>{r === 1 ? t("voice.normal") : `${r}×`}</option>
          ))}
        </select>
        <label className="field-label" htmlFor={`lang-${bot.id}`}>{t("voice.language")}</label>
        <select id={`lang-${bot.id}`} className="input input-small" value={voice.lang || "auto"} disabled={!speech} onChange={(e) => void save({ lang: e.target.value })}>
          <option value="auto">{t("voice.auto")}</option>
          {langs.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <button
        type="button"
        className={`btn btn-block ${inCall ? "btn-danger" : "btn-accent"}`}
        disabled={!callable}
        title={callable ? undefined : t("composer.voiceUnsupported")}
        onClick={() => (inCall ? endCall() : startCall(bot.id))}
      >
        <Icon name={inCall ? "phoneOff" : "wave"} size={16} /> {t(inCall ? "composer.endCall" : "composer.startCall")}
      </button>
    </section>
  );
}

/* ---------- Tasks tab ---------- */

function TasksTab({ bot }: { bot: Bot }) {
  const tasks = useStore((s) => s.bundles[bot.id]?.tasks);
  const setView = useStore((s) => s.setView);
  const t = useT();
  const sorted = useMemo(() => (tasks ? sortTasks(tasks) : null), [tasks]);
  return (
    <section className="section">
      <div className="section-head">
        <h3>{t("sidebar.tasks")}</h3>
        <button type="button" className="link" onClick={() => setView("tasks")}>{t("details.seeAll")}</button>
      </div>
      {!sorted && <Loading />}
      {sorted && sorted.length === 0 && <Empty icon="tasks">{t("details.tasksEmpty", { name: bot.name })}</Empty>}
      {sorted && sorted.length > 0 && (
        <ul className="list">
          {sorted.map((task) => (
            <li key={task.id} className={`list-row task-mini is-${task.state}`}>
              <Icon name={task.state === "done" ? "tasks" : "ring"} size={17} />
              <div className="list-row-text">
                <span className="list-row-title">{task.title}</span>
                {task.note && <span className="list-row-sub">{task.note}</span>}
                <span className="list-row-sub">{t(`task.chip.${task.state}`)} · {relTime(task.updatedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Library tab ---------- */

function LibraryTab({ bot }: { bot: Bot }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const t = useT();

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setError(null);
    api<{ entries: FileEntry[] }>("GET", `/bots/${bot.id}/files?path=${enc(path)}`)
      .then((r) => {
        if (dead) return;
        setEntries([...r.entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
      })
      .catch((e: unknown) => {
        if (dead) return;
        setEntries(null);
        setError(errText(e));
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [bot.id, path, tick]);

  const parts = path ? path.split("/") : [];
  const join = (name: string) => (path ? `${path}/${name}` : name);
  const download = useCallback(
    (name: string) => {
      window.location.assign(`/api/bots/${bot.id}/files/download?path=${enc(path ? `${path}/${name}` : name)}`);
    },
    [bot.id, path],
  );

  return (
    <section className="section">
      <div className="section-head">
        <nav className="crumbs" aria-label={t("library.path")}>
          <button type="button" className="link" onClick={() => setPath("")} aria-current={parts.length === 0 ? "page" : undefined}>{t("library.root")}</button>
          {parts.map((p, i) => (
            <span key={i} className="crumb">
              <Icon name="chevronRight" size={12} />
              <button type="button" className="link" onClick={() => setPath(parts.slice(0, i + 1).join("/"))} aria-current={i === parts.length - 1 ? "page" : undefined}>
                {p}
              </button>
            </span>
          ))}
        </nav>
        <IconButton icon="refresh" size={15} label={t("library.refresh")} className={loading ? "is-spinning" : ""} onClick={() => setTick((n) => n + 1)} />
      </div>
      {loading && !entries && <Loading />}
      {error && (
        <Empty icon="alert" title={t("library.loadFailed")}>{error}</Empty>
      )}
      {!error && entries && entries.length === 0 && (
        <Empty icon="folder">
          {path ? t("library.emptyFolder") : t("library.emptyRoot", { name: bot.name })}
        </Empty>
      )}
      {!error && entries && entries.length > 0 && (
        <ul className="list">
          {entries.map((f) => (
            <li key={f.name} className="file-row">
              <button type="button" className="list-row list-row-btn" onClick={() => (f.dir ? setPath(join(f.name)) : download(f.name))} title={f.dir ? t("library.open", { name: f.name }) : t("attach.downloadName", { name: f.name })}>
                <Icon name={f.dir ? "folder" : "file"} size={18} />
                <span className="list-row-text">
                  <span className="list-row-title truncate">{f.name}</span>
                  <span className="list-row-sub">{f.dir ? t("library.folder") : fileSize(f.size)} · {relTime(f.modifiedAt)}</span>
                </span>
                {!f.dir && <Icon name="download" size={15} className="file-dl" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Panel ---------- */

export function DetailsPanel() {
  const bot = useStore((s) => (s.selectedId ? s.bots[s.selectedId] : undefined));
  const { toggleDetails, openBotSettings } = useStore.getState();
  const [tab, setTab] = useState<Tab>("activity");
  const t = useT();
  if (!bot) return null;
  const isRoom = bot.kind === "room";
  const tabs: { id: Tab; label: string }[] = [
    { id: "activity", label: t("details.tab.activity") },
    { id: "tasks", label: t("details.tab.tasks") },
    { id: "library", label: t("details.tab.library") },
  ];
  return (
    <aside className="details" style={accentStyle(bot.color)} aria-label={t("details.aria", { name: bot.name })}>
      <div className="details-top">
        <IconButton icon="settings" label={t("chat.botSettings")} onClick={() => openBotSettings(bot.id)} />
        <IconButton icon="close" label={t("chat.hideDetails")} onClick={() => toggleDetails(false)} />
      </div>
      <div className="details-id">
        <BotAvatar bot={bot} size={72} badge interactive />
        <h2>{bot.name}</h2>
        {bot.label && <p>{bot.label}</p>}
        {!isRoom && <SubscriptionBadge model={bot.model} />}
      </div>
      <div className="tabs" role="tablist" aria-label={t("details.tabs")}>
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`tab ${tab === x.id ? "is-active" : ""}`} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="details-body" role="tabpanel">
        {tab === "activity" && (
          <>
            <Upcoming bot={bot} />
            {isRoom && <Members room={bot} />}
            {!isRoom && <ComputerSection key={`c${bot.id}`} bot={bot} />}
            {!isRoom && <VoiceSection key={`v${bot.id}`} bot={bot} />}
          </>
        )}
        {tab === "tasks" && <TasksTab bot={bot} />}
        {tab === "library" && <LibraryTab key={bot.id} bot={bot} />}
      </div>
    </aside>
  );
}
