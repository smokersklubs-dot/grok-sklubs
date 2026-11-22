/**
 * L156 « Exporter »: a conversation as a Markdown file, the same conversation as a printable page (the browser's « Enregistrer
 * en PDF »), and the debug export of one turn (what the bot did for one request, as JSON) with secrets masked. Built in the
 * browser from the rows already on the page: nothing is sent anywhere. Ideas from Agent Zero / OpenClaw; our own code.
 */
import type { Row } from "../types";

export interface ExportLabels { you: string; bot: string; title: string; exportedAt: string; step: string; notice: string }

/** A secret finder (server shared.ts findSecrets in the app; injected so this file stays free of server imports). */
export type SecretFinder = (text: string) => { start: number; end: number }[];

/** The text with every secret the finder sees replaced by "•••• (masqué)" / "•••• (masked)". */
export function maskSecrets(text: string, find: SecretFinder, word = "masked"): string {
  const found = find(text).slice().sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  for (const f of found) {
    if (f.end > floor) continue; // overlapping finds: the outer one already replaced
    out = out.slice(0, f.start) + `•••• (${word})` + out.slice(f.end);
    floor = f.start;
  }
  return out;
}

const two = (n: number) => String(n).padStart(2, "0");
/** "2026-11-22 14:05" in local time (no seconds: an export is read, not parsed). */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** A safe file name: letters, digits and dashes, from the bot's name and the day. */
export function exportFileName(botName: string, ms: number, ext: "md" | "json" | "html"): string {
  const base = botName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "conversation";
  return `${base}-${stamp(ms).slice(0, 10)}.${ext}`;
}

/**
 * The main conversation (thread replies left out) as Markdown: a heading, then each message under "**Name** · time".
 * Steps and cards are left out (a conversation export is for reading); notices are kept as quotes. Secrets are masked.
 */
export function conversationMarkdown(botName: string, rows: Row[], labels: ExportLabels, find: SecretFinder, now = Date.now()): string {
  const out: string[] = [`# ${labels.title}`, "", `_${labels.exportedAt} ${stamp(now)}_`, ""];
  for (const r of rows) {
    if (r.thread) continue;
    const b = r.body;
    if (b.kind === "message") {
      const text = b.text.trim();
      if (!text && !b.attachments?.length) continue;
      const who = b.role === "user" ? (b.origin?.name ?? labels.you) : (b.origin?.name ?? botName);
      out.push(`**${who}** · ${stamp(r.createdAt)}`, "");
      if (text) out.push(maskSecrets(text, find), "");
      for (const a of b.attachments ?? []) out.push(`- 📎 ${a.name}`);
      if (b.attachments?.length) out.push("");
      for (const s of b.sources ?? []) out.push(`- 🔗 [${s.title ?? s.url}](${s.url})`);
      if (b.sources?.length) out.push("");
    } else if (b.kind === "notice") {
      out.push(`> ${labels.notice} : ${maskSecrets(b.text, find).replace(/\n/g, " ")}`, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * The debug export of one turn: from the request (the user message before `seq`) to the reply `seq`, every row (steps,
 * notices, cards) as JSON, each string with secrets masked. Long strings are cut at 4,000 characters.
 */
export function turnDebug(rows: Row[], seq: number, find: SecretFinder): { request: number | null; reply: number; rows: unknown[] } {
  const main = rows.filter((r) => (r.thread ?? 0) === (rows.find((x) => x.seq === seq)?.thread ?? 0));
  const end = main.findIndex((r) => r.seq === seq);
  if (end < 0) return { request: null, reply: seq, rows: [] };
  let start = end;
  while (start > 0 && !(main[start].body.kind === "message" && (main[start].body as { role: string }).role === "user" && start !== end)) start--;
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") { const m = maskSecrets(v, find); return m.length > 4000 ? m.slice(0, 3999) + "…" : m; }
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
    return v;
  };
  const picked = main.slice(start, end + 1);
  const first = picked[0];
  return { request: first && first.body.kind === "message" && first.body.role === "user" ? first.seq : null, reply: seq, rows: picked.map((r) => clean({ seq: r.seq, at: new Date(r.createdAt).toISOString(), body: r.body })) };
}

/** Markdown-light → a self-contained printable HTML page (no script, no outside resource). */
export function printableHtml(title: string, markdownHtml: string, lang: string): string {
  const esc = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="${lang === "fr" ? "fr" : "en"}"><head><meta charset="utf-8"><title>${esc}</title><style>
@page { size: A4; margin: 18mm 16mm; }
body { font: 11pt/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1b17; max-width: 720px; margin: 24px auto; padding: 0 16px; }
h1 { font-size: 18pt; } pre, code { font-family: ui-monospace, Menlo, monospace; font-size: 9.5pt; } pre { white-space: pre-wrap; background: #f4f2ee; padding: 8px; border-radius: 6px; }
blockquote { margin: 0 0 0 4px; padding-left: 10px; border-left: 3px solid #c9c4ba; color: #555; } table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 3px 6px; }
p strong:first-child { color: #333; } a { color: #2b4fbf; }
</style></head><body>${markdownHtml}</body></html>`;
}
