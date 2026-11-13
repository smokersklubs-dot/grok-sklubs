import { useCallback, useEffect, useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { useStore } from "../store";
import type { Bot, FileEntry, Routine } from "../types";
import { accentStyle } from "../lib/colors";
import { botTitle, dateTime, fileSize, relTime, sortTasks } from "../lib/format";
import { endCall, startCall } from "../lib/call";
import { useScreen } from "../lib/screen";
import { canCall, canSpeak, makeUtterance, useVoices } from "../lib/speech";
import { BotAvatar } from "./Avatar";
import { Icon, Spinner } from "./Icon";
import { Empty, ErrorNote, IconButton, Loading, Toggle } from "./ui";

type Tab = "activity" | "tasks" | "library";

export function routineWhen(r: Routine): string {
  if (!r.enabled) return "Paused";
  if (r.trigger === "webhook") return "Runs when its webhook is called";
  if (r.trigger === "once") return r.runAt ? `Once, ${dateTime(r.runAt, r.timezone || undefined)}` : "Runs once";
  return r.describe || r.schedule;
}

const TRIGGER_LABEL: Record<Routine["trigger"], string> = { cron: "Schedule", webhook: "Webhook", once: "One-off" };
export function TriggerChip({ trigger }: { trigger: Routine["trigger"] }) {
  return (
    <span className="chip">
      <Icon name={trigger === "webhook" ? "hook" : "clock"} size={12} />
      {TRIGGER_LABEL[trigger]}
    </span>
  );
}

/* ---------- Activity tab sections ---------- */

function Upcoming({ bot }: { bot: Bot }) {
  const routines = useStore((s) => s.bundles[bot.id]?.routines);
  const { toggleRoutine, openBotSettings } = useStore.getState();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="section">
      <div className="section-head">
        <h3>Upcoming</h3>
        <button type="button" className="link" onClick={() => openBotSettings(bot.id, "routines")}>Manage</button>
      </div>
      {!routines && <Loading />}
      {routines && routines.length === 0 && (
        <p className="muted small">No routines yet. Ask in chat — for example, “Every weekday at 9, send me a summary of my inbox.”</p>
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
                label={`${r.enabled ? "Pause" : "Resume"} ${r.name}`}
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
        <h3>Members</h3>
        {busy && <Spinner size={14} />}
      </div>
      {members.length === 0 ? (
        <p className="muted small">No bots in this room yet.</p>
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
                label={`Remove ${m.name}`}
                title={members.length <= 2 ? "A room needs at least two bots" : `Remove ${m.name}`}
                disabled={busy || members.length <= 2}
                onClick={() => void save(room.memberIds.filter((id) => id !== m.id))}
              />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        candidates.length === 0 ? (
          <p className="muted small">Every bot is already in this room.</p>
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
          <Icon name="plus" size={14} /> Add a bot
        </button>
      )}
      <p className="muted small">Type @ and a bot's name to ask it directly.</p>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function ComputerSection({ bot }: { bot: Bot }) {
  const computer = useStore((s) => s.computer);
  const openViewer = useStore((s) => s.openViewer);
  const desktop = computer?.desktops.find((d) => d.botId === bot.id);
  const engine = computer ? computer.browser : true;
  const { url, status } = useScreen(bot.id, 4000, engine);
  const text = !engine
    ? "No computer available"
    : status === "ok"
      ? desktop?.url || (computer?.kind === "linux" ? "Awake" : "Desktop open")
      : status === "none"
        ? computer?.kind === "linux" ? "Asleep — wakes when needed" : "No desktop open yet"
        : status === "error"
          ? "Can't reach the desktop"
          : "Checking…";
  return (
    <section className="section">
      <div className="section-head">
        <h3>Computer</h3>
      </div>
      <button type="button" className="screen-card" onClick={() => openViewer(bot.id)} aria-label={`Open ${bot.name}'s computer`}>
        <span className="screen-thumb">
          {url ? <img src={url} alt="" /> : status === "loading" && engine ? <span className="dot-inline dot-pulse" /> : <Icon name="monitor" size={22} />}
        </span>
        <span className="screen-card-text">
          <span className="list-row-title">{bot.name}'s {computer?.kind === "linux" ? "Linux computer" : "desktop"}</span>
          <span className="list-row-sub truncate">{text}</span>
        </span>
      </button>
    </section>
  );
}

const RATES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];

function VoiceSection({ bot }: { bot: Bot }) {
  const voices = useVoices();
  const inCall = useStore((s) => s.call?.botId === bot.id);
  const upsertBot = useStore((s) => s.upsertBot);
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
    const u = makeUtterance(`Hi, I'm ${bot.name}. This is how I sound.`, voice);
    u.onend = u.onerror = () => setPreviewing(false);
    setPreviewing(true);
    window.speechSynthesis.speak(u);
  };

  const off = !speech ? "Speech isn't supported in this browser" : undefined;
  return (
    <section className="section">
      <div className="section-head">
        <h3>Voice chat</h3>
      </div>
      <div className="form-grid" title={off}>
        <label className="field-label" htmlFor={`voice-${bot.id}`}>Voice</label>
        <div className="row-gap">
          <select id={`voice-${bot.id}`} className="input input-small" value={voice.name} disabled={!speech} onChange={(e) => void save({ name: e.target.value })}>
            <option value="">Browser default</option>
            {names.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button type="button" className="btn btn-small" onClick={preview} disabled={!speech || previewing} title={off ?? "Hear this voice"}>
            <Icon name="play" size={12} /> {previewing ? "Playing…" : "Preview"}
          </button>
        </div>
        <label className="field-label" htmlFor={`rate-${bot.id}`}>Speed</label>
        <select id={`rate-${bot.id}`} className="input input-small" value={String(voice.rate)} disabled={!speech} onChange={(e) => void save({ rate: Number(e.target.value) })}>
          {rates.map((r) => (
            <option key={r} value={String(r)}>{r === 1 ? "1× (normal)" : `${r}×`}</option>
          ))}
        </select>
        <label className="field-label" htmlFor={`lang-${bot.id}`}>Language</label>
        <select id={`lang-${bot.id}`} className="input input-small" value={voice.lang || "auto"} disabled={!speech} onChange={(e) => void save({ lang: e.target.value })}>
          <option value="auto">Auto</option>
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
        title={callable ? undefined : "Voice chat isn't supported in this browser"}
        onClick={() => (inCall ? endCall() : startCall(bot.id))}
      >
        <Icon name={inCall ? "phoneOff" : "wave"} size={16} /> {inCall ? "End voice chat" : "Start voice chat"}
      </button>
    </section>
  );
}

/* ---------- Tasks tab ---------- */

const TASK_CHIP = { working: "Working on it", needs_input: "Waiting on you", done: "Done" } as const;

function TasksTab({ bot }: { bot: Bot }) {
  const tasks = useStore((s) => s.bundles[bot.id]?.tasks);
  const setView = useStore((s) => s.setView);
  const sorted = useMemo(() => (tasks ? sortTasks(tasks) : null), [tasks]);
  return (
    <section className="section">
      <div className="section-head">
        <h3>Tasks</h3>
        <button type="button" className="link" onClick={() => setView("tasks")}>See all</button>
      </div>
      {!sorted && <Loading />}
      {sorted && sorted.length === 0 && <Empty icon="tasks">Nothing on {bot.name}'s plate. Longer jobs you hand over show up here.</Empty>}
      {sorted && sorted.length > 0 && (
        <ul className="list">
          {sorted.map((t) => (
            <li key={t.id} className={`list-row task-mini is-${t.state}`}>
              <Icon name={t.state === "done" ? "tasks" : "ring"} size={17} />
              <div className="list-row-text">
                <span className="list-row-title">{t.title}</span>
                {t.note && <span className="list-row-sub">{t.note}</span>}
                <span className="list-row-sub">{TASK_CHIP[t.state]} · {relTime(t.updatedAt)}</span>
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
        <nav className="crumbs" aria-label="Folder path">
          <button type="button" className="link" onClick={() => setPath("")} aria-current={parts.length === 0 ? "page" : undefined}>Library</button>
          {parts.map((p, i) => (
            <span key={i} className="crumb">
              <Icon name="chevronRight" size={12} />
              <button type="button" className="link" onClick={() => setPath(parts.slice(0, i + 1).join("/"))} aria-current={i === parts.length - 1 ? "page" : undefined}>
                {p}
              </button>
            </span>
          ))}
        </nav>
        <IconButton icon="refresh" size={15} label="Refresh" className={loading ? "is-spinning" : ""} onClick={() => setTick((t) => t + 1)} />
      </div>
      {loading && !entries && <Loading />}
      {error && (
        <Empty icon="alert" title="Couldn't load files">{error}</Empty>
      )}
      {!error && entries && entries.length === 0 && (
        <Empty icon="folder">
          {path ? "This folder is empty." : `Reports, notes and other files ${bot.name} saves will appear here.`}
        </Empty>
      )}
      {!error && entries && entries.length > 0 && (
        <ul className="list">
          {entries.map((f) => (
            <li key={f.name} className="file-row">
              <button type="button" className="list-row list-row-btn" onClick={() => (f.dir ? setPath(join(f.name)) : download(f.name))} title={f.dir ? `Open ${f.name}` : `Download ${f.name}`}>
                <Icon name={f.dir ? "folder" : "file"} size={18} />
                <span className="list-row-text">
                  <span className="list-row-title truncate">{f.name}</span>
                  <span className="list-row-sub">{f.dir ? "Folder" : fileSize(f.size)} · {relTime(f.modifiedAt)}</span>
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
  if (!bot) return null;
  const isRoom = bot.kind === "room";
  const tabs: { id: Tab; label: string }[] = [
    { id: "activity", label: "Activity" },
    { id: "tasks", label: "Tasks" },
    { id: "library", label: "Library" },
  ];
  return (
    <aside className="details" style={accentStyle(bot.color)} aria-label={`${bot.name} details`}>
      <div className="details-top">
        <IconButton icon="settings" label="Bot settings" onClick={() => openBotSettings(bot.id)} />
        <IconButton icon="close" label="Hide details" onClick={() => toggleDetails(false)} />
      </div>
      <div className="details-id">
        <BotAvatar bot={bot} size={72} badge />
        <h2>{bot.name}</h2>
        {bot.label && <p>{bot.label}</p>}
      </div>
      <div className="tabs" role="tablist" aria-label="Details">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "is-active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
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
