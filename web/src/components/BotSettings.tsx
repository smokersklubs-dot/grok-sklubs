import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useStore, type BotSettingsTab } from "../store";
import type { Autonomy, AvatarColor, AvatarShape, Bot, BotBundle, BotMode, Effort, Memory, ModelOption, Routine, Skill } from "../types";
import { dateTime, nextRunLabel, shortDate } from "../lib/format";
import { Avatar, BotAvatar } from "./Avatar";
import { routineWhen, TriggerChip } from "./DetailsPanel";
import { Icon } from "./Icon";
import { LookPicker, MODES } from "./Modals";
import { ConfirmButton, copyText, Empty, ErrorNote, IconButton, Loading, Modal, Toggle } from "./ui";

const EFFORTS: { id: Effort; title: string; text: string }[] = [
  { id: "low", title: "Low", text: "Fastest replies; best for quick, simple requests." },
  { id: "medium", title: "Medium", text: "A balance of speed and care for everyday work." },
  { id: "high", title: "High", text: "Slower, but reasons more carefully about hard problems." },
  { id: "xhigh", title: "Max", text: "Slowest and most thorough; for the toughest jobs." },
];

const AUTONOMY: { id: Autonomy; title: string; text: string }[] = [
  { id: "careful", title: "Careful", text: "Asks before shell commands, file writes outside its library, and connector changes." },
  { id: "balanced", title: "Balanced", text: "Asks only before making changes through connectors." },
  { id: "trusted", title: "Trusted", text: "Never asks — acts on its own judgement." },
];

function ChoiceList<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; title: string; text: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="choice-list" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`choice ${value === o.id ? "is-selected" : ""}`} onClick={() => onChange(o.id)}>
          <span className="choice-title">{o.title}</span>
          <span className="choice-text">{o.text}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- General ---------- */

interface Form {
  name: string; label: string; description: string; instructions: string;
  shape: AvatarShape; color: AvatarColor; mode: BotMode; effort: Effort; model: string; autonomy: Autonomy;
}
const FORM_KEYS: (keyof Form)[] = ["name", "label", "description", "instructions", "shape", "color", "mode", "effort", "model", "autonomy"];
const formOf = (b: Bot): Form => ({
  name: b.name, label: b.label, description: b.description, instructions: b.instructions,
  shape: b.shape, color: b.color, mode: b.mode, effort: b.effort, model: b.model, autonomy: b.autonomy,
});

