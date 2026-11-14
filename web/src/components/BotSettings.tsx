import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { tn, useT } from "../i18n";
import { useStore, type BotSettingsTab } from "../store";
import { TOOL_GROUPS } from "../types";
import type { Autonomy, AvatarColor, AvatarShape, Bot, BotBundle, BotMode, Effort, Memory, ModelOption, RoomRule, Routine, RoutineRun, Skill, TelegramStatus, ToolGroup } from "../types";
import { dateTime, nextRunLabel, relTime, shortDate } from "../lib/format";
import { Avatar, BotAvatar } from "./Avatar";
import { routineWhen, TriggerChip } from "./DetailsPanel";
import { Icon } from "./Icon";
import { LookPicker, MODE_IDS } from "./Modals";
import { ConfirmButton, CopyButton, copyText, Empty, ErrorNote, IconButton, Loading, Modal, Toggle, useTick } from "./ui";

const EFFORT_IDS: Effort[] = ["low", "medium", "high", "xhigh"];
const AUTONOMY_IDS: Autonomy[] = ["careful", "balanced", "trusted"];
const ROOM_RULE_IDS: RoomRule[] = ["lead", "everyone", "mentions"];

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
  roomRule: RoomRule; disabledTools: ToolGroup[];
}
const FORM_KEYS: (keyof Form)[] = ["name", "label", "description", "instructions", "shape", "color", "mode", "effort", "model", "autonomy", "roomRule", "disabledTools"];
const formOf = (b: Bot): Form => ({
  name: b.name, label: b.label, description: b.description, instructions: b.instructions,
  shape: b.shape, color: b.color, mode: b.mode, effort: b.effort, model: b.model, autonomy: b.autonomy,
  roomRule: b.roomRule ?? "lead",
  // Kept in the order of TOOL_GROUPS so two lists with the same tools compare equal.
  disabledTools: TOOL_GROUPS.filter((g) => (b.disabledTools ?? []).includes(g)),
});
const sameValue = (a: Form[keyof Form], b: Form[keyof Form]): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
const sameForm = (a: Form, b: Form): boolean => FORM_KEYS.every((k) => sameValue(a[k], b[k]));

