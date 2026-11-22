import sharp, { type OverlayOptions } from "sharp";
import { browserAvailable, screen } from "./computer.js";
import type { ToolSpec } from "./llm/types.js";
import { noteHost } from "./netjournal.js";
import type { BuiltinTool } from "./agent/tools.js";

/**
 * L114 — « planche-contact »: one picture with the first screen of a page at several widths (phone 390, tablet 768,
 * computer 1280 by default), labelled, side by side, so the bot checks its own work in one look (stick-scene / Anatomy
 * audits: the idea of checking frame by frame; our own code). Taken in a temporary tab of the bot's own browser
 * (computer.ts screen.sheet → browser-cdp.ts op_sheet on a Linux computer); the bot's tab is not touched. Same rules as
 * browser_open: http(s) only, public addresses only, the site noted in the turn's journal, the result is outside content.
 */
export const DEFAULT_WIDTHS = [390, 768, 1280];
export const SHEET_HEIGHT = 560;

/** Clean widths: 1 to 4 of them, each 320-1920 px, in the order given (defaults when none). */
export function sheetWidths(raw: unknown): number[] {
  const list = (Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isFinite(n)).map((n) => Math.max(320, Math.min(1920, Math.round(n))));
  return [...new Set(list)].slice(0, 4).length ? [...new Set(list)].slice(0, 4) : DEFAULT_WIDTHS;
}

/** The labelled grid: each screenshot scaled to the same height, a band with its width above it, 16 px apart. */
export async function composeSheet(shots: { width: number; data: string }[]): Promise<Buffer> {
  const band = 28, gap = 16;
  const tiles = await Promise.all(shots.map(async (s) => {
    const img = await sharp(Buffer.from(s.data, "base64")).resize({ height: SHEET_HEIGHT }).jpeg({ quality: 75 }).toBuffer();
    const w = (await sharp(img).metadata()).width ?? 300;
    return { img, w, label: `${s.width} px` };
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
    inputSchema: obj({ url: { type: "string", description: "Address of the page (http or https), e.g. the address page_publish gave" }, widths: { type: "array", items: { type: "integer" }, description: "Optional: 1 to 4 widths in pixels (320-1920); default 390, 768, 1280" } }, ["url"]),
  },
  activity: "browsing", label: "Checking a page at several widths", outside: true, group: "computer",
  detail: (a) => { try { return new URL(String(a.url)).host; } catch { return undefined; } },
  run: async (a, c) => {
    const url = String(a.url ?? "");
    if (!/^https?:\/\//i.test(url)) return { content: "Only http and https addresses can be checked.", isError: true };
    if (!browserAvailable()) return { content: "There is no browser on this server: the page cannot be photographed. Use web_fetch to read it.", isError: true };
    noteHost(c.bot, url, "page", { tainted: c.tainted });
    const widths = sheetWidths(a.widths);
    let shots: { width: number; data: string; scrollWidth?: number }[];
    try { shots = await screen.sheet(c.bot.id, c.user.id, url, widths); }
    catch (err) { return { content: `The page could not be photographed: ${(err as Error).message}`, isError: true, summary: "not taken" }; }
    if (!shots.length || shots.some((s) => !s.data)) return { content: "The browser took no picture. Try again, or open the page with browser_open.", isError: true };
    const sheet = await composeSheet(shots);
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
