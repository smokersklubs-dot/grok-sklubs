import { BotReachTab } from "./KeysHealthLinks";
import { BotCapsField } from "./UsageCaps";
import { LocalToolsTab } from "./LocalTools";
import { BotApiTab } from "./BotApi";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { tn, useT } from "../i18n";
import { useStore, type BotSettingsTab } from "../store";
import { BotEmailTab, BotSharingTab } from "./WorkspacesMailVoice";
import { DEFAULT_CHARACTER, TOOL_GROUPS } from "../types";
import { BotSpendField, ConfidenceBadge, RoutineExtras } from "./SpendSkillsFiles";
import type { Autonomy, AvatarColor, AvatarShape, Bot, BotBundle, Character as CharacterLook, BotMode, Effort, Memory, MemoryStatus, ModelOption, NativeTrigger, RoomRule, Routine, RoutineRun, Skill, SkillExtras, SkillRef, TelegramStatus, ToolGroup } from "../types";
import { useNative } from "./NativeApps";
import { dateTime, nextRunLabel, relTime, shortDate } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Character } from "./Character";
import { CharacterEditor } from "./CharacterEditor";
import { BrainPicker } from "./Brain";
import { BotFallbacks } from "./Reliability";
import { routineWhen, TriggerChip } from "./DetailsPanel";
import { Icon, Spinner } from "./Icon";
import { MODE_IDS } from "./Modals";
import { ConfirmButton, CopyButton, copyText, Empty, ErrorNote, IconButton, Loading, Modal, Toggle, useTick } from "./ui";
import { BotRulesAndNudges } from "./RulesAndNudges";
import { runNote } from "./Pause";
import { BotVoicePicker } from "./VoicePicker";

const EFFORT_IDS: Effort[] = ["low", "medium", "high", "xhigh"];
const AUTONOMY_IDS: Autonomy[] = ["careful", "balanced", "trusted", "auto"];
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
  shape: AvatarShape; color: AvatarColor; character: CharacterLook; mode: BotMode; effort: Effort; model: string; autonomy: Autonomy;
  roomRule: RoomRule; disabledTools: ToolGroup[];
}
const FORM_KEYS: (keyof Form)[] = ["name", "label", "description", "instructions", "shape", "color", "character", "mode", "effort", "model", "autonomy", "roomRule", "disabledTools"];
const formOf = (b: Bot): Form => ({
  name: b.name, label: b.label, description: b.description, instructions: b.instructions,
  shape: b.shape, color: b.color, character: { ...DEFAULT_CHARACTER, ...(b.character ?? {}) }, mode: b.mode, effort: b.effort, model: b.model, autonomy: b.autonomy,
  roomRule: b.roomRule ?? "lead",
  // Kept in the order of TOOL_GROUPS so two lists with the same tools compare equal.
  disabledTools: TOOL_GROUPS.filter((g) => (b.disabledTools ?? []).includes(g)),
});
const sameValue = (a: Form[keyof Form], b: Form[keyof Form]): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as unknown as Record<string, unknown>;
    const y = b as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    return [...keys].every((k) => x[k] === y[k]);
  }
  return a === b;
};
const sameForm = (a: Form, b: Form): boolean => FORM_KEYS.every((k) => sameValue(a[k], b[k]));

