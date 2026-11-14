import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { accentStyle } from "../lib/colors";
import type { Bot } from "../types";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";

/** The browser lets an element go full screen (some phones and embedded views do not). */
const canFullscreen = () => typeof document !== "undefined" && !!document.fullscreenEnabled && typeof HTMLElement.prototype.requestFullscreen === "function";

/**
 * A bot's live screen in its frame (B-8): the control pill over the picture and, while the user drives, the "you're
 * driving" bar under it.
 *
 * Pill (bottom centre, dark and translucent): shows on hover or when the keyboard is in the frame, always on touch
 * screens, and stays while a question or a note is shown. While the picture is live and the user is not driving: a
 * Watch / Take control switch, then full screen (when the browser allows it) and Reset, which turns the pill into
 * "close every window?" (cancelled by itself after 6 s; notes go after 4 s).
 *
 * Full screen applies to the frame itself, not the page, and follows the browser's own full-screen state.
 * In the small panel, "take control" opens the large view in control mode (`onTakeControl` decides); in the panel's own
 * full screen the user can drive there, and leaving full screen hands back.
 *
 * Driving bar (52 px, the bot's colour): a pulsing dot, the hint (or "you're driving"), full screen, and "hand back to
 * <bot>" with its avatar. The frame gets a 2 px ring of the same colour. Animations stop under reduced motion.
 */
export function ScreenFrame({ bot, variant, live, control, hint, children, onTakeControl, onHandBack, onReset, className = "" }: {
  bot: Bot;
  variant: "panel" | "stage";
  /** The picture is streaming (the pill's controls only show then). */
  live: boolean;
  control: boolean;
  /** Shown in the driving bar instead of "you're driving" (e.g. "finish signing in, then hand back"). */
  hint?: string | null;
  children: ReactNode;
  /** "Take control" was pressed; `fullscreen`: the frame is full screen right now. */
  onTakeControl: (fullscreen: boolean) => void;
  onHandBack: () => void;
  onReset?: () => Promise<void>;
  className?: string;
}) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [asking, setAsking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Full screen follows the browser's own event (Escape, the system's gesture…).
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === frame.current && !!frame.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  // Leaving the panel's full screen while driving there hands back (the panel is too small to drive).
  const wasFull = useRef(false);
  useEffect(() => {
    if (wasFull.current && !full && variant === "panel" && control) onHandBack();
    wasFull.current = full;
  }, [full, variant, control, onHandBack]);

  const flash = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setAsking(false);
    setNote(text);
    timer.current = window.setTimeout(() => setNote(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.current!.requestFullscreen();
    } catch {
      flash(t("frame.noFullscreen"));
    }
  };
  const ask = () => {
    window.clearTimeout(timer.current);
    setNote(null);
    setAsking(true);
    timer.current = window.setTimeout(() => setAsking(false), 6000);
  };
  const reset = async () => {
    if (!onReset) return;
    window.clearTimeout(timer.current);
    setResetting(true);
    try {
      await onReset();
      setAsking(false);
    } catch {
      flash(t("frame.resetFailed"));
    } finally {
      setResetting(false);
    }
  };

  const pinned = asking || !!note;
  const big = variant === "stage";
  const style = accentStyle(bot.color, bot.character.customColor);
  return (
    <div className={`screen-frame-wrap is-${variant} ${control ? "is-driving" : ""} ${className}`} style={style}>
      <div ref={frame} className={`screen-frame ${full ? "is-full" : ""}`}>
        {children}
        {(live || pinned) && (
          <div className={`screen-pill ${pinned ? "is-pinned" : ""}`} role="toolbar" aria-label={t("frame.controls", { name: bot.name })}>
            {asking ? (
              <>
                <span className="screen-pill-q">{t("frame.resetAsk")}</span>
                <button type="button" className="screen-pill-btn is-danger" disabled={resetting} onClick={() => void reset()}>{t(resetting ? "frame.resetting" : "frame.reset")}</button>
                <button type="button" className="screen-pill-btn" disabled={resetting} onClick={() => { window.clearTimeout(timer.current); setAsking(false); }}>{t("common.cancel")}</button>
              </>
            ) : note ? (
              <span className="screen-pill-note" role="status">{note}</span>
            ) : live && !control ? (
              <>
                <div className="screen-pill-seg" role="radiogroup" aria-label={t("frame.mode")}>
                  <button type="button" role="radio" aria-checked className="is-on" title={t("frame.watch")}>
                    <Icon name="eye" size={14} />{big && <span>{t("frame.watch")}</span>}
                  </button>
                  <button type="button" role="radio" aria-checked={false} title={t("frame.take")} onClick={() => onTakeControl(full)}>
                    <Icon name="cursor" size={14} />{big && <span>{t("frame.take")}</span>}
                  </button>
                </div>
                <span className="screen-pill-div" aria-hidden="true" />
                {canFullscreen() && (
                  <button type="button" className="screen-pill-icon" aria-label={t(full ? "frame.exitFullscreen" : "frame.fullscreen")} title={t(full ? "frame.exitFullscreen" : "frame.fullscreen")} onClick={() => void toggleFull()}>
                    <Icon name={full ? "fullscreenExit" : "fullscreen"} size={15} />
                  </button>
                )}
                {onReset && (
                  <button type="button" className="screen-pill-icon" aria-label={t("frame.reset")} title={t("frame.reset")} onClick={ask}>
                    <Icon name="refresh" size={15} />
                  </button>
                )}
              </>
            ) : null}
          </div>
        )}
        {control && full && <DriveBar bot={bot} hint={hint} full={full} onFull={() => void toggleFull()} onHandBack={onHandBack} />}
      </div>
      {control && !full && <DriveBar bot={bot} hint={hint} full={full} onFull={() => void toggleFull()} onHandBack={onHandBack} />}
    </div>
  );
}

function DriveBar({ bot, hint, full, onFull, onHandBack }: { bot: Bot; hint?: string | null; full: boolean; onFull: () => void; onHandBack: () => void }) {
  const t = useT();
  return (
    <div className="drive-bar" role="status">
      <span className="drive-ping" aria-hidden="true" />
      <span className="drive-text truncate">{hint || t("frame.driving")}</span>
      {canFullscreen() && (
        <button type="button" className="drive-icon" aria-label={t(full ? "frame.exitFullscreen" : "frame.fullscreen")} title={t(full ? "frame.exitFullscreen" : "frame.fullscreen")} onClick={onFull}>
          <Icon name={full ? "fullscreenExit" : "fullscreen"} size={16} />
        </button>
      )}
      <button type="button" className="drive-back" onClick={onHandBack}>
        <BotAvatar bot={bot} size={22} />
        <span>{t("frame.handBack", { name: bot.name })}</span>
      </button>
    </div>
  );
}
