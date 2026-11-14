/** The "Look" editor: a live character preview, its states, and every look option. */
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ACCESSORIES, AVATAR_COLORS, AVATAR_SHAPES, CHARACTER_TYPES, EYE_STYLES, IDLE_MOTIONS } from "../types";
import { colorOf } from "../lib/colors";
import type { AvatarColor, AvatarShape, Character as CharacterLook } from "../types";
import type { CharacterState } from "../lib/botState";
import { reducedMotion } from "../lib/pointer";
import { EUPHORIA_MS, playShout } from "../lib/cheer";
import { useStore } from "../store";
import { Character, validHex } from "./Character";
import { Toggle } from "./ui";

/** States offered on the preview, in the order shown. */
const TRY_STATES: CharacterState[] = ["idle", "thinking", "working", "waiting", "speaking", "happy", "euphoric", "sleeping"];

/** A pretend voice for the preview: syllables with pauses between words. */
function simulatedLevel(): number {
  const now = performance.now();
  const word = (now % 900) / 900;
  const gap = word > 0.78 ? 0.15 : 1;
  return Math.max(0, Math.min(1, gap * (0.35 + 0.65 * Math.abs(Math.sin(now / 75) * Math.sin(now / 190 + 0.7)))));
}

/* ---------- Shape and colour picker (bot settings and the create-bot modal) ---------- */

export function LookPicker({
  name,
  shape,
  color,
  character,
  onShape,
  onColor,
  onCharacter,
}: {
  name: string;
  shape: AvatarShape;
  color: AvatarColor;
  character?: CharacterLook;
  onShape: (s: AvatarShape) => void;
  onColor: (c: AvatarColor) => void;
  /** When given, a custom colour swatch is offered (stored in `character.customColor`). */
  onCharacter?: (c: CharacterLook) => void;
}) {
  const t = useT();
  const custom = validHex(character?.customColor);
  const showShapes = (character?.type ?? "mascot") === "mascot";
  const mascot = character ? { ...character, type: "mascot" as const } : undefined;
  return (
    <div className="look">
      {showShapes && (
        <div className="look-grid" role="radiogroup" aria-label={t("look.shape")}>
          {AVATAR_SHAPES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={shape === s} aria-label={t(`shape.${s}`)} title={t(`shape.${s}`)} className={`look-shape ${shape === s ? "is-selected" : ""}`} onClick={() => onShape(s)}>
              <Character bot={{ shape: s, color, name, character: mascot }} size={36} label={null} />
            </button>
          ))}
        </div>
      )}
      <div className="look-colors" role="radiogroup" aria-label={t("look.colour")}>
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={!custom && color === c}
            aria-label={t(`color.${c}`)}
            title={t(`color.${c}`)}
            className={`swatch ${!custom && color === c ? "is-selected" : ""}`}
            style={{ background: colorOf(c).bg }}
            onClick={() => {
              onColor(c);
              if (character && onCharacter && custom) onCharacter({ ...character, customColor: null });
            }}
          />
        ))}
        {character && onCharacter && (
          <span className="swatch-custom-wrap">
            <label className={`swatch swatch-custom ${custom ? "is-selected is-set" : ""}`} title={t("look.custom")} style={custom ? { background: custom } : undefined}>
              <input
                type="color"
                aria-label={t("look.custom")}
                value={custom ?? "#7a5cff"}
                onChange={(e) => onCharacter({ ...character, customColor: validHex(e.target.value) })}
              />
            </label>
            {custom && <code className="swatch-hex">{custom}</code>}
          </span>
        )}
      </div>
    </div>
  );
}