function General({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { upsertBot, resetConversation, loadBots, showToast } = useStore.getState();
  const video = useStore((s) => s.video);
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
    // The bot's id: the subscription tools' real model list is read on its own computer first.
    api<{ models: ModelOption[]; defaultRef: string }>("GET", `/models?bot=${encodeURIComponent(bot.id)}`).then(
      (r) => !dead && setModels(r),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [bot.id]);

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

  return (
    <form className="settings-pane" onSubmit={save}>
      <div className="look-row">
        {!lookOpen && <Character bot={{ shape: form.shape, color: form.color, name: form.name || bot.name, character: form.character }} size={64} badge={bot.primary} interactive />}
        <div className="look-row-text">
          <span className="field-label">{t("look.heading")}</span>
          <button type="button" className="btn btn-small" onClick={() => setLookOpen((v) => !v)} aria-expanded={lookOpen}>
            {t(lookOpen ? "bot.hideLook" : "bot.changeLook")}
          </button>
        </div>
      </div>
      {lookOpen && (
        <CharacterEditor
          name={form.name || bot.name}
          shape={form.shape}
          color={form.color}
          character={form.character}
          onShape={(s) => set("shape", s)}
          onColor={(c) => set("color", c)}
          onCharacter={(c) => set("character", c)}
        />
      )}

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
          <BrainPicker bot={bot} value={form.model} onChange={(ref) => set("model", ref)} models={models} />
          <BotFallbacks botId={bot.id} value={bot.fallbackModels ?? null} ownModel={form.model || models?.defaultRef || ""} />
          <div className="field">
            <span className="field-label">{t("bot.thinking")}</span>
            <ChoiceList label={t("bot.thinking")} value={form.effort} options={efforts} onChange={(v) => set("effort", v)} />
          </div>
          <div className="field">
            <span className="field-label">{t("bot.autonomy")}</span>
            <ChoiceList label={t("bot.autonomy")} value={form.autonomy} options={autonomies} onChange={(v) => set("autonomy", v)} />
            <p className="field-hint">{t("autonomy.groundingHint")}</p>
          </div>
          <BotRulesAndNudges bot={bot} />
          <BotSpendField bot={bot} />
          <BotCapsField botId={bot.id} />
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
                        {g === "video" && !video.provider && !video.higgsfield && <span className="choice-text is-note">{t("tools.video.off")}</span>}
                        {g === "video" && video.higgsfield && <span className="choice-text is-note">{t("tools.video.higgsfield")}</span>}
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

      {!isRoom && !bot.access && <ComputerChoice bot={bot} />}
      {!isRoom && !bot.access && <BotVoicePicker bot={bot} />}

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

/** The optional structured parts of a skill, in the order the bot follows them. */
const SKILL_PARTS = ["needs", "approvals", "check", "output"] as const satisfies readonly (keyof SkillExtras)[];

/** The structured parts a skill has, read-only (in its row). */
function SkillParts({ skill }: { skill: Skill }) {
  const t = useT();
  const parts = SKILL_PARTS.filter((k) => skill[k]?.trim());
  if (!parts.length) return null;
  return (
    <dl className="skill-parts">
      {parts.map((k) => (
        <div key={k} className={`skill-part is-${k}`}>
          <dt>{t(`skill.part.${k}`)}</dt>
          <dd>{skill[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

function SkillEditor({ botId, skill, onDone }: { botId: string; skill: Skill | null; onDone: () => void }) {
  const loadBundle = useStore((s) => s.loadBundle);
  const t = useT();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [extras, setExtras] = useState<SkillExtras>({ needs: skill?.needs ?? "", check: skill?.check ?? "", output: skill?.output ?? "", approvals: skill?.approvals ?? "" });
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
    const payload = { name: name.trim(), description: description.trim(), body, ...extras };
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
      {/* Optional structured parts: open at once when the skill already has one. */}
      <details className="skill-more" open={SKILL_PARTS.some((k) => !!extras[k])}>
        <summary>{t("skill.moreDetails")}</summary>
        <div className="skill-more-fields">
        {SKILL_PARTS.map((k) => (
          <div className="field" key={k}>
            <label className="field-label" htmlFor={`${uid}${k}`}>{t(`skill.part.${k}`)} <span className="muted">{t("common.optional")}</span></label>
            <textarea id={`${uid}${k}`} className="input" rows={2} maxLength={2000} value={extras[k]} onChange={(e) => setExtras((x) => ({ ...x, [k]: e.target.value }))} placeholder={t(`skill.part.${k}Placeholder`)} />
          </div>
        ))}
        </div>
      </details>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onDone}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!name.trim() || !body.trim() || busy}>{t(busy ? "common.saving" : "skill.save")}</button>
      </div>
    </form>
  );
}

/** Import a skill from a public markdown file (the user's own action, so no approval card). */
function SkillImport({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const t = useT();
  const loadBundle = useStore((s) => s.loadBundle);
  const showToast = useStore((s) => s.showToast);
  const [url, setUrl] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ skill: Skill; replaced: boolean }>("POST", `/bots/${bot.id}/skills/import`, { url: url.trim(), shared });
      await loadBundle(bot.id);
      showToast(t(r.replaced ? "skill.importReplaced" : "skill.imported", { name: r.skill.name }));
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="editor skill-import" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={`imp-${bot.id}`}>{t("skill.importUrl")}</label>
        <input id={`imp-${bot.id}`} className="input" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/…/skill.md" autoFocus />
        <p className="field-hint">{t("skill.importHint")}</p>
      </div>
      <label className="check-row"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> <span>{t("skill.shareWithTeam")}</span></label>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-small" onClick={onDone}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !url.trim()}>{t(busy ? "common.working" : "skill.import")}</button>
      </div>
    </form>
  );
}

/** Skills other bots shared with the whole team (read-only here). */
function TeamSkills({ bot, tick }: { bot: Bot; tick: unknown }) {
  const t = useT();
  const [list, setList] = useState<SkillRef[] | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ skills: SkillRef[] }>("GET", `/bots/${bot.id}/skills/available`).then((r) => !dead && setList(r.skills.filter((k) => !k.own)), () => !dead && setList([]));
    return () => { dead = true; };
  }, [bot.id, tick]);
  if (!list?.length) return null;
  return (
    <>
      <h3 className="pane-heading">{t("skill.teamHeading")}</h3>
      <p className="muted small">{t("skill.teamHint", { name: bot.name })}</p>
      <ul className="list">
        {list.map((k) => (
          <li key={k.id} className="list-row is-card">
            <div className="list-row-text">
              <span className="list-row-title">{k.name} <span className="pill is-shared">{t("skill.sharedBy", { name: k.botName })}</span></span>
              {k.description && <span className="list-row-sub">{k.description}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Skills({ bot, bundle }: { bot: Bot; bundle: BotBundle | undefined }) {
  const loadBundle = useStore((s) => s.loadBundle);
  const showToast = useStore((s) => s.showToast);
  const t = useT();
  const [editing, setEditing] = useState<Skill | "new" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skills = bundle?.skills;
  const share = async (s: Skill, on: boolean) => {
    setError(null);
    try {
      await api("PATCH", `/skills/${s.id}`, { shared: on });
      await loadBundle(bot.id);
      showToast(t(on ? "skill.nowShared" : "skill.nowPrivate", { name: s.name }));
    } catch (e) {
      setError(errText(e));
    }
  };
  const activate = async (s: Skill) => {
    setError(null);
    try {
      await api("PATCH", `/skills/${s.id}`, { draft: false });
      await loadBundle(bot.id);
      showToast(t("skill.activated", { name: s.name }));
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">{t("skill.intro", { name: bot.name })}</p>
        {editing === null && (
          <div className="pane-intro-actions">
            <button type="button" className="btn btn-small" onClick={() => setEditing("import")}>
              <Icon name="download" size={14} /> {t("skill.importButton")}
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing("new")}>
              <Icon name="plus" size={14} /> {t("skill.new")}
            </button>
          </div>
        )}
      </div>
      {editing === "import" && <SkillImport bot={bot} onDone={() => setEditing(null)} />}
      {editing === "new" && <SkillEditor botId={bot.id} skill={null} onDone={() => setEditing(null)} />}
      {!skills && <Loading />}
      {skills && skills.length === 0 && editing === null && <Empty icon="book" title={t("skill.emptyTitle")}>{t("skill.emptyText", { name: bot.name })}</Empty>}
      <ErrorNote>{error}</ErrorNote>
      {skills && skills.length > 0 && (
        <ul className="list">
          {skills.map((s) =>
            editing !== "new" && editing !== "import" && editing?.id === s.id ? (
              <li key={s.id}>
                <SkillEditor botId={bot.id} skill={s} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={s.id} className="list-row is-card skill-row">
                <div className="list-row-text">
                  <span className="list-row-title">{s.name}{s.shared && <span className="pill is-shared">{t("skill.shared")}</span>}{s.draft && <span className="chip">{t("skill.draft")}</span>}</span>
                  <span className="list-row-sub">{s.description || s.body.split("\n").find((l) => l.trim()) || ""}</span>
                  {s.draft && <span className="list-row-sub warn-text">{t("skill.draftHint")}</span>}
                </div>
                {s.draft && (
                  <button type="button" className="btn btn-small btn-primary" onClick={() => void activate(s)}>
                    <Icon name="check" size={14} /> {t("skill.activate")}
                  </button>
                )}
                <span className="skill-share">
                  <span className="muted small">{t("skill.shareShort")}</span>
                  <Toggle checked={s.shared} label={t("skill.shareWithTeam")} onChange={(on) => void share(s, on)} />
                </span>
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
                          await api("POST", `/bots/${bot.id}/skills`, { name: s.name, description: s.description, body: s.body, needs: s.needs, check: s.check, output: s.output, approvals: s.approvals });
                          await loadBundle(bot.id);
                          showToast(t("skill.restored"));
                        },
                      });
                    } catch (e) {
                      setError(errText(e));
                    }
                  }}
                />
                <SkillParts skill={s} />
              </li>
            ),
          )}
        </ul>
      )}
      <TeamSkills bot={bot} tick={bundle} />
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
  const [filter, setFilter] = useState<"all" | MemoryStatus>("all");
  const memories = bundle?.memories;
  const status = bundle?.memoryStatus;
  const needle = q.trim().toLowerCase();
  const shown = memories?.filter((m) => (!needle || m.text.toLowerCase().includes(needle)) && (filter === "all" || m.status === filter));
  const setStatus = async (m: Memory, next: MemoryStatus) => {
    setError(null);
    mutateBundle(bot.id, (b) => ({ ...b, memories: b.memories.map((x) => (x.id === m.id ? { ...x, status: next } : x)) }));
    try { await api("PATCH", `/memories/${m.id}`, { status: next }); } catch (e) { setError(errText(e)); await loadBundle(bot.id); }
  };
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
      {memories && memories.length > 0 && (
        <div className="memory-filter" role="group" aria-label={t("memory.filterLabel")}>
          {(["all", "active", "contested", "archived"] as const).map((f) => (
            <button key={f} type="button" className={`chip chip-link ${filter === f ? "is-active" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`memory.filter.${f}`)} <span className="muted">{f === "all" ? memories.length : memories.filter((m) => m.status === f).length}</span>
            </button>
          ))}
          <span className="spacer" />
          <a className="link small" href={`/api/bots/${bot.id}/memories/export?format=md`} download>{t("memory.export")}</a>
        </div>
      )}
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
                <span className={`memory-text ${m.status !== "active" ? `is-${m.status}` : ""}`}>{m.text}</span>
                {m.quote && <span className="memory-quote">« {m.quote} »</span>}
                <span className="list-row-sub">
                  <span className="chip">{t(m.source === "learned" ? "memory.source.learned" : m.source === "import" ? "memory.source.import" : "memory.source.chat")}</span>
                  <ConfidenceBadge confidence={m.confidence ?? "once"} />
                  {m.status !== "active" && <span className={`chip memory-status is-${m.status}`}>{t(`memory.filter.${m.status}`)}</span>}
                  {m.category && <span className="chip chip-quiet">{t(`memset.cat.${m.category}`)}</span>} {shortDate(m.createdAt)}
                </span>
              </div>
              <select className="input input-small memory-status-select" value={m.status} onChange={(e) => void setStatus(m, e.target.value as MemoryStatus)} aria-label={t("memory.statusLabel")}>
                {(["active", "contested", "archived"] as const).map((st) => <option key={st} value={st}>{t(`memory.filter.${st}`)}</option>)}
              </select>
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

const RUN_STATE: Record<RoutineRun["status"], string> = { running: "state-working", done: "state-done", quiet: "", error: "state-error", skipped: "" };

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
              {run.note && <span className="run-note">{runNote(run.note)}</span>}
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
  const now = useTick(30_000, r.trigger === "watch" || !!r.native);
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
      <RoutineExtras r={r} />
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
      {r.native && (
        <div className="watch native-trigger">
          <Icon name={r.trigger === "email" ? "mail" : r.trigger === "slack" ? "chat" : "calendar"} size={15} />
          <div className="list-row-text">
            <span className="watch-kind">
              {r.native.account}{" "}
              {r.native.accountStatus !== "ready" && <span className="chip state-needs_auth">{t(r.native.accountStatus === "missing" ? "routine.accountMissing" : "connector.status.needs_auth")}</span>}
            </span>
            {r.trigger === "email" && <code className="watch-target">{r.native.query || t("routine.anyEmail")}</code>}
            {r.trigger === "slack" && <code className="watch-target">{r.native.channel === "@dm" ? t("routine.slackDm") : r.native.channel}{r.native.mentionsOnly ? ` · ${t("routine.mentionsOnly")}` : ""}</code>}
            <span className="list-row-sub">
              {tn("routine.checkedEvery", r.native.everyMin)} · {r.native.lastCheckedAt ? t("routine.lastChecked", { when: relTime(r.native.lastCheckedAt, now) }) : t("routine.neverChecked")}
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

/** A routine fed by a built-in app account: a new email, a new Slack message, an event about to start. */
function NewAppTrigger({ bot, onDone }: { bot: Bot; onDone: (msg: string) => void }) {
  const t = useT();
  const native = useNative();
  const { loadBundle, openModal, closeBotSettings } = useStore.getState();
  const ids = { kind: useId(), acc: useId(), q: useId(), ch: useId(), lead: useId(), every: useId(), name: useId(), prompt: useId() };
  const ready = (native?.accounts ?? []).filter((a) => a.status === "ready");
  const triggersOf = (app: string) => native?.apps.find((x) => x.id === app)?.triggers ?? [];
  const kinds = (["email", "slack", "calendar"] as NativeTrigger[]).filter((k) => ready.some((a) => triggersOf(a.app).includes(k)));
  const [kind, setKind] = useState<NativeTrigger | "">("");
  const k = kind || kinds[0] || "";
  const fits = ready.filter((a) => k && triggersOf(a.app).includes(k));
  const [accountId, setAccountId] = useState("");
  const acc = fits.find((a) => a.id === accountId) ?? fits[0];
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [mentions, setMentions] = useState(false);
  const [lead, setLead] = useState(10);
  const [every, setEvery] = useState(5);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (native && !kinds.length) {
    return (
      <div className="native-trigger-form">
        <p className="muted small">{t("routine.appTriggerNone")}</p>
        <button type="button" className="btn btn-small" onClick={() => { closeBotSettings(); openModal({ kind: "connectors" }); }}>{t("apps.manage")}</button>
      </div>
    );
  }
  const valid = !!acc && !!name.trim() && !!prompt.trim() && (k !== "slack" || !!channel.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy || !acc) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${bot.id}/routines`, { kind: k, accountId: acc.id, query, channel, mentionsOnly: mentions, leadMin: lead, everyMin: every, name: name.trim(), prompt: prompt.trim() });
      await loadBundle(bot.id);
      onDone(t("routine.appTriggerCreated"));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="native-trigger-form" onSubmit={submit}>
      <div className="form-cols">
        <div className="field">
          <label className="field-label" htmlFor={ids.kind}>{t("routine.appTriggerKind")}</label>
          <select id={ids.kind} className="input" value={k} onChange={(e) => setKind(e.target.value as NativeTrigger)}>
            {kinds.map((x) => <option key={x} value={x}>{t(`routine.kind.${x}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.acc}>{t("routine.appTriggerAccount")}</label>
          <select id={ids.acc} className="input" value={acc?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {fits.map((a) => <option key={a.id} value={a.id}>{a.name}{a.identity ? ` (${a.identity})` : ""}</option>)}
          </select>
        </div>
      </div>
      {k === "email" && (
        <div className="field">
          <label className="field-label" htmlFor={ids.q}>{t("routine.appTriggerQuery")} <span className="muted">{t("common.optional")}</span></label>
          <input id={ids.q} className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={acc?.app === "outlook" ? "from:client subject:invoice" : "from:client subject:invoice is:unread"} autoComplete="off" />
          <p className="field-hint">{t(acc?.app === "outlook" ? "routine.appTriggerQueryOutlook" : "routine.appTriggerQueryGmail")}</p>
        </div>
      )}
      {k === "slack" && (
        <div className="form-cols">
          <div className="field">
            <label className="field-label" htmlFor={ids.ch}>{t("routine.appTriggerChannel")}</label>
            <input id={ids.ch} className="input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="#general · @dm" autoComplete="off" />
          </div>
          <label className="check-row"><input type="checkbox" checked={mentions} onChange={(e) => setMentions(e.target.checked)} /> {t("routine.mentionsOnly")}</label>
        </div>
      )}
      <div className="form-cols">
        {k === "calendar" && (
          <div className="field">
            <label className="field-label" htmlFor={ids.lead}>{t("routine.appTriggerLead")}</label>
            <input id={ids.lead} className="input" type="number" min={1} max={1440} value={lead} onChange={(e) => setLead(Number(e.target.value))} />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={ids.every}>{t("routine.appTriggerEvery")}</label>
          <input id={ids.every} className="input" type="number" min={2} max={1440} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={ids.name}>{t("common.name")}</label>
        <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t(`routine.appTriggerNamePh.${k || "email"}`)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={ids.prompt}>{t("routine.appTriggerPrompt")}</label>
        <textarea id={ids.prompt} className="input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t(`routine.appTriggerPromptPh.${k || "email"}`)} />
        <p className="field-hint">{t("routine.appTriggerOutside")}</p>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="submit" className="btn btn-primary btn-small" disabled={!valid || busy}>{busy ? <><Spinner size={13} /> {t("common.creating")}</> : t("routine.appTriggerCreate")}</button>
      </div>
    </form>
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
  const [adding, setAdding] = useState(false);
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">{t("routine.intro", { name: bot.name })}</p>
        {note && <span className="chip state-ready" role="status">{note}</span>}
      </div>
      <div className="disclosure">
        <button type="button" className="disclosure-toggle" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          <Icon name="chevronRight" size={14} className={adding ? "is-rotated" : ""} /> {t("routine.appTrigger")}
        </button>
        {adding && <NewAppTrigger bot={bot} onDone={(msg) => { setAdding(false); setNote(msg); }} />}
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

/**
 * Part B: the bot's computer — its own (the default) or one of the account's shared computers (files, browser and
 * sign-ins shared with the other bots set to "shared", one bot at a time). Saved at once, like the relay switch.
 */
function ComputerChoice({ bot }: { bot: Bot }) {
  const t = useT();
  const computer = useStore((s) => s.computer);
  const { loadComputer, upsertBot, openAppSettings } = useStore.getState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!computer) void loadComputer(); }, [computer, loadComputer]);
  if (computer?.kind !== "linux") return null;
  const mode = bot.computerMode ?? "own";
  const choose = async (next: "own" | "shared") => {
    if (next === mode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ bot: Bot }>("PATCH", `/bots/${enc(bot.id)}`, { computerMode: next });
      upsertBot(r.bot);
      await loadComputer();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const shared = computer.shared ?? [];
  return (
    <section className="computer-choice">
      <h3 className="pane-heading">{t("botComputer.heading")}</h3>
      <div className="action-row">
        <div>
          <p className="action-title">{t("botComputer.label")}</p>
          <p className="muted small">{t(mode === "shared" ? "botComputer.sharedHint" : "botComputer.ownHint", { name: bot.name })}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("botComputer.label")}>
          {(["own", "shared"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={busy} className={mode === m ? "is-active" : ""} onClick={() => void choose(m)}>
              {t(m === "own" ? "botComputer.own" : "botComputer.shared")}
            </button>
          ))}
        </div>
      </div>
      {mode === "shared" && (
        <p className="muted small">
          {t("botComputer.sharedList", { n: shared.length, busy: shared.filter((c) => c.busyWith).length })}{" "}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => openAppSettings("computer")}>{t("botComputer.manage")}</button>
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
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
  const tabs: { id: BotSettingsTab; label: string; icon: "settings" | "book" | "brain" | "clock" | "send" | "mail" | "users" | "globe" | "wrench" | "key"; count?: number }[] = isRoom
    ? [{ id: "general", label: t("botSettings.tab.general"), icon: "settings" }]
    : [
        { id: "general", label: t("botSettings.tab.general"), icon: "settings" },
        { id: "skills", label: t("botSettings.tab.skills"), icon: "book", count: bundle?.skills.length },
        { id: "memories", label: t("botSettings.tab.memories"), icon: "brain", count: bundle?.memories.length },
        { id: "routines", label: t("botSettings.tab.routines"), icon: "clock", count: bundle?.routines.length },
        // Local tool servers run on the bot's computer: its owner manages them (a shared bot's members do not see the tab).
        ...(bot.access ? [] : [{ id: "localTools" as const, label: t("botSettings.tab.localTools"), icon: "wrench" as const }]),
        { id: "reach", label: t("botSettings.tab.reach"), icon: "globe" },
        { id: "telegram", label: t("botSettings.tab.telegram"), icon: "send" },
        { id: "email", label: t("botSettings.tab.email"), icon: "mail" },
        { id: "sharing", label: t("botSettings.tab.sharing"), icon: "users" },
        // "Accès API" (BotApi.tsx): the owner's keys of this bot (a shared bot's members do not see the tab).
        ...(bot.access ? [] : [{ id: "api" as const, label: t("botSettings.tab.api"), icon: "key" as const }]),
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
          <BotAvatar bot={bot} size={32} badge interactive />
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
          {active === "localTools" && <LocalToolsTab key={bot.id} bot={bot} />}
          {active === "reach" && <BotReachTab key={bot.id} bot={bot} />}
          {active === "telegram" && <Telegram key={bot.id} bot={bot} />}
          {active === "email" && <BotEmailTab key={bot.id} bot={bot} />}
          {active === "sharing" && <BotSharingTab key={bot.id} bot={bot} />}
          {active === "api" && <BotApiTab key={bot.id} bot={bot} />}
        </div>
      </div>
    </Modal>
  );
}