function General({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { upsertBot, resetConversation, loadBots } = useStore.getState();
  const [form, setForm] = useState<Form>(() => formOf(bot));
  const [lookOpen, setLookOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [models, setModels] = useState<{ models: ModelOption[]; defaultRef: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const uid = useId();
  const isRoom = bot.kind === "room";

  useEffect(() => {
    let dead = false;
    api<{ models: ModelOption[]; defaultRef: string }>("GET", "/models").then(
      (r) => !dead && setModels(r),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 2400);
    return () => window.clearTimeout(t);
  }, [note]);

  const saved = formOf(bot);
  const changed = FORM_KEYS.filter((k) => form[k] !== saved[k]);
  const dirty = changed.length > 0;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dirty || !form.name.trim() || saving) return;
    const patch: Partial<Form> = {};
    for (const k of changed) Object.assign(patch, { [k]: typeof form[k] === "string" && k !== "instructions" ? (form[k] as string).trim() : form[k] });
    setSaving(true);
    try {
      const r = await api<{ bot: Bot }>("PATCH", `/bots/${bot.id}`, patch);
      upsertBot(r.bot);
      setForm(formOf(r.bot));
      setNote({ tone: "ok", text: "Saved" });
    } catch (err) {
      setNote({ tone: "error", text: errText(err) });
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = useMemo(() => {
    const list = models?.models ?? [];
    return bot.model && !list.some((m) => m.ref === bot.model) ? [{ ref: bot.model, provider: "", model: bot.model }, ...list] : list;
  }, [models, bot.model]);

  return (
    <form className="settings-pane" onSubmit={save}>
      <div className="look-row">
        <Avatar shape={form.shape} color={form.color} name={form.name || bot.name} size={56} primary={bot.primary} />
        <button type="button" className="btn btn-small" onClick={() => setLookOpen((v) => !v)} aria-expanded={lookOpen}>
          {lookOpen ? "Hide look options" : "Change look"}
        </button>
      </div>
      {lookOpen && <LookPicker name={form.name} shape={form.shape} color={form.color} onShape={(s) => set("shape", s)} onColor={(c) => set("color", c)} />}

      <div className="field">
        <label className="field-label" htmlFor={`${uid}n`}>Name</label>
        <input id={`${uid}n`} className="input" value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}l`}>Label</label>
        <input id={`${uid}l`} className="input" value={form.label} maxLength={60} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Research" />
        <p className="field-hint">A short role shown next to the name.</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}d`}>About</label>
        <textarea id={`${uid}d`} className="input" rows={2} value={form.description} maxLength={500} onChange={(e) => set("description", e.target.value)} />
      </div>

      {!isRoom && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}i`}>Instructions</label>
            <textarea
              id={`${uid}i`}
              className="input"
              rows={6}
              value={form.instructions}
              maxLength={8000}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder={"e.g. You look after my weekly reporting. Keep summaries under 200 words, lead with what changed, and always link your sources."}
            />
            <p className="field-hint">How this bot should behave, what it's responsible for, and anything it should always or never do.</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}m`}>Model</label>
            <select id={`${uid}m`} className="input" value={form.model} onChange={(e) => set("model", e.target.value)}>
              <option value="">Server default{models?.defaultRef ? ` (${models.defaultRef})` : ""}</option>
              {modelOptions.map((m) => (
                <option key={m.ref} value={m.ref}>{m.provider ? `${m.provider} · ${m.model}` : m.model}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Thinking effort</span>
            <ChoiceList label="Thinking effort" value={form.effort} options={EFFORTS} onChange={(v) => set("effort", v)} />
          </div>
          <div className="field">
            <span className="field-label">Autonomy</span>
            <ChoiceList label="Autonomy" value={form.autonomy} options={AUTONOMY} onChange={(v) => set("autonomy", v)} />
          </div>
          <div className="field">
            <span className="field-label">Used as</span>
            <ChoiceList label="Used as" value={form.mode} options={MODES} onChange={(v) => set("mode", v)} />
          </div>
        </>
      )}

      <div className={`save-bar ${dirty || note ? "is-visible" : ""}`}>
        <span className={`save-note ${note?.tone === "error" ? "is-error" : ""}`} role="status">{note ? note.text : dirty ? "Unsaved changes" : ""}</span>
        <button type="button" className="btn btn-ghost btn-small" disabled={!dirty || saving} onClick={() => setForm(formOf(bot))}>Discard</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!dirty || !form.name.trim() || saving}>{saving ? "Saving…" : "Save"}</button>
      </div>

      <h3 className="pane-heading">Conversation</h3>
      <div className="action-row">
        <div>
          <p className="action-title">Start a new conversation</p>
          <p className="muted small">Clears the chat. Memories, skills and routines are kept.</p>
        </div>
        <ConfirmButton
          label="New conversation"
          confirmLabel="Confirm — clear chat"
          busyLabel="Clearing…"
          className="btn btn-small"
          onConfirm={async () => {
            setActionError(null);
            try {
              await resetConversation(bot.id);
              setNote({ tone: "ok", text: "New conversation started" });
            } catch (e) {
              setActionError(errText(e));
            }
          }}
        />
      </div>
      {!bot.primary && !isRoom && (
        <div className="action-row">
          <div>
            <p className="action-title">Make primary</p>
            <p className="muted small">Your primary bot sits at the top of the sidebar and is your default assistant.</p>
          </div>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              setActionError(null);
              try {
                await api("POST", `/bots/${bot.id}/primary`);
                await loadBots();
              } catch (e) {
                setActionError(errText(e));
              }
            }}
          >
            Make primary
          </button>
        </div>
      )}

      <h3 className="pane-heading is-danger">Danger zone</h3>
      <div className="action-row">
        <div>
          <p className="action-title">Delete {isRoom ? "room" : "bot"}</p>
          <p className="muted small">
            {bot.primary ? "Make another bot primary first — the primary bot can't be deleted." : "Removes its chat, memories, skills and routines for good."}
          </p>
        </div>
        <ConfirmButton
          label="Delete"
          confirmLabel="Confirm delete"
          busyLabel="Deleting…"
          className="btn btn-small btn-danger"
          disabled={bot.primary}
          onConfirm={async () => {
            setActionError(null);
            try {
              await api("DELETE", `/bots/${bot.id}`);
              onClose();
              await loadBots();
            } catch (e) {
              setActionError(errText(e));
            }
          }}
        />
      </div>
      <ErrorNote>{actionError}</ErrorNote>
    </form>
  );
}

