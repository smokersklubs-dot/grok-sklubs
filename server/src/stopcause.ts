/**
 * L142 « Pastille de cause d'arrêt »: why a bot's last piece of work in its main chat stopped, from its latest rows, as one
 * word for the chip on its line in the sidebar. Pure (no database): stopcauseroutes.ts reads the rows. Idea from Timon /
 * 10-timon (T21); our own code. Nothing here changes anything.
 *
 * Reading from the newest row back: steps, events, cards and informational notices are skipped; a message ends the search
 * (the bot answered, or you wrote since: no chip); a stopping notice gives the cause. A « Continuer » already pressed
 * (status "done") or a subscription limit that is over ("back") is no longer a cause.
 */
import type { Row } from "./shared.js";

export const STOP_CAUSES = ["steps", "timeout", "busy", "interrupted", "plan", "sublimit", "stopped", "loop", "error"] as const;
export type StopCause = (typeof STOP_CAUSES)[number];
export interface StopCauseView { cause: StopCause; text: string; at: number }

/** `stoppedWords`: the words of the « Stopped. » notice in every language (it carries no action to recognise it by). */
export function stopCauseOf(rows: Row[], stoppedWords: string[] = ["Stopped."]): StopCauseView | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.thread) continue;
    const b = r.body;
    if (b.kind === "message") { if (b.text.trim() || b.attachments?.length) return null; continue; }
    if (b.kind !== "notice") continue;
    const a = b.action;
    const view = (cause: StopCause): StopCauseView => ({ cause, text: b.text.slice(0, 300), at: r.createdAt });
    if (a?.kind === "continue") {
      if (a.status === "done") return null;
      return view(a.reason === "timeout" ? "timeout" : a.reason === "busy" ? "busy" : a.reason === "gone" || a.reason === "restart" ? "interrupted" : "steps");
    }
    if (a?.kind === "plan") return view("plan");
    if (a?.kind === "sublimit") { if (a.status === "back") return null; return view("sublimit"); }
    if (a?.kind === "watch") { if (a.status === "stopped") return view("interrupted"); continue; }
    if (a) continue; // route, note, undo, settings: information, not a stop
    if (stoppedWords.includes(b.text.trim())) return view("stopped");
    if (b.tone === "error") return view("error");
    if (b.tone === "warn" && /round in circles|tournais en rond/i.test(b.text)) return view("loop");
  }
  return null;
}