/** Mascot, dots or muse: three cards, each with a small live preview. */
export function TypeCards({ shape, color, character, onChange, compact = false }: { shape: AvatarShape; color: AvatarColor; character: CharacterLook; onChange: (c: CharacterLook) => void; compact?: boolean }) {
  const t = useT();
  return (
    <div className={`type-cards ${compact ? "is-compact" : ""}`} role="radiogroup" aria-label={t("look.type")}>
      {CHARACTER_TYPES.map((ty) => (
        <button key={ty} type="button" role="radio" aria-checked={character.type === ty} title={compact ? t(`type.${ty}.text`) : undefined} className={`type-card ${character.type === ty ? "is-selected" : ""}`} onClick={() => onChange({ ...character, type: ty })}>
          <Character bot={{ shape, color, character: { ...character, type: ty } }} size={52} label={null} />
          <span className="type-card-text">
            <span className="choice-title">{t(`type.${ty}.title`)}</span>
            {!compact && <span className="choice-text">{t(`type.${ty}.text`)}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The big live preview with the "Try:" state buttons under it. */
export function CharacterStage({ shape, color, name, character, size = 148, withTry = true }: { shape: AvatarShape; color: AvatarColor; name: string; character: CharacterLook; size?: number; withTry?: boolean }) {
  const t = useT();
  const [state, setState] = useState<CharacterState>("idle");
  const [run, setRun] = useState(0);
  const locale = useStore((s) => s.locale);
  // "Happy" and "Euphoric" are short moments, as in the app.
  useEffect(() => {
    if (state !== "happy" && state !== "euphoric") return;
    const timer = window.setTimeout(() => setState("idle"), state === "happy" ? 1700 : EUPHORIA_MS);
    return () => window.clearTimeout(timer);
  }, [state, run]);
  const pick = (s: CharacterState) => {
    setState(s);
    setRun((n) => n + 1);
    if (s === "euphoric" && character.euphoria !== false && character.shout !== false) playShout(locale);
  };
  return (
    <div className="chr-stage">
      <div className="chr-stage-view">
        <Character bot={{ shape, color, name, character }} size={size} state={state} levelSource={state === "speaking" ? simulatedLevel : undefined} interactive />
      </div>
      {withTry && (
        <div className="chr-try" role="group" aria-label={t("look.tryAria")}>
          <span className="chr-try-label">{t("look.try")}</span>
          {TRY_STATES.map((s) => (
            <button key={s} type="button" className={`opt-chip is-text ${state === s ? "is-selected" : ""}`} aria-pressed={state === s} onClick={() => pick(s)}>
              {t(`look.state.${s}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Eye style chips, each with a tiny preview. */
export function EyeChips({ shape, color, character, onChange }: { shape: AvatarShape; color: AvatarColor; character: CharacterLook; onChange: (c: CharacterLook) => void }) {
  const t = useT();
  return (
    <div className="opt-chips" role="radiogroup" aria-label={t("look.eyes")}>
      {EYE_STYLES.map((e) => (
        <button key={e} type="button" role="radio" aria-checked={character.eyes === e} className={`opt-chip ${character.eyes === e ? "is-selected" : ""}`} onClick={() => onChange({ ...character, eyes: e })}>
          <Character bot={{ shape, color, character: { ...character, type: "mascot", eyes: e } }} size={28} label={null} />
          <span>{t(`eyes.${e}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** Accessory chips, each with a tiny preview. */
export function AccessoryChips({ shape, color, character, onChange }: { shape: AvatarShape; color: AvatarColor; character: CharacterLook; onChange: (c: CharacterLook) => void }) {
  const t = useT();
  return (
    <div className="opt-chips" role="radiogroup" aria-label={t("look.accessory")}>
      {ACCESSORIES.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={character.accessory === a} className={`opt-chip ${character.accessory === a ? "is-selected" : ""}`} onClick={() => onChange({ ...character, accessory: a })}>
          <Character bot={{ shape, color, character: { ...character, type: "mascot", accessory: a } }} size={28} label={null} />
          <span>{t(`accessory.${a}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** The full editor used in bot settings → General. */
export function CharacterEditor({
  name,
  shape,
  color,
  character,
  onShape,
  onColor,
  onCharacter,
}: {
  name: string;
  shape: AvatarShape;
  color: AvatarColor;
  character: CharacterLook;
  onShape: (s: AvatarShape) => void;
  onColor: (c: AvatarColor) => void;
  onCharacter: (c: CharacterLook) => void;
}) {
  const t = useT();
  const set = <K extends keyof CharacterLook>(k: K, v: CharacterLook[K]) => onCharacter({ ...character, [k]: v });
  const [calmSystem] = useState(reducedMotion);
  const mascot = character.type === "mascot";
  return (
    <div className="chr-editor">
      <div className="field chr-editor-type">
        <span className="field-label">{t("look.type")}</span>
        <TypeCards shape={shape} color={color} character={character} onChange={onCharacter} />
      </div>
      <CharacterStage shape={shape} color={color} name={name} character={character} />
      <div className="chr-editor-controls">
        {calmSystem && <p className="field-hint">{t("look.reducedMotion")}</p>}
        <div className="field">
          <span className="field-label">{mascot ? `${t("look.shape")} · ${t("look.colour")}` : t("look.colour")}</span>
          <LookPicker name={name} shape={shape} color={color} character={character} onShape={onShape} onColor={onColor} onCharacter={onCharacter} />
        </div>
        {mascot && (
        <>
        <div className="field">
          <span className="field-label">{t("look.eyes")}</span>
          <EyeChips shape={shape} color={color} character={character} onChange={onCharacter} />
        </div>
        <div className="field">
          <span className="field-label">{t("look.face")}</span>
          <div className="chr-toggles">
            <label className="chr-toggle-row"><span>{t("look.mouth")}</span><Toggle checked={character.mouth} onChange={(v) => set("mouth", v)} label={t("look.mouth")} /></label>
            <label className="chr-toggle-row"><span>{t("look.cheeks")}</span><Toggle checked={character.cheeks} onChange={(v) => set("cheeks", v)} label={t("look.cheeks")} /></label>
          </div>
        </div>
        <div className="field">
          <span className="field-label">{t("look.accessory")}</span>
          <AccessoryChips shape={shape} color={color} character={character} onChange={onCharacter} />
        </div>
        </>
        )}
        <div className="field">
          <span className="field-label">{t("look.idle")}</span>
          <div className="segmented chr-idle" role="radiogroup" aria-label={t("look.idle")}>
            {IDLE_MOTIONS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={character.idle === m} className={character.idle === m ? "is-active" : ""} onClick={() => set("idle", m)}>
                {t(`idle.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">{t("look.intensity")}</span>
          <div className="chr-slider">
            <span className="muted small">{t("look.calm")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={character.intensity}
              aria-label={t("look.intensity")}
              onChange={(e) => set("intensity", Number(e.target.value))}
            />
            <span className="muted small">{t("look.lively")}</span>
          </div>
        </div>
        <div className="chr-toggles">
          <label className="chr-toggle-row"><span>{t("look.follow")}</span><Toggle checked={character.followCursor} onChange={(v) => set("followCursor", v)} label={t("look.follow")} /></label>
          <label className="chr-toggle-row"><span>{t("look.blink")}</span><Toggle checked={character.blink} onChange={(v) => set("blink", v)} label={t("look.blink")} /></label>
        </div>
        <div className="field">
          <span className="field-label">{t("look.joy")}</span>
          <div className="chr-toggles is-stacked">
            <label className="chr-toggle-row"><span>{t("look.euphoria")}</span><Toggle checked={character.euphoria !== false} onChange={(v) => set("euphoria", v)} label={t("look.euphoria")} /></label>
            <label className={`chr-toggle-row ${character.euphoria === false ? "is-disabled" : ""}`}><span>{t("look.shout")}</span><Toggle checked={character.euphoria !== false && character.shout !== false} disabled={character.euphoria === false} onChange={(v) => set("shout", v)} label={t("look.shout")} /></label>
          </div>
          <p className="field-hint">{t("look.euphoriaHint")}</p>
        </div>
      </div>
    </div>
  );
}
