import { api, errText } from "../api";
import { useStore } from "../store";
import type { Bot, BotSection, PauseResult } from "../types";
import { t, tn, useT } from "../i18n";
import { Icon } from "./Icon";

/**
 * "Pause" in the web app: pause or resume one bot, a sidebar section, or every bot (server: agent/pause.ts). A paused bot
 * shows a badge in the sidebar and the chat header, and a banner over its composer with "Reprendre".
 */

type Target = { kind: "bot"; bot: Bot } | { kind: "section"; section: BotSection } | { kind: "all" };

/** Why a bot stays paused after a resume (its section, everything, itself). */
const whyOf = (bot: Bot): string => t(bot.pause?.by === "all" ? "pause.why.all" : bot.pause?.by === "section" ? "pause.why.section" : "pause.why.bot");

/**
 * Pauses (`paused` true) or resumes a target. Pausing asks first (it stops work under way). Says what happened in a toast,
 * and, after resuming a bot that is still held by something wider, why it is still paused.
 */
export async function setPaused(target: Target, paused: boolean): Promise<void> {
  const { showToast, loadBots, loadSections, loadPauses } = useStore.getState();
  if (paused) {
    const question = target.kind === "all" ? t("pause.confirmAll") : target.kind === "section" ? t("pause.confirmSection", { name: target.section.name }) : t("pause.confirmBot", { name: target.bot.name });
    if (!window.confirm(question)) return;
  }
  const path = target.kind === "all" ? "/pauses/all" : target.kind === "section" ? `/sections/${target.section.id}/${paused ? "pause" : "resume"}` : `/bots/${target.bot.id}/${paused ? "pause" : "resume"}`;
  try {
    await api<PauseResult>("POST", path, target.kind === "all" ? { paused } : undefined);
    await Promise.all([loadBots(), loadSections(), loadPauses()]);
    const name = target.kind === "bot" ? target.bot.name : target.kind === "section" ? target.section.name : "";
    if (target.kind === "all") { showToast(t(paused ? "pause.allPaused" : "pause.allResumed")); return; }
    if (!paused && target.kind === "bot") {
      const now = useStore.getState().bots[target.bot.id];
      if (now?.pause) { showToast(t("pause.stillPaused", { name, why: whyOf(now) })); return; }
    }
    showToast(t(paused ? "pause.paused" : "pause.resumed", { name }));
  } catch (e) { showToast(errText(e)); }
}

/** What "Reprendre" lifts for this bot: the widest pause that holds it. */
export function resumeWidest(bot: Bot): Promise<void> {
  const sections = useStore.getState().sections;
  const p = bot.pause;
  if (p?.by === "all") return setPaused({ kind: "all" }, false);
  const section = p?.by === "section" ? sections.find((s) => s.id === p.sectionId) : undefined;
  if (section) return setPaused({ kind: "section", section }, false);
  return setPaused({ kind: "bot", bot }, false);
}

/** The "En pause" badge (sidebar row, chat header). */
export function PausedBadge({ bot, compact }: { bot: Bot; compact?: boolean }) {
  const t = useT();
  if (!bot.pause) return null;
  return (
    <span className={`pause-badge ${compact ? "is-compact" : ""}`} title={t("pause.badge")} aria-label={compact ? t("pause.badge") : undefined}>
      <Icon name="pause" size={compact ? 10 : 12} />
      {!compact && <span>{t("pause.badge")}</span>}
    </span>
  );
}

/** Over the composer of a paused bot: why it is paused, what happens to messages, and "Reprendre". */
export function PauseBanner({ bot }: { bot: Bot }) {
  const t = useT();
  const sections = useStore((s) => s.sections);
  const p = bot.pause;
  if (!p) return null;
  // A bot someone shares with you: you see it is paused, only its owner resumes it.
  if (bot.access) {
    return (
      <div className="pause-banner" role="status">
        <span className="pause-banner-icon" aria-hidden="true"><Icon name="pause" size={14} /></span>
        <span className="pause-banner-text"><strong>{t("pause.bannerShared", { name: bot.name, owner: bot.access.ownerName })}</strong> <span className="muted">{t("pause.bannerHint")}</span></span>
      </div>
    );
  }
  const section = p.by === "section" ? sections.find((s) => s.id === p.sectionId) : undefined;
  const head = p.by === "all" ? t("pause.bannerAll", { name: bot.name }) : section ? t("pause.bannerSection", { name: bot.name, section: section.name }) : t("pause.bannerBot", { name: bot.name });
  const button = p.by === "all" ? t("pause.resumeAllShort") : section ? t("pause.resumeSectionShort") : t("pause.resume");
  return (
    <div className="pause-banner" role="status">
      <span className="pause-banner-icon" aria-hidden="true"><Icon name="pause" size={14} /></span>
      <span className="pause-banner-text">
        <strong>{head}</strong> <span className="muted">{t("pause.bannerHint")}</span>
        {p.queued > 0 && <span className="pause-banner-queued"> · {tn("pause.queued", p.queued)}</span>}
      </span>
      <button type="button" className="btn btn-small btn-primary pause-banner-btn" onClick={() => void resumeWidest(bot)}>
        <Icon name="play" size={12} /> {button}
      </button>
    </div>
  );
}

/** In the sidebar while every bot is paused: a reminder with "Tout reprendre". */
export function PauseAllNotice({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const all = useStore((s) => s.pauses.all);
  if (!all) return null;
  if (collapsed) {
    return (
      <button type="button" className="icon-btn pause-all-rail" title={`${t("pause.sidebarAll")} — ${t("pause.resumeAll")}`} aria-label={`${t("pause.sidebarAll")} — ${t("pause.resumeAll")}`} onClick={() => void setPaused({ kind: "all" }, false)}>
        <Icon name="pause" size={16} />
      </button>
    );
  }
  return (
    <div className="pause-all" role="status">
      <Icon name="pause" size={14} />
      <span className="truncate">{t("pause.sidebarAll")}</span>
      <button type="button" className="btn btn-small btn-primary" onClick={() => void setPaused({ kind: "all" }, false)}>{t("pause.resume")}</button>
    </div>
  );
}

/** A routine run's note, in the user's language when it is one "Pause" wrote. */
export function runNote(note: string): string {
  if (note === "The bot is paused: skipped.") return t("pause.runSkipped");
  if (note === "The bot was paused: stopped.") return t("pause.runStopped");
  return note;
}