function General({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { upsertBot, resetConversation, loadBots, showToast } = useStore.getState();
  const t = useT();
  const efforts = EFFORT_IDS.map((id) => ({ id, title: t(`effort.${id}.title`), text: t(`effort.${id}.text`) }));
  const autonomies = AUTONOMY_IDS.map((id) => ({ id, title: t(`autonomy.${id}.title`), text: t(`autonomy.${id}.text`) }));
  const modes = MODE_IDS.map((id) => ({ id, title: t(`mode.${id}.title`), text: t(`mode.${id}.text`) }));
  const roomRules = ROOM_RULE_IDS.map((id) => ({ id, title: t(`roomRule.${id}.title`), text: t(`roomRule.${id}.text`) }));
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
    const timer = window.setTimeout(() => setNote(null), 2400);
    return () => window.clearTimeout(timer);
  }, [note]);

  const saved = formOf(bot);
  // When the bot changes elsewhere (an undo, another tab) and nothing is being edited, show the new values.
  const lastSaved = useRef(saved);
  useEffect(() => {
    const before = lastSaved.current;
    lastSaved.current = saved;
    if (!sameForm(before, saved)) setForm((f) => (sameForm(f, before) ? saved : f));
  });
  const changed = FORM_KEYS.filter((k) => !sameValue(form[k], saved[k]));
  const dirty = changed.length > 0;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dirty || !form.name.trim() || saving) return;
    const patch: Partial<Form> = {};
    for (const k of changed) Object.assign(patch, { [k]: typeof form[k] === "string" && k !== "instructions" ? (form[k] as string).trim() : form[k] });
    // What the changed fields held before, so the save can be undone.
    const previous: Partial<Form> = {};
    for (const k of changed) Object.assign(previous, { [k]: saved[k] });
    const botId = bot.id;
    setSaving(true);
    try {
      const r = await api<{ bot: Bot }>("PATCH", `/bots/${botId}`, patch);
      upsertBot(r.bot);
      setForm(formOf(r.bot));
      setNote(null);
      showToast(t("common.saved"), {
        label: t("common.undo"),
        run: async () => {
          const back = await api<{ bot: Bot }>("PATCH", `/bots/${botId}`, previous);
          upsertBot(back.bot);
          showToast(t("toast.undone"));
        },
      });
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
          {t(lookOpen ? "bot.hideLook" : "bot.changeLook")}
        </button>
      </div>
      {lookOpen && <LookPicker name={form.name} shape={form.shape} color={form.color} onShape={(s) => set("shape", s)} onColor={(c) => set("color", c)} />}

      <div className="field">
        <label className="field-label" htmlFor={`${uid}n`}>{t("common.name")}</label>
        <input id={`${uid}n`} className="input" value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}l`}>{t("bot.label")}</label>
        <input id={`${uid}l`} className="input" value={form.label} maxLength={60} onChange={(e) => set("label", e.target.value)} placeholder={t("bot.labelPlaceholder")} />
        <p className="field-hint">{t("bot.labelHint")}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}d`}>{t("bot.about")}</label>
        <textarea id={`${uid}d`} className="input" rows={2} value={form.description} maxLength={500} onChange={(e) => set("description", e.target.value)} />
      </div>

      {!isRoom && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}i`}>{t("bot.instructions")}</label>
            <textarea
              id={`${uid}i`}
              className="input"
              rows={6}
              value={form.instructions}
              maxLength={8000}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder={t("bot.instructionsPlaceholder")}
            />
            <p className="field-hint">{t("bot.instructionsHint")}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}m`}>{t("bot.model")}</label>
            <select id={`${uid}m`} className="input" value={form.model} onChange={(e) => set("model", e.target.value)}>
              <option value="">{models?.defaultRef ? t("bot.serverDefaultRef", { ref: models.defaultRef }) : t("bot.serverDefault")}</option>
              {modelOptions.map((m) => (
                <option key={m.ref} value={m.ref}>{m.provider ? `${m.provider} · ${m.model}` : m.model}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">{t("bot.thinking")}</span>
            <ChoiceList label={t("bot.thinking")} value={form.effort} options={efforts} onChange={(v) => set("effort", v)} />
          </div>
          <div className="field">
            <span className="field-label">{t("bot.autonomy")}</span>
            <ChoiceList label={t("bot.autonomy")} value={form.autonomy} options={autonomies} onChange={(v) => set("autonomy", v)} />
          </div>
          <div className="field">
            <span className="field-label">{t("bot.usedAs")}</span>
            <ChoiceList label={t("bot.usedAs")} value={form.mode} options={modes} onChange={(v) => set("mode", v)} />
          </div>
          <div className="field">
            <span className="field-label" id={`${uid}t`}>{t("tools.heading")}</span>
            <ul className="check-list is-tall" role="group" aria-labelledby={`${uid}t`}>
              {TOOL_GROUPS.map((g) => {
                const on = !form.disabledTools.includes(g);
                return (
                  <li key={g}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={`check-row ${on ? "is-selected" : ""}`}
                      onClick={() => set("disabledTools", TOOL_GROUPS.filter((x) => (x === g ? on : form.disabledTools.includes(x))))}
                    >
                      <span className="check-box">{on && <Icon name="check" size={13} />}</span>
                      <span className="check-text">
                        <span className="choice-title">{t(`tools.${g}.label`)}</span>
                        <span className="choice-text">{t(`tools.${g}.text`)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="field-hint">{t("tools.hint", { name: bot.name })}</p>
          </div>
        </>
      )}

      {isRoom && (
        <div className="field">
          <span className="field-label">{t("roomRule.heading")}</span>
          <ChoiceList label={t("roomRule.heading")} value={form.roomRule} options={roomRules} onChange={(v) => set("roomRule", v)} />
        </div>
      )}

      <div className={`save-bar ${dirty || note ? "is-visible" : ""}`}>
        <span className={`save-note ${note?.tone === "error" ? "is-error" : ""}`} role="status">{note ? note.text : dirty ? t("bot.unsaved") : ""}</span>
        <button type="button" className="btn btn-ghost btn-small" disabled={!dirty || saving} onClick={() => setForm(formOf(bot))}>{t("bot.discard")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!dirty || !form.name.trim() || saving}>{t(saving ? "common.saving" : "common.save")}</button>
      </div>

      <h3 className="pane-heading">{t("bot.conversation")}</h3>
      <div className="action-row">
        <div>
          <p className="action-title">{t("bot.startNew")}</p>
          <p className="muted small">{t("bot.startNewHint")}</p>
        </div>
        <ConfirmButton
          label={t("chat.newConversation")}
          confirmLabel={t("bot.confirmClear")}
          busyLabel={t("bot.clearing")}
          className="btn btn-small"
          onConfirm={async () => {
            setActionError(null);
            try {
              await resetConversation(bot.id);
              setNote({ tone: "ok", text: t("bot.newStarted") });
            } catch (e) {
              setActionError(errText(e));
            }
          }}
        />
      </div>
      {!bot.primary && !isRoom && (
        <div className="action-row">
          <div>
            <p className="action-title">{t("bot.makePrimary")}</p>
            <p className="muted small">{t("bot.makePrimaryHint")}</p>
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
            {t("bot.makePrimary")}
          </button>
        </div>
      )}

      <h3 className="pane-heading is-danger">{t("bot.danger")}</h3>
      <div className="action-row">
        <div>
          <p className="action-title">{t(isRoom ? "bot.deleteRoom" : "bot.deleteBot")}</p>
          <p className="muted small">
            {t(bot.primary ? "bot.deletePrimaryHint" : "bot.deleteHint")}
          </p>
        </div>
        <ConfirmButton
          label={t("common.delete")}
          confirmLabel={t("common.confirmDelete")}
          busyLabel={t("common.deleting")}
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
  const t = useT();
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
        <label className="field-label" htmlFor={`${uid}n`}>{t("common.name")}</label>
        <input ref={first} id={`${uid}n`} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("skill.namePlaceholder")} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}d`}>{t("skill.when")} <span className="muted">{t("common.optional")}</span></label>
        <input id={`${uid}d`} className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder={t("skill.whenPlaceholder")} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}b`}>{t("skill.steps")}</label>
        <textarea id={`${uid}b`} className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("skill.stepsPlaceholder")} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onDone}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!name.trim() || !body.trim() || busy}>{t(busy ? "common.saving" : "skill.save")}</button>
      </div>
    </form>
  );
}

