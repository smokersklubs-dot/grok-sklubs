import { getLive, setLive } from "../bus.js";
import { config } from "../config.js";
import type { BuiltinTool, ToolContext } from "./tools.js";

/**
 * L149 — "where the bot clicked" (audits of Hermes and agent-desktop): each click of the bot on its screen goes into its
 * live state as a point (0–1 of the screen's width and height, and when), so the screen view draws a short-lived mark
 * there (web ClickTrail.tsx). Nothing is kept: a point is only a hint for whoever watches.
 */
export function noteClick(c: Pick<ToolContext, "bot" | "user">, at: readonly [number, number] | null | undefined, now = Date.now()) {
  if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return;
  const [w, h] = config.desktopResolution.split("x").map(Number);
  if (!w || !h) return;
  const unit = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
  const cur = getLive(c.bot.id).activity;
  setLive(c.user.id, c.bot.id, { activity: { ...(cur ?? { kind: "computer", since: now }), point: { x: unit(at[0] / w), y: unit(at[1] / h), at: now } } });
}

/** Wraps the pixel tools: a click (or the end of a drag) that went through leaves its point. */
export function traceClicks(t: BuiltinTool): BuiltinTool {
  const name = t.spec.name;
  if (name !== "screen_click" && name !== "screen_drag") return t;
  return {
    ...t,
    run: async (a, c) => {
      const out = await t.run(a, c);
      if (!out.isError) noteClick(c, name === "screen_click" ? [Number(a.x), Number(a.y)] : [Number(a.to_x), Number(a.to_y)]);
      return out;
    },
  };
}
