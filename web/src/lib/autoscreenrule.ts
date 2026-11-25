/**
 * L64 « l'écran du bot s'ouvre tout seul »: the pure rule (no store, no DOM), so it can be tested on its own. See
 * autoscreen.ts for what happens on screen.
 */
interface LiveLike { running: boolean; activity: { kind: string } | null }

const SCREEN_KINDS = new Set<string>(["browsing", "computer"]);
/** The details panel is beside the chat from this width (store.ts `narrow`). */
export const WIDE_FROM = 1100;

const usesScreen = (l: LiveLike | undefined) => !!l?.running && !!l.activity && SCREEN_KINDS.has(l.activity.kind);

/** The bot has just started using its browser or screen (it was doing something else, or nothing, before). */
export function startsUsingScreen(prev: LiveLike | undefined, next: LiveLike): boolean {
  return usesScreen(next) && !usesScreen(prev);
}

export interface ScreenContext {
  /** The bot is the one open in the chat view. */
  shown: boolean;
  /** The large screen view is already open, or the tab is hidden. */
  busy: boolean;
  /** This server gives bots a browser, and the bot is a bot (not a group). */
  hasScreen: boolean;
  /** Already brought up during this run of the bot. */
  alreadyThisRun: boolean;
  width: number;
}

/** What to do for a live change: open the panel (wide window), offer « Voir l'écran » (narrow), or nothing. */
export function screenAction(prev: LiveLike | undefined, next: LiveLike, c: ScreenContext): "panel" | "toast" | null {
  if (!startsUsingScreen(prev, next) || c.alreadyThisRun || !c.shown || c.busy || !c.hasScreen) return null;
  return c.width >= WIDE_FROM ? "panel" : "toast";
}