function Skills({ bot, bundle }: { bot: Bot; bundle: BotBundle | undefined }) {
  const loadBundle = useStore((s) => s.loadBundle);
  const showToast = useStore((s) => s.showToast);
  const t = useT();
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skills = bundle?.skills;
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">{t("skill.intro", { name: bot.name })}</p>
        {editing === null && (
          <button type="button" className="btn btn-small" onClick={() => setEditing("new")}>
            <Icon name="plus" size={14} /> {t("skill.new")}
          </button>
        )}
      </div>
      {editing === "new" && <SkillEditor botId={bot.id} skill={null} onDone={() => setEditing(null)} />}
      {!skills && <Loading />}
      {skills && skills.length === 0 && editing === null && <Empty icon="book" title={t("skill.emptyTitle")}>{t("skill.emptyText", { name: bot.name })}</Empty>}
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
                <IconButton icon="edit" size={16} label={t("skill.edit", { name: s.name })} onClick={() => setEditing(s)} />
                <ConfirmButton
                  className="btn btn-small btn-ghost-danger"
                  label={t("common.delete")}
                  confirmLabel={t("common.confirm")}
                  busyLabel="…"
                  onConfirm={async () => {
                    setError(null);
                    try {
                      await api("DELETE", `/skills/${s.id}`);
                      await loadBundle(bot.id);
                      showToast(t("skill.deleted", { name: s.name }), {
                        label: t("common.undo"),
                        run: async () => {
                          await api("POST", `/bots/${bot.id}/skills`, { name: s.name, description: s.description, body: s.body });
                          await loadBundle(bot.id);
                          showToast(t("skill.restored"));
                        },
                      });
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
  const { mutateBundle, loadBundle, showToast } = useStore.getState();
  const t = useT();
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
      showToast(t("memory.forgotten"), {
        label: t("common.undo"),
        run: async () => {
          const r = await api<{ memory: Memory }>("POST", `/bots/${bot.id}/memories`, { text: m.text });
          if (r?.memory) mutateBundle(bot.id, (b) => (b.memories.some((x) => x.id === r.memory.id) ? b : { ...b, memories: [...b.memories, r.memory].sort((a, c) => c.createdAt - a.createdAt) }));
          else await loadBundle(bot.id);
          showToast(t("memory.restored"));
        },
      });
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
      setNote(r.added.length ? tn("memory.picked", r.added.length) : t("memory.nothingNew"));
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
      setNote(t(r.changed ? "memory.summarised" : "memory.nothingToSummarise"));
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
        <p className="muted">{t("memory.intro", { name: bot.name })}</p>
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void consolidate()} title={t("memory.reviewTitle")}>
          {t(busy === "consolidate" ? "memory.reviewing" : "memory.review")}
        </button>
      </div>
      {memories && memories.length > 6 && (
        <div className="search-field is-inline">
          <Icon name="search" size={16} />
          <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("memory.search")} aria-label={t("memory.searchLabel")} />
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {note && <p className="muted small" role="status">{note}</p>}
      {!memories && <Loading />}
      {memories && memories.length === 0 && <Empty icon="brain" title={t("memory.emptyTitle")}>{t("memory.emptyText")}</Empty>}
      {memories && memories.length > 0 && shown && shown.length === 0 && <p className="muted small">{t("memory.none", { q: q.trim() })}</p>}
      {shown && shown.length > 0 && (
        <ul className="list">
          {shown.map((m) => (
            <li key={m.id} className="list-row is-card">
              <div className="list-row-text">
                <span className="memory-text">{m.text}</span>
                <span className="list-row-sub">
                  <span className="chip">{t(m.source === "learned" ? "memory.source.learned" : "memory.source.chat")}</span> {shortDate(m.createdAt)}
                </span>
              </div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void forget(m)} aria-label={t("memory.forgetLabel", { text: m.text.slice(0, 60) })}>{t("memory.forget")}</button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="pane-heading">{t("memory.heading")}</h3>
      {status ? (
        <div className="meter-box">
          <div className="meter-head">
            <span>{t("memory.full", { percent })}</span>
            <button type="button" className="link" disabled={busy !== null} onClick={() => void compact()}>{t(busy === "compact" ? "memory.summarising" : "memory.summarise")}</button>
          </div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("memory.meterLabel")}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="muted small">
            {t("memory.foot", { name: bot.name })}{" "}
            {status.lastCompactedAt ? t("memory.lastSummarised", { date: shortDate(status.lastCompactedAt) }) : t("memory.notSummarised")}
            {status.lastConsolidatedAt ? ` ${t("memory.lastReviewed", { date: shortDate(status.lastConsolidatedAt) })}` : ""}
          </p>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

/* ---------- Routines ---------- */

const RUN_STATE: Record<RoutineRun["status"], string> = { running: "state-working", done: "state-done", quiet: "", error: "state-error" };

/** The last runs of one routine; reloads whenever the server says this bot's routines changed. */
function RoutineHistory({ r }: { r: Routine }) {
  const tick = useStore((s) => s.routineTicks[r.botId] ?? 0);
  const t = useT();
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ runs: RoutineRun[] }>("GET", `/routines/${r.id}/runs`).then(
      (res) => {
        if (dead) return;
        setRuns(Array.isArray(res?.runs) ? res.runs : []);
        setError(null);
      },
      (e: unknown) => !dead && setError(errText(e)),
    );
    return () => {
      dead = true;
    };
  }, [r.id, tick]);
  return (
    <div className="runs">
      <ErrorNote>{error}</ErrorNote>
      {!runs && !error && <Loading />}
      {runs && runs.length === 0 && <p className="muted small">{t("routine.noRuns")}</p>}
      {runs && runs.length > 0 && (
        <ul className="runs-list">
          {runs.map((run) => (
            <li key={run.id} className="run">
              <time className="run-time" dateTime={new Date(run.at).toISOString()}>{dateTime(run.at, r.timezone || undefined)}</time>
              <span className={`chip ${RUN_STATE[run.status] ?? ""}`}>{t(`routine.run.${run.status}`)}</span>
              {run.note && <span className="run-note">{run.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoutineItem({ r, onNote, onError }: { r: Routine; onNote: (t: string) => void; onError: (t: string | null) => void }) {
  const { toggleRoutine, loadBundle } = useStore.getState();
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState(false);
  const now = useTick(30_000, r.trigger === "watch");
  const next = !r.enabled ? t("routine.paused") : r.trigger === "webhook" || r.trigger === "watch" ? null : r.nextRunAt ? t("routine.next", { when: nextRunLabel(r.nextRunAt, r.timezone || undefined) }) : null;
  return (
    <li className="routine">
      <div className="routine-head">
        <div className="list-row-text">
          <span className="list-row-title">
            {r.name} <TriggerChip trigger={r.trigger} />
          </span>
          <span className="list-row-sub">
            {r.trigger === "once" && r.runAt ? t("routine.runsOnce", { date: dateTime(r.runAt, r.timezone || undefined) }) : routineWhen({ ...r, enabled: true })}
            {next ? ` · ${next}` : ""}
            {r.lastRunAt ? ` · ${t("routine.lastRan", { date: shortDate(r.lastRunAt) })}` : ""}
          </span>
        </div>
        <Toggle
          checked={r.enabled}
          label={t(r.enabled ? "routine.pause" : "routine.resume", { name: r.name })}
          onChange={(v) => {
            onError(null);
            toggleRoutine(r, v).then(
              () => onNote(t(v ? "routine.resumed" : "routine.paused")),
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
              } else onError(t("routine.copyFailed"));
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={13} /> {t(copied ? "routine.copied" : "routine.copy")}
          </button>
        </div>
      )}
      {r.trigger === "watch" && r.watch && (
        <div className="watch">
          <Icon name={r.watch.kind === "url" ? "globe" : "file"} size={15} />
          <div className="list-row-text">
            <span className="watch-kind">{t(r.watch.kind === "url" ? "routine.watchesPage" : "routine.watchesFile")}</span>
            {r.watch.kind === "url" && /^https?:\/\//i.test(r.watch.target) ? (
              <a className="watch-target" href={r.watch.target} target="_blank" rel="noopener noreferrer">{r.watch.target}</a>
            ) : (
              <code className="watch-target">{r.watch.target}</code>
            )}
            <span className="list-row-sub">
              {tn("routine.checkedEvery", r.watch.everyMin)} · {r.watch.lastCheckedAt ? t("routine.lastChecked", { when: relTime(r.watch.lastCheckedAt, now) }) : t("routine.neverChecked")}
            </span>
          </div>
        </div>
      )}
      <div className="row-end">
        <button type="button" className="link routine-history-toggle" onClick={() => setHistory((v) => !v)} aria-expanded={history}>
          <Icon name="chevronRight" size={13} className={history ? "is-rotated" : ""} /> {t("routine.history")}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-small"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            onError(null);
            try {
              await api("POST", `/routines/${r.id}/run`);
              onNote(t("routine.runningNow"));
            } catch (e) {
              onError(errText(e));
            } finally {
              setRunning(false);
            }
          }}
        >
          <Icon name="bolt" size={13} /> {t(running ? "common.starting" : "routine.runNow")}
        </button>
        <ConfirmButton
          className="btn btn-small btn-ghost-danger"
          label={t("common.delete")}
          confirmLabel={t("common.confirmDelete")}
          busyLabel={t("common.deleting")}
          onConfirm={async () => {
            onError(null);
            try {
              await api("DELETE", `/routines/${r.id}`);
              await loadBundle(r.botId);
              onNote(t("routine.deleted"));
            } catch (e) {
              onError(errText(e));
            }
          }}
        />
      </div>
      {history && <RoutineHistory r={r} />}
    </li>
  );
}

function Routines({ bot, bundle }: { bot: Bot; bundle: BotBundle | undefined }) {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2400);
    return () => window.clearTimeout(timer);
  }, [note]);
  const routines = bundle?.routines;
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">{t("routine.intro", { name: bot.name })}</p>
        {note && <span className="chip state-ready" role="status">{note}</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!routines && <Loading />}
      {routines && routines.length === 0 && <Empty icon="clock" title={t("routine.emptyTitle")}>{t("routine.emptyText")}</Empty>}
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

/* ---------- Telegram ---------- */

function Telegram({ bot }: { bot: Bot }) {
  const t = useT();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = () =>
    api<TelegramStatus>("GET", `/bots/${bot.id}/telegram`).then(
      (s) => {
        if (!alive.current) return;
        setStatus(s);
        setLoadError(null);
      },
      (e: unknown) => alive.current && setLoadError(errText(e)),
    );

  const waiting = !!status && status.connected && !status.linked;
  // First load, and again whenever the server reports a change to this bot's Telegram link.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.telegram]);
  // While waiting for the link message: every `bot` event, and every 5 s.
  useEffect(() => {
    if (waiting) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot]);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, bot.id]);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<TelegramStatus>("PUT", `/bots/${bot.id}/telegram`, { token: value });
      if (!alive.current) return;
      setStatus(s);
      setToken("");
      setReveal(false);
    } catch (err) {
      if (alive.current) setError(errText(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    setError(null);
    try {
      await api("DELETE", `/bots/${bot.id}/telegram`);
      if (alive.current) setStatus({ connected: false, username: null, linked: false, linkCode: null });
    } catch (err) {
      if (alive.current) setError(errText(err));
    }
  };

  const link = status?.username ? `https://t.me/${status.username}` : null;
  const command = `/start ${status?.linkCode ?? ""}`.trim();

  return (
    <div className="settings-pane">
      <p className="muted">{t("telegram.intro", { name: bot.name })}</p>
      <ol className="steps-guide">
        <li>{t("telegram.step1")}</li>
        <li>{t("telegram.step2")}</li>
        <li>{t("telegram.step3")}</li>
      </ol>
      {loadError && !status && <ErrorNote>{loadError}</ErrorNote>}
      {!status && !loadError && <Loading />}

      {status && !status.connected && (
        <form className="editor" onSubmit={connect} autoComplete="off">
          <div className="field">
            <label className="field-label" htmlFor={`${uid}k`}>{t("telegram.token")}</label>
            <div className="input-affix">
              <input
                id={`${uid}k`}
                className="input"
                type={reveal ? "text" : "password"}
                value={token}
                maxLength={200}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("telegram.tokenPlaceholder")}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore=""
                data-lpignore="true"
                aria-invalid={error ? true : undefined}
              />
              <IconButton icon={reveal ? "eyeOff" : "eye"} size={16} label={t(reveal ? "telegram.hideToken" : "telegram.showToken")} active={reveal} onClick={() => setReveal((v) => !v)} />
            </div>
            <p className="field-hint">{t("telegram.tokenHint")}</p>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            <button type="submit" className="btn btn-primary btn-small" disabled={!token.trim() || busy}>{t(busy ? "common.connecting" : "telegram.connect")}</button>
          </div>
        </form>
      )}

      {status && status.connected && !status.linked && (
        <div className="editor">
          <div className="status-row">
            <span className="dot-inline dot-pulse" />
            <span role="status">{t("telegram.waiting")}</span>
          </div>
          {link && (
            <div className="field">
              <span className="field-label">{t("telegram.openLabel")}</span>
              <a className="telegram-link" href={link} target="_blank" rel="noopener noreferrer">
                <Icon name="send" size={15} /> {link} <Icon name="external" size={13} />
              </a>
            </div>
          )}
          <div className="field">
            <span className="field-label">{t("telegram.sendLabel")}</span>
            <div className="hook">
              <code className="truncate">{command}</code>
              <CopyButton text={command} label={t("telegram.copyCode")} onFail={() => setError(t("routine.copyFailed"))} />
            </div>
            <p className="field-hint">{t("telegram.sendHint")}</p>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("telegram.disconnect")} confirmLabel={t("telegram.disconnectConfirm")} busyLabel={t("telegram.disconnecting")} onConfirm={disconnect} />
          </div>
        </div>
      )}

      {status && status.linked && (
        <>
          <div className="status-row">
            <span className="dot-inline dot-ok" />
            <span>{t("telegram.linked")}</span>
          </div>
          {link && (
            <a className="telegram-link" href={link} target="_blank" rel="noopener noreferrer">
              <Icon name="send" size={15} /> {link} <Icon name="external" size={13} />
            </a>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="action-row">
            <div>
              <p className="action-title">{t("telegram.disconnect")}</p>
              <p className="muted small">{t("telegram.disconnectHint")}</p>
            </div>
            <ConfirmButton className="btn btn-small btn-danger" label={t("telegram.disconnect")} confirmLabel={t("telegram.disconnectConfirm")} busyLabel={t("telegram.disconnecting")} onConfirm={disconnect} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Dialog ---------- */

export function BotSettings({ botId, tab }: { botId: string; tab: BotSettingsTab }) {
  const bot = useStore((s) => s.bots[botId]);
  const bundle = useStore((s) => s.bundles[botId]);
  const { closeBotSettings, openBotSettings, loadBundle } = useStore.getState();
  const t = useT();

  useEffect(() => {
    void loadBundle(botId);
  }, [botId, loadBundle]);
  useEffect(() => {
    if (!bot) closeBotSettings();
  }, [bot, closeBotSettings]);
  if (!bot) return null;

  const isRoom = bot.kind === "room";
  const tabs: { id: BotSettingsTab; label: string; icon: "settings" | "book" | "brain" | "clock" | "send"; count?: number }[] = isRoom
    ? [{ id: "general", label: t("botSettings.tab.general"), icon: "settings" }]
    : [
        { id: "general", label: t("botSettings.tab.general"), icon: "settings" },
        { id: "skills", label: t("botSettings.tab.skills"), icon: "book", count: bundle?.skills.length },
        { id: "memories", label: t("botSettings.tab.memories"), icon: "brain", count: bundle?.memories.length },
        { id: "routines", label: t("botSettings.tab.routines"), icon: "clock", count: bundle?.routines.length },
        { id: "telegram", label: t("botSettings.tab.telegram"), icon: "send" },
      ];
  const active = tabs.some((x) => x.id === tab) ? tab : "general";

  return (
    <Modal
      title={t("botSettings.title", { name: bot.name })}
      onClose={closeBotSettings}
      size="xl"
      className="bot-settings"
      header={
        <div className="modal-head">
          <BotAvatar bot={bot} size={30} badge />
          <span className="modal-head-title truncate">{bot.name}</span>
          {bot.telegram && (
            <span className="chip state-working" title={t("telegram.marker", { username: bot.telegram })}>
              <Icon name="send" size={12} /> Telegram
            </span>
          )}
          <IconButton icon="close" label={t("common.close")} onClick={closeBotSettings} />
        </div>
      }
    >
      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-label={t("botSettings.aria")} aria-orientation="vertical">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={active === x.id} className={`settings-nav-item ${active === x.id ? "is-active" : ""}`} onClick={() => openBotSettings(bot.id, x.id)}>
              <Icon name={x.icon} size={16} />
              <span className="grow">{x.label}</span>
              {typeof x.count === "number" && <span className="nav-count">{x.count}</span>}
            </button>
          ))}
        </div>
        <div className="settings-content" role="tabpanel">
          {active === "general" && <General key={bot.id} bot={bot} onClose={closeBotSettings} />}
          {active === "skills" && <Skills bot={bot} bundle={bundle} />}
          {active === "memories" && <Memories bot={bot} bundle={bundle} />}
          {active === "routines" && <Routines bot={bot} bundle={bundle} />}
          {active === "telegram" && <Telegram key={bot.id} bot={bot} />}
        </div>
      </div>
    </Modal>
  );
}
