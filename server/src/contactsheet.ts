import sharp, { type OverlayOptions } from "sharp";
import { browserAvailable, screen } from "./computer.js";
import type { ToolSpec } from "./llm/types.js";
import { noteHost } from "./netjournal.js"; import { netGate } from "./netpolicy.js";
import type { BuiltinTool } from "./agent/tools.js";

/**
 * L114 — « planche-contact »: one picture with the first screen of a page at several widths (phone 390, tablet 768,
 * computer 1280 by default), labelled, side by side, so the bot checks its own work in one look (stick-scene / Anatomy
 * audits: the idea of checking frame by frame; our own code). Taken in a temporary tab of the bot's own browser
 * (computer.ts screen.sheet → browser-cdp.ts op_sheet on a Linux computer); the bot's tab is not touched. Same rules as
 * browser_open: http(s) only, public addresses only, the site noted in the turn's journal, the result is outside content.
 * With `moments` (L114, « une page à N instants »): the same page at one width, photographed 1 to 6 times after it starts
 * loading (e.g. 0, 400, 1200, 3000 ms), so an animated illustration or an entrance is checked image by image.
 */
export const DEFAULT_WIDTHS = [390, 768, 1280];
export const SHEET_HEIGHT = 560;

/** Clean widths: 1 to 4 of them, each 320-1920 px, in the order given (defaults when none). */
export function sheetWidths(raw: unknown): number[] {
  const list = (Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isFinite(n)).map((n) => Math.max(320, Math.min(1920, Math.round(n))));
  return [...new Set(list)].slice(0, 4).length ? [...new Set(list)].slice(0, 4) : DEFAULT_WIDTHS;
}

/** Clean moments: 0 to 6 of them, each 0-10 000 ms after the page starts loading, in time order (none: the widths sheet). */
export function sheetMoments(raw: unknown): number[] {
  const list = (Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isFinite(n)).map((n) => Math.max(0, Math.min(10_000, Math.round(n))));
  return [...new Set(list)].sort((a, b) => a - b).slice(0, 6);
}

/** The labelled grid: each screenshot scaled to the same height, a band with its width above it, 16 px apart. */
export async function composeSheet(shots: { width: number; data: string; at?: number }[]): Promise<Buffer> {
  const band = 28, gap = 16;
  const tiles = await Promise.all(shots.map(async (s) => {
    const img = await sharp(Buffer.from(s.data, "base64")).resize({ height: SHEET_HEIGHT }).jpeg({ quality: 75 }).toBuffer();
    const w = (await sharp(img).metadata()).width ?? 300;
    return { img, w, label: s.at === undefined ? `${s.width} px` : `${s.at} ms` };
  }));
  const width = tiles.reduce((n, t) => n + t.w, 0) + gap * (tiles.length + 1);
  const height = SHEET_HEIGHT + band + gap * 2;
  let x = gap;
  const layers: OverlayOptions[] = [];
  for (const t of tiles) {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${t.w}" height="${band}"><rect width="100%" height="100%" fill="#23262b"/><text x="10" y="19" font-family="sans-serif" font-size="15" font-weight="700" fill="#ffffff">${t.label}</text></svg>`);
    layers.push({ input: svg, left: x, top: gap }, { input: t.img, left: x, top: gap + band });
    x += t.w + gap;
  }
  return sharp({ create: { width, height, channels: 3, background: "#e9e6e0" } }).composite(layers).jpeg({ quality: 72 }).toBuffer();
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
export const contactSheetTools: BuiltinTool[] = [{
  spec: {
    name: "page_contact_sheet",
    description: "Check a web page at several screen widths in one picture: the first screen of the page at phone (390 px), tablet (768 px) and computer (1280 px) width, side by side, labelled. Use it after publishing or changing a page (give its address) to see overflow, cut text, broken layout or a hidden menu before saying it is done. Your own browser tab is left as it is.",
    inputSchema: obj({ url: { type: "string", description: "Address of the page (http or https), e.g. the address page_publish gave" }, widths: { type: "array", items: { type: "integer" }, description: "Optional: 1 to 4 widths in pixels (320-1920); default 390, 768, 1280" }, moments: { type: "array", items: { type: "integer" }, description: "Optional: instead of widths, the same page photographed at these moments after it starts loading, in milliseconds (1 to 6, 0-10000, e.g. [0, 400, 1200, 3000]), at the first width given (default 1280). Use it to check an animation or an entrance frame by frame." } }, ["url"]),
  },
  activity: "browsing", label: "Checking a page at several widths", outside: true, group: "computer",
  detail: (a) => { try { return new URL(String(a.url)).host; } catch { return undefined; } },
  run: async (a, c) => {
    const url = String(a.url ?? "");
    if (!/^https?:\/\//i.test(url)) return { content: "Only http and https addresses can be checked.", isError: true };
    if (!browserAvailable()) return { content: "There is no browser on this server: the page cannot be photographed. Use web_fetch to read it.", isError: true };
    const net = netGate(c.bot, url, "page_check"); if (net) return { content: net, isError: true, summary: "blocked" }; // L169 (netpolicy.ts)
    noteHost(c.bot, url, "page", { tainted: c.tainted });
    const moments = sheetMoments(a.moments);
    const widths = moments.length ? [sheetWidths(Array.isArray(a.widths) && a.widths.length ? a.widths : [1280])[0]] : sheetWidths(a.widths);
    let shots: { width: number; data: string; scrollWidth?: number; at?: number }[];
    try { shots = await screen.sheet(c.bot.id, c.user.id, url, widths, moments); }
    catch (err) { return { content: `The page could not be photographed: ${(err as Error).message}`, isError: true, summary: "not taken" }; }
    if (!shots.length || shots.some((s) => !s.data)) return { content: "The browser took no picture. Try again, or open the page with browser_open.", isError: true };
    const sheet = await composeSheet(shots);
    if (moments.length) return {
      content: [
        { type: "text", text: `${url} at ${widths[0]} px, photographed ${moments.map((m) => `${m} ms`).join(", ")} after it started loading (left to right). Check each moment: what moves, what appears late, a jump of the layout, text unreadable while it animates, an empty first image. Say what you saw and fix it before calling the page finished.` },
        { type: "image", mediaType: "image/jpeg", data: sheet.toString("base64") },
      ],
      summary: moments.map((m) => `${m}`).join(" · ") + " ms",
    };
    const wide = shots.filter((s) => (s.scrollWidth ?? 0) > s.width + 1).map((s) => `at ${s.width} px the page is ${s.scrollWidth} px wide (sideways scroll)`);
    return {
      content: [
        { type: "text", text: `Contact sheet of ${url} at ${widths.join(", ")} px (first screen of each, left to right). ${wide.length ? `Measured: ${wide.join("; ")}. ` : "Measured: no sideways scroll at these widths. "}Look for: text or images cut at the edge, a sideways scroll, overlapping parts, a menu that cannot be opened on the phone, unreadable contrast. Say what you saw and fix it before calling the page finished.` },
        { type: "image", mediaType: "image/jpeg", data: sheet.toString("base64") },
      ],
      summary: widths.map((w) => `${w}`).join(" · ") + " px",
    };
  },
}];
