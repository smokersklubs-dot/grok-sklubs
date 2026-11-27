import type { ToolSpec } from "../llm/types.js";
import { LiveDocError, liveDocs } from "../livedoc.js";
import { clip } from "../store.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L178 — bots in a shared Markdown document (livedoc.ts). A bot sees only the documents its owner shared with it. It
 * edits the CURRENT text by replacing one exact passage (or adding at the end), so its edit never conflicts with the
 * owner typing at the same time (the server folds concurrent changes, clientshared/textop.ts). Every bot change is in
 * the history with its name and can be undone by the owner. No card: the document is the owner's, shared on purpose,
 * and every change is reversible.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const DOC = str("The document's title (or id), as doc_live_list shows it");

export const liveDocTools: BuiltinTool[] = [
  {
    spec: { name: "doc_live_list", description: "List the shared Markdown documents your owner opened to you (they may be editing them right now).", inputSchema: obj({}) },
    group: "files", activity: "reading", label: "Listing shared documents", parallel: true,
    run: async (_a, c) => {
      const list = liveDocs.forBot(c.bot.id);
      return { content: list.length ? `Shared documents:\n${list.map((d) => `- “${d.title}” (${d.chars} characters, version ${d.revision})`).join("\n")}` : "No document is shared with you. The owner shares one from « Documents partagés » in the app.", summary: `${list.length}` };
    },
  },
  {
    spec: { name: "doc_live_read", description: "Read the current text of a shared Markdown document (the owner may be typing in it: read again before editing).", inputSchema: obj({ doc: DOC }, ["doc"]) },
    group: "files", activity: "reading", label: "Reading a shared document", parallel: true,
    run: async (a, c) => {
      const d = liveDocs.forBotByName(c.bot.id, String(a.doc ?? ""));
      if (!d) return { content: `No shared document called "${clip(String(a.doc ?? ""), 80)}" is open to you. Use doc_live_list.`, isError: true };
      return { content: `“${d.title}” (version ${d.revision}):\n\n${d.text}`, summary: clip(d.title, 40) };
    },
  },
  {
    spec: { name: "doc_live_edit", description: "Edit a shared Markdown document live: replace one exact passage of its current text (find must appear exactly once), or add text at the end (find empty). The owner sees it at once, with your name in the history, and can undo it.", inputSchema: obj({ doc: DOC, find: str("The exact passage to replace (empty: add at the end)"), replace: str("The new text") }, ["doc", "replace"]) },
    group: "files", activity: "writing", label: "Writing in a shared document", audited: true,
    run: async (a, c) => {
      const d = liveDocs.forBotByName(c.bot.id, String(a.doc ?? ""));
      if (!d) return { content: `No shared document called "${clip(String(a.doc ?? ""), 80)}" is open to you. Use doc_live_list.`, isError: true };
      const find = typeof a.find === "string" ? a.find : "";
      const replacement = typeof a.replace === "string" ? a.replace : "";
      try {
        const r = liveDocs.replace(d.id, find, find ? replacement : (d.text && !d.text.endsWith("\n") ? "\n" : "") + replacement, { kind: "bot", id: c.bot.id, name: c.bot.name });
        return { content: `Done: “${d.title}” is now at version ${r.revision} (${r.text.length} characters).`, summary: clip(d.title, 40) };
      } catch (e) {
        if (e instanceof LiveDocError) return { content: e.message, isError: true };
        throw e;
      }
    },
  },
];
