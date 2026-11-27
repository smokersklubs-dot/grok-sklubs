import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import type { ToolSpec } from "../llm/types.js";
import { capabilityGaps, shortcuts } from "../botcarework.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L161 (backlog A-FAIRE) bot tools:
 *   capability_gap  « il me manque une capacité » (Astryx gap-report, idea only): notes what is missing for the owner, as a
 *                   card in the chat and a line in Settings → Team. Never installs, never connects, nothing goes out.
 *   shortcut_note   « raccourcis à revoir » (Ponytail ponytail-debt, idea only): a shortcut the bot took, what it leaves
 *                   out, when to revisit it.
 *   docs_read       Sklubot's own documentation (Timon T55 / docs_read, idea only): the Markdown files at the top of the
 *                   docs/ folder of this installation, read-only. The index, one file by parts, or a search. Nothing
 *                   outside that folder can be named (no path, no subfolder, links resolved and checked).
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

export const DOCS_DIR = () => process.env.SKLUBOT_DOCS_DIR || path.join(ROOT, "docs");
export const DOC_PART = 12_000;

/** The readable files: *.md directly in docs/, nothing else. */
export function docFiles(): { name: string; title: string }[] {
  const dir = DOCS_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(e.name))
    .map((e) => { const head = readFileSync(path.join(dir, e.name), "utf8").slice(0, 2000); return { name: e.name, title: /^#\s+(.+)$/m.exec(head)?.[1].trim() ?? e.name }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One file's text, or null when the name is not one of docFiles (paths, subfolders, links leaving the folder refused). */
export function readDoc(wanted: string): { name: string; text: string } | null {
  const w = wanted.trim().replace(/^docs\//i, "");
  const list = docFiles();
  const hit = list.find((f) => f.name.toLowerCase() === w.toLowerCase() || f.name.toLowerCase() === `${w.toLowerCase()}.md`);
  if (!hit) return null;
  const dir = realpathSync(DOCS_DIR());
  const real = realpathSync(path.join(dir, hit.name));
  if (path.dirname(real) !== dir || !statSync(real).isFile()) return null;
  return { name: hit.name, text: readFileSync(real, "utf8") };
}

/** Lines that hold every word of the search (accents and case ignored), 20 at most. */
export function searchDocs(query: string): { name: string; line: number; text: string }[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter((x) => x.length > 1);
  if (!words.length) return [];
  const out: { name: string; line: number; text: string }[] = [];
  for (const f of docFiles()) {
    const doc = readDoc(f.name);
    if (!doc) continue;
    doc.text.split("\n").forEach((l, i) => { if (out.length < 20 && words.every((w) => fold(l).includes(w))) out.push({ name: f.name, line: i + 1, text: l.trim().slice(0, 240) }); });
  }
  return out;
}

export const careTools: BuiltinTool[] = [
  {
    spec: {
      name: "capability_gap",
      description: "When you cannot do what the user asked because you lack a tool, an app connection, an access or a skill, note it for the user with this tool instead of improvising: what is missing, why it is needed and what you tried. It only records a card for the user — it installs and connects nothing. Then tell the user plainly what you could not do.",
      inputSchema: obj({ what: str("The missing capability, in a few words (e.g. 'read my Google Agenda')"), why: str("What the user asked that needs it"), tried: str("What you tried instead, if anything") }, ["what"]),
    },
    activity: "remembering", label: "Noting a missing capability",
    run: async (a, c) => {
      const r = capabilityGaps.note(c.bot, a, c.thread ?? 0);
      if (typeof r === "string") return { content: r, isError: true };
      return { content: `Noted for the user (Settings → Team → Missing capabilities${r.times > 1 ? `, asked ${r.times} times` : ""}). Nothing was installed or connected.`, summary: r.what };
    },
  },
  {
    spec: {
      name: "shortcut_note",
      description: "When you deliberately take a shortcut that the user should look at again later (you took only the first 50 results, skipped a check, used an estimate, hard-coded a value), note it here: what you did, what it leaves out, and when to revisit it (a date YYYY-MM-DD, 'in 2 weeks', or the event that should trigger it). The user sees the list of shortcuts to revisit.",
      inputSchema: obj({ what: str("The shortcut you took"), leaves_out: str("What it leaves out or the risk"), revisit: str("When to look at it again: a date, a delay or an event") }, ["what"]),
    },
    activity: "remembering", label: "Noting a shortcut to revisit",
    run: async (a, c) => {
      const r = shortcuts.note(c.bot, a);
      if (typeof r === "string") return { content: r, isError: true };
      return { content: r.noRevisit ? "Noted. It has no moment to revisit: the user will see it flagged — add one next time." : "Noted in the user's list of shortcuts to revisit.", summary: r.what };
    },
  },
  {
    spec: {
      name: "docs_read",
      description: "Read Sklubot's own documentation (the app you run in), to answer 'how do I set up X in Sklubot?' with the real page. Without arguments: the list of pages. With name: that page (long pages come in parts: pass part). With search: the lines that contain all the words. Cite the page you used.",
      inputSchema: obj({ name: str("A page from the list, e.g. 'CANAUX.md'"), part: { type: "integer", description: "Part number for long pages (1, 2…)" }, search: str("Words to look for in every page") }),
    },
    activity: "remembering", label: "Reading Sklubot's documentation", parallel: true,
    run: async (a) => {
      const list = docFiles();
      if (!list.length) return { content: "Sklubot's documentation is not installed on this server.", isError: true };
      if (typeof a.search === "string" && a.search.trim()) {
        const hits = searchDocs(a.search);
        return { content: hits.length ? hits.map((h) => `${h.name}:${h.line}: ${h.text}`).join("\n") : `Nothing in the documentation contains: ${a.search}`, summary: a.search };
      }
      if (typeof a.name !== "string" || !a.name.trim()) return { content: ["# Sklubot documentation", ...list.map((f) => `- ${f.name} — ${f.title}`)].join("\n"), summary: `${list.length} pages` };
      const doc = readDoc(a.name);
      if (!doc) return { content: `No page is called "${a.name}". Pages: ${list.map((f) => f.name).join(", ")}.`, isError: true };
      const parts = Math.max(1, Math.ceil(doc.text.length / DOC_PART));
      const part = Math.min(parts, Math.max(1, Math.floor(Number(a.part) || 1)));
      const chunk = doc.text.slice((part - 1) * DOC_PART, part * DOC_PART);
      return { content: `# docs/${doc.name}${parts > 1 ? ` (part ${part} of ${parts})` : ""}\n\n${chunk}`, summary: doc.name };
    },
  },
];
