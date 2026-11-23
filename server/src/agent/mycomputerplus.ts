import { clip } from "../store.js";
import type { ImageBlock, TextBlock } from "../llm/types.js";
import { act, controlGate, failed, inSession } from "./mycomputer.js";
/** Tests replace the relay calls (no device needed). */
export const relayCalls = { act: (...a: Parameters<typeof act>) => act(...a), failed: (...a: Parameters<typeof failed>) => failed(...a), inSession: (...a: Parameters<typeof inSession>) => inSession(...a) };
const gate: typeof controlGate = (a, ctx) => controlGate(a, ctx); // read when called: no import-order trap
import type { BuiltinTool, ToolContext } from "./tools.js";
import { guards, keepOutHit } from "../relayguard.js";

/**
 * L159, the rest for Sklubot Relais (Sklubot's own code; ideas from the agent-desktop audit):
 *  - « Capture d'un écran secondaire »: my_screen_other looks at another screen of the user's computer (screen.capture
 *    with `display`: 0 the main one, then the others from left to right — companion protocol.js). It is for looking
 *    only: clicks and keys still use the main screen's last picture (relay.ts keeps the last capture of the main screen
 *    only). An older Relais that does not know `display` answers with the main screen: the bot is told so.
 *  - « Attente d'une fenêtre »: my_window_wait waits (at most 60 s) until a window whose title contains the words
 *    appears, by asking the window list once a second (window.list). Nothing is clicked; a window on the owner's
 *    keep-out list is never named.
 */
export const WAIT_MAX_S = 60;
const DEVICE = { type: "string", description: "Which of the user's computers (its name), only needed when several are connected" } as const;
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests: no real waiting. */
export const setWaitSleep = (fn: (ms: number) => Promise<void>) => { sleep = fn; };

const titles = (r: Record<string, unknown>): string[] => Array.isArray(r.windows) ? (r.windows as { title?: unknown }[]).map((w) => String(w?.title ?? "")).filter(Boolean) : [];
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const myComputerPlusTools: BuiltinTool[] = [
  {
    spec: { name: "my_screen_other", description: "Look at another screen of the user's computer (screen 2, 3…), when they have several. For looking only: clicks and keys stay on the main screen (my_screen).", inputSchema: { type: "object", properties: { screen: { type: "integer", description: "Screen number: 2 for the second screen, 3 for the third (1 is the main one)" }, device: DEVICE }, required: ["screen"] } },
    group: "mycomputer", activity: "computer", label: "Looking at another screen of your computer", outside: true, gate,
    run: async (a, c: ToolContext) => relayCalls.inSession(c, a, "control", "", async (t) => {
      if (t.kind === "phone") return { content: "A phone has only one screen: use my_screen.", isError: true };
      const n = Number(a.screen);
      if (!Number.isInteger(n) || n < 1 || n > 16) return { content: "Give the screen number: 2 for the second screen.", isError: true };
      const r = await relayCalls.act(c, t, "screen.capture", { format: "jpeg", maxWidth: 1280, quality: 70, display: n - 1 });
      if (!r.ok) return relayCalls.failed(c, t, r);
      const res = r.result as { format?: string; width?: number; height?: number; data?: string; displayIndex?: number; displays?: number };
      if (typeof res.data !== "string" || !res.data) return { content: "The computer sent an empty picture.", isError: true };
      const old = n > 1 && res.displayIndex === undefined;
      const text = old
        ? `This Sklubot Relais is too old to show another screen: this is the MAIN screen of ${t.label}. Ask the user to update Sklubot Relais.`
        : `Screen ${n}${res.displays ? ` of ${res.displays}` : ""} of ${t.label}: ${res.width}×${res.height} pixels. For looking only: clicks and keys use the main screen (my_screen).`;
      return { content: [{ type: "text", text } as TextBlock, { type: "image", mediaType: res.format === "png" ? "image/png" : "image/jpeg", data: res.data } as ImageBlock], summary: old ? "main screen (old Relais)" : `screen ${n}` };
    }),
  },
  {
    spec: { name: "my_window_wait", description: "Wait until a window whose title contains these words is open on the user's computer (after starting an app or a download), at most 60 seconds. Clicks nothing.", inputSchema: { type: "object", properties: { title: { type: "string", description: "Words of the window title" }, seconds: { type: "integer", description: "How long to wait at most (default 20, at most 60)" }, device: DEVICE }, required: ["title"] } },
    group: "mycomputer", activity: "computer", label: "Waiting for a window on your computer", outside: true, gate,
    run: async (a, c: ToolContext) => relayCalls.inSession(c, a, "control", "", async (t) => {
      if (t.kind === "phone") return { content: "A phone has no windows: use my_windows to read its screen.", isError: true };
      const want = fold(String(a.title ?? "").trim()).slice(0, 200);
      if (!want) return { content: "Give words of the window title.", isError: true };
      const seconds = Math.max(1, Math.min(WAIT_MAX_S, Number.isFinite(Number(a.seconds)) ? Math.round(Number(a.seconds)) : 20));
      const owner = guards.get(c.user.id, t.id);
      for (let i = 0; i <= seconds; i++) {
        if (c.signal?.aborted) return { content: "Stopped.", isError: true };
        const r = await relayCalls.act(c, t, "window.list", {});
        if (!r.ok) return relayCalls.failed(c, t, r);
        const hit = titles(r.result).find((x) => fold(x).includes(want));
        if (hit) return keepOutHit({ title: hit }, owner)
          ? { content: "A window matching that is open, but it is on the user's keep-out list.", summary: "keep-out" }
          : { content: `The window "${clip(hit, 200)}" is open (after ${i} s).`, summary: clip(hit, 40) };
        if (i < seconds) await sleep(1000);
      }
      return { content: `No window with "${clip(String(a.title), 100)}" in its title appeared within ${seconds} s.`, summary: "not yet" };
    }),
  },
];