/* ---------- Skills ---------- */

function SkillEditor({ botId, skill, onDone }: { botId: string; skill: Skill | null; onDone: () => void }) {
  const loadBundle = useStore((s) => s.loadBundle);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const payload = { name: name.trim(), description: description.trim(), body };
    try {
      if (skill) await api("PATCH", `/skills/${skill.id}`, payload);
      else await api("POST", `/bots/${botId}/skills`, payload);
      await loadBundle(botId);
      onDone();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <form className="editor" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}n`}>Name</label>
        <input ref={first} id={`${uid}n`} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly report" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}d`}>When to use it <span className="muted">(optional)</span></label>
        <input id={`${uid}d`} className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. When I ask for the weekly numbers" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}b`}>Steps</label>
        <textarea id={`${uid}b`} className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"1. Gather…\n2. Summarise…\n3. Send…"} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!name.trim() || !body.trim() || busy}>{busy ? "Saving…" : "Save skill"}</button>
      </div>
    </form>
  );
}

function Skills({ bot, bundle }: { bot: Bot; bundle: BotBundle | undefined }) {
  const loadBundle = useStore((s) => s.loadBundle);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skills = bundle?.skills;
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">Skills are step-by-step playbooks {bot.name} follows for recurring jobs. It can also write its own when you teach it something in chat.</p>
        {editing === null && (
          <button type="button" className="btn btn-small" onClick={() => setEditing("new")}>
            <Icon name="plus" size={14} /> New skill
          </button>
        )}
      </div>
      {editing === "new" && <SkillEditor botId={bot.id} skill={null} onDone={() => setEditing(null)} />}
      {!skills && <Loading />}
      {skills && skills.length === 0 && editing === null && <Empty icon="book" title="No skills yet">Add one, or walk {bot.name} through a task in chat and ask it to save the steps.</Empty>}
      <ErrorNote>{error}</ErrorNote>
      {skills && skills.length > 0 && (
        <ul className="list">
          {skills.map((s) =>
            editing !== "new" && editing?.id === s.id ? (
              <li key={s.id}>
                <SkillEditor botId={bot.id} skill={s} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={s.id} className="list-row is-card">
                <div className="list-row-text">
                  <span className="list-row-title">{s.name}</span>
                  <span className="list-row-sub">{s.description || s.body.split("\n").find((l) => l.trim()) || ""}</span>
                </div>
                <IconButton icon="edit" size={16} label={`Edit ${s.name}`} onClick={() => setEditing(s)} />
                <ConfirmButton
                  className="btn btn-small btn-ghost-danger"
                  label="Delete"
                  confirmLabel="Confirm"
                  busyLabel="…"
                  onConfirm={async () => {
                    setError(null);
                    try {
                      await api("DELETE", `/skills/${s.id}`);
                      await loadBundle(bot.id);
                    } catch (e) {
                      setError(errText(e));
                    }
                  }}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/* ---------- Memories ---------- */

function Memories({ bot, bundle }: { bot: Bot; bundle: BotBundle | undefined }) {
  const { mutateBundle, loadBundle } = useStore.getState();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"consolidate" | "compact" | null>(null);
  const memories = bundle?.memories;
  const status = bundle?.memoryStatus;
  const needle = q.trim().toLowerCase();
  const shown = memories?.filter((m) => !needle || m.text.toLowerCase().includes(needle));
  const percent = status && status.compactAt > 0 ? Math.min(100, Math.round((status.historyChars / status.compactAt) * 100)) : 0;

  const forget = async (m: Memory) => {
    setError(null);
    mutateBundle(bot.id, (b) => ({ ...b, memories: b.memories.filter((x) => x.id !== m.id) }));
    try {
      await api("DELETE", `/memories/${m.id}`);
    } catch (e) {
      mutateBundle(bot.id, (b) => (b.memories.some((x) => x.id === m.id) ? b : { ...b, memories: [...b.memories, m].sort((a, c) => c.createdAt - a.createdAt) }));
      setError(errText(e));
    }
  };

  const consolidate = async () => {
    setBusy("consolidate");
    setError(null);
    try {
      const r = await api<{ added: string[]; considered: number }>("POST", `/bots/${bot.id}/consolidate`);
      setNote(r.added.length ? `Picked up ${r.added.length} new ${r.added.length === 1 ? "memory" : "memories"}.` : "Nothing new worth remembering.");
      await loadBundle(bot.id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const compact = async () => {
    setBusy("compact");
    setError(null);
    try {
      const r = await api<{ before: number; after: number; changed: boolean }>("POST", `/bots/${bot.id}/compact`);
      setNote(r.changed ? "Older messages were summarised." : "Nothing to summarise yet.");
      await loadBundle(bot.id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">What {bot.name} remembers between conversations. Say “remember that…” in chat to save something, and it also picks up useful facts on its own.</p>
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void consolidate()} title="Look through recent chat for things worth remembering">
          {busy === "consolidate" ? "Reviewing…" : "Review recent chat"}
        </button>
      </div>
      {memories && memories.length > 6 && (
        <div className="search-field is-inline">
          <Icon name="search" size={16} />
          <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories…" aria-label="Search memories" />
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {note && <p className="muted small" role="status">{note}</p>}
      {!memories && <Loading />}
      {memories && memories.length === 0 && <Empty icon="brain" title="No memories yet">They'll appear here as you work together.</Empty>}
      {memories && memories.length > 0 && shown && shown.length === 0 && <p className="muted small">No memories match “{q.trim()}”.</p>}
      {shown && shown.length > 0 && (
        <ul className="list">
          {shown.map((m) => (
            <li key={m.id} className="list-row is-card">
              <div className="list-row-text">
                <span className="memory-text">{m.text}</span>
                <span className="list-row-sub">
                  <span className="chip">{m.source === "learned" ? "Picked up" : "Saved in chat"}</span> {shortDate(m.createdAt)}
                </span>
              </div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void forget(m)} aria-label={`Forget: ${m.text.slice(0, 60)}`}>Forget</button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="pane-heading">Conversation memory</h3>
      {status ? (
        <div className="meter-box">
          <div className="meter-head">
            <span>{percent}% full</span>
            <button type="button" className="link" disabled={busy !== null} onClick={() => void compact()}>{busy === "compact" ? "Summarising…" : "Summarise now"}</button>
          </div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Conversation memory used">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="muted small">
            When this fills up, older messages are summarised so {bot.name} keeps the gist without the bulk.
            {status.lastCompactedAt ? ` Last summarised ${shortDate(status.lastCompactedAt)}.` : " Not summarised yet."}
            {status.lastConsolidatedAt ? ` Memories last reviewed ${shortDate(status.lastConsolidatedAt)}.` : ""}
          </p>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

/* ---------- Routines ---------- */

function RoutineItem({ r, onNote, onError }: { r: Routine; onNote: (t: string) => void; onError: (t: string | null) => void }) {
  const { toggleRoutine, loadBundle } = useStore.getState();
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const next = !r.enabled ? "Paused" : r.trigger === "webhook" ? null : r.nextRunAt ? `Next ${nextRunLabel(r.nextRunAt, r.timezone || undefined)}` : null;
  return (
    <li className="routine">
      <div className="routine-head">
        <div className="list-row-text">
          <span className="list-row-title">
            {r.name} <TriggerChip trigger={r.trigger} />
          </span>
          <span className="list-row-sub">
            {r.trigger === "once" && r.runAt ? `Runs once on ${dateTime(r.runAt, r.timezone || undefined)}` : routineWhen({ ...r, enabled: true })}
            {next ? ` · ${next}` : ""}
            {r.lastRunAt ? ` · last ran ${shortDate(r.lastRunAt)}` : ""}
          </span>
        </div>
        <Toggle
          checked={r.enabled}
          label={`${r.enabled ? "Pause" : "Resume"} ${r.name}`}
          onChange={(v) => {
            onError(null);
            toggleRoutine(r, v).then(
              () => onNote(v ? "Resumed" : "Paused"),
              (e: unknown) => onError(errText(e)),
            );
          }}
        />
      </div>
      <p className="routine-prompt">{r.prompt}</p>
      {r.trigger === "webhook" && r.hookUrl && (
        <div className="hook">
          <code className="truncate" title={r.hookUrl}>{r.hookUrl}</code>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              if (await copyText(r.hookUrl ?? "")) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              } else onError("Couldn't copy — select the address and copy it manually.");
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <div className="row-end">
        <button
          type="button"
          className="btn btn-small"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            onError(null);
            try {
              await api("POST", `/routines/${r.id}/run`);
              onNote("Running now");
            } catch (e) {
              onError(errText(e));
            } finally {
              setRunning(false);
            }
          }}
        >
          <Icon name="bolt" size={13} /> {running ? "Starting…" : "Run now"}
        </button>
        <ConfirmButton
          className="btn btn-small btn-ghost-danger"
          label="Delete"
          confirmLabel="Confirm delete"
          busyLabel="Deleting…"
          onConfirm={async () => {
            onError(null);
            try {
              await api("DELETE", `/routines/${r.id}`);
              await loadBundle(r.botId);
              onNote("Deleted");
            } catch (e) {
              onError(errText(e));
            }
          }}
        />
      </div>
    </li>
  );
}

function Routines({ bot, bundle }: { bot: Bot; bundle: BotBundle | undefined }) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 2400);
    return () => window.clearTimeout(t);
  }, [note]);
  const routines = bundle?.routines;
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">Routines run on a schedule, once at a set time, or when a webhook is called. To add or change one, just ask {bot.name} in chat.</p>
        {note && <span className="chip state-ready" role="status">{note}</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!routines && <Loading />}
      {routines && routines.length === 0 && <Empty icon="clock" title="No routines yet">Try “Every Monday at 8, plan my week” in chat.</Empty>}
      {routines && routines.length > 0 && (
        <ul className="list">
          {routines.map((r) => (
            <RoutineItem key={r.id} r={r} onNote={setNote} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Dialog ---------- */

export function BotSettings({ botId, tab }: { botId: string; tab: BotSettingsTab }) {
  const bot = useStore((s) => s.bots[botId]);
  const bundle = useStore((s) => s.bundles[botId]);
  const { closeBotSettings, openBotSettings, loadBundle } = useStore.getState();

  useEffect(() => {
    void loadBundle(botId);
  }, [botId, loadBundle]);
  useEffect(() => {
    if (!bot) closeBotSettings();
  }, [bot, closeBotSettings]);
  if (!bot) return null;

  const isRoom = bot.kind === "room";
  const tabs: { id: BotSettingsTab; label: string; icon: "settings" | "book" | "brain" | "clock"; count?: number }[] = isRoom
    ? [{ id: "general", label: "General", icon: "settings" }]
    : [
        { id: "general", label: "General", icon: "settings" },
        { id: "skills", label: "Skills", icon: "book", count: bundle?.skills.length },
        { id: "memories", label: "Memories", icon: "brain", count: bundle?.memories.length },
        { id: "routines", label: "Routines", icon: "clock", count: bundle?.routines.length },
      ];
  const active = tabs.some((t) => t.id === tab) ? tab : "general";

  return (
    <Modal
      title={`${bot.name} settings`}
      onClose={closeBotSettings}
      size="xl"
      className="bot-settings"
      header={
        <div className="modal-head">
          <BotAvatar bot={bot} size={30} badge />
          <span className="modal-head-title truncate">{bot.name}</span>
          <IconButton icon="close" label="Close" onClick={closeBotSettings} />
        </div>
      }
    >
      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-label="Bot settings" aria-orientation="vertical">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={`settings-nav-item ${active === t.id ? "is-active" : ""}`} onClick={() => openBotSettings(bot.id, t.id)}>
              <Icon name={t.icon} size={16} />
              <span className="grow">{t.label}</span>
              {typeof t.count === "number" && <span className="nav-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="settings-content" role="tabpanel">
          {active === "general" && <General key={bot.id} bot={bot} onClose={closeBotSettings} />}
          {active === "skills" && <Skills bot={bot} bundle={bundle} />}
          {active === "memories" && <Memories bot={bot} bundle={bundle} />}
          {active === "routines" && <Routines bot={bot} bundle={bundle} />}
        </div>
      </div>
    </Modal>
  );
}
