import { createHash } from "node:crypto";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L65 — screen_view skips a picture identical to the last one the model was given in this turn (audits of agent-browser
 * and OpenMausBot: a screenshot is the most expensive thing a bot reads, and polling a screen that has not moved wastes
 * it). Every image a screen tool returns is remembered per turn (its SHA-256); a screen_view whose picture is byte for
 * byte the same answers in words instead. `fresh: true` always sends the picture (after a summary dropped it, or to look
 * closely again). A new turn always starts without memory, so the first look of a turn always has its picture.
 */
const lastImage = new WeakMap<object, string>();
const digest = (data: string) => createHash("sha256").update(data).digest("hex");

/** The images a tool's result carries, newest last. */
const imagesOf = (o: ToolOutput) => (Array.isArray(o.content) ? o.content.filter((b): b is Extract<typeof b, { type: "image" }> => b.type === "image") : []);

/** Wraps a screen tool so the last picture it gave the model in this turn is remembered. */
export function noteShots(t: BuiltinTool): BuiltinTool {
  return {
    ...t,
    run: async (a, c) => {
      const out = await t.run(a, c);
      const img = imagesOf(out).at(-1);
      if (img && c.turn && typeof c.turn === "object") lastImage.set(c.turn, digest(img.data));
      return out;
    },
  };
}

/** screen_view's answer: the same picture as the model's last one in this turn comes back as words (unless `fresh`). */
export function sameScreen(c: ToolContext, args: Record<string, unknown>, out: ToolOutput): ToolOutput {
  const img = imagesOf(out).at(-1);
  if (!img || args.fresh === true || !c.turn || typeof c.turn !== "object") return out;
  if (lastImage.get(c.turn) !== digest(img.data)) return out;
  const words = Array.isArray(out.content) ? out.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n") : String(out.content);
  return {
    content: `${words.split("\n")[0]}\nThe screen is exactly the same as in your last screenshot (no pixel changed), so no new picture was sent. Look at that one; if it is no longer in front of you, call screen_view with fresh: true.${words.includes("\n") ? `\n${words.split("\n").slice(1).join("\n")}` : ""}`,
    summary: "unchanged",
  };
}
