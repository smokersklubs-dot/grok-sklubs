import { useStore } from "../store";
import { t } from "../i18n";
import type { Live } from "../types";
import { screenAction } from "./autoscreenrule";

/**
 * L64 « l'écran du bot s'ouvre tout seul »: when the bot you are looking at starts using its browser or its screen, its
 * live screen comes into view by itself, so you watch the page it opens instead of reading about it afterwards.
 *  - wide window: the details panel opens (for this visit only, the saved preference is not changed) on its Activity
 *    tab, where the live screen is, and scrolls to it;
 *  - phone or narrow window: the panel would cover the chat, so a short message offers « Voir l'écran » instead.
 * At most once per run of the bot: if you close the panel meanwhile, it stays closed until the bot's next turn.
 * Only for the bot that is open in the chat, while the tab is visible and the large screen view is not already open.
 * The rule itself is in autoscreenrule.ts (tested in scripts/autoscreen.test.mjs).
 */

/** Fired on window when the panel should show the bot's screen (DetailsPanel listens). */
export const SCREEN_FOCUS_EVENT = "sklubot:screen-focus";

const openedThisRun = new Set<string>();
/** The bot whose screen the panel should bring into view when it next mounts or hears SCREEN_FOCUS_EVENT. */
let pendingFocus: string | null = null;

/** The panel takes the pending request for this bot (true once, then false). */
export function consumeScreenFocus(botId: string): boolean {
  if (pendingFocus !== botId) return false;
  pendingFocus = null;
  return true;
}

/** Called for every live event (events.ts), with the bot's live state from before the event. */
export function noteLiveForScreen(botId: string, prev: Live | undefined, next: Live): "panel" | "toast" | null {
  if (!next.running) { openedThisRun.delete(botId); return null; }
  const s = useStore.getState();
  const bot = s.bots[botId];
  const action = screenAction(prev, next, {
    shown: s.selectedId === botId && s.view === "chat",
    busy: !!s.viewerBotId || document.visibilityState !== "visible",
    hasScreen: !!bot && bot.kind !== "room" && (!s.computer || s.computer.browser),
    alreadyThisRun: openedThisRun.has(botId),
    width: window.innerWidth,
  });
  if (!action || !bot) return null;
  openedThisRun.add(botId);
  if (action === "panel") {
    pendingFocus = botId;
    if (!s.detailsOpen) useStore.setState({ detailsOpen: true });
    window.dispatchEvent(new CustomEvent(SCREEN_FOCUS_EVENT, { detail: { botId } }));
  } else s.showToast(t("autoscreen.toast", { name: bot.name }), { label: t("autoscreen.watch"), run: () => useStore.getState().openViewer(botId) });
  return action;
}
