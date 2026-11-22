import { closeSync, readSync } from "node:fs"; import { cdnWarning } from "../cdnintegrity.js"; // L45
import { emit } from "../bus.js";
import { openLibraryFile, readLibraryFile, saveFile } from "../computer.js";
import { config as appConfig } from "../config.js";
import type { ToolSpec } from "../llm/types.js";
import { checkFiles, cleanFileName, FILE_EXT, PAGE_CDNS, pageFiles, pageLimits, PageFileError, pageVersions } from "../pagefiles.js";
import { atelierTokens } from "../artifact-design.js";
import { bots, pages, randomToken, rows } from "../store.js";
import type { BuiltinTool, ToolContext } from "./tools.js";

/**
 * page_publish / page_edit: a bot publishes a web page (HTML, plus text files next to it) and changes it with exact
 * replacements. Every publish and edit keeps a version (pagefiles.ts). Publishing for anyone with the link asks the
 * user's approval (irreversible.ts); a private page does not.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool => ({ spec: { name, description, inputSchema: schema }, ...rest });
function pathOf(botId: string, name: unknown, creatingArtifact = false): string {
  const slug = String(name ?? "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "page";
  const artifactPath = `artifacts/${slug}.html`;
  if (creatingArtifact || (slug.startsWith("artifact-") && pages.forPath(botId, artifactPath, appConfig.publicUrl))) return artifactPath;
  return `pages/${slug}.html`;
}
const EXTS = Object.keys(FILE_EXT).map((e) => `.${e}`).join(", ");

const fileSchema = { type: "array", description: `Optional text files next to the HTML: [{"path": "css/site.css", "content": "…"}] (${EXTS}; 20 files, 1 MB each, 5 MB in all at most; less on a free plan)`, items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } };

const publish = tool("page_publish", `Publish a web page (a report, a dashboard, a tool, slides, a mini-game) at an address: by default anyone with the link can open it; "private" means only the user, signed in to Sklubot. Its scripts run in a sandbox (no cookies, no storage, no forms, no dialogs); scripts and styles may be inline, in its own files, or from ${PAGE_CDNS.join(", ")} (pin exact versions and add integrity="sha384-…" crossorigin="anonymous" to each CDN script and style sheet); fonts also from Google Fonts; pictures from any https address or data:; fetch() reaches only the page's own files. Optional files next to the HTML (${EXTS}) are referred to by relative paths. Publishing again under the same name updates the page at the same address (replacing its files) and keeps the previous version; for small changes use page_edit.`,
  obj({
    name: str("Short file name without extension, e.g. weekly-report"), title: str("Page title"), html: str("The full HTML document"),
    visibility: { type: "string", enum: ["link", "private"], description: "link (default): anyone with the address; private: only the user, signed in" },
    files: fileSchema,
  }, ["name", "title", "html"]), {
  activity: "saving", label: "Publishing a page", group: "pages", audited: true, detail: (a) => String(a.title ?? ""),
  run: async (a, c) => publishPage(a, c),
});

export function publishPage(a: Record<string, unknown>, c: Pick<ToolContext, "bot" | "user" | "thread">, creatingArtifact = false) {
  const html = String(a.html);
  let files;
  try { files = checkFiles(c.user.id, a.files, Buffer.byteLength(html)); } catch (err) { if (err instanceof PageFileError) return { content: `${err.message} Nothing was published.`, isError: true }; throw err; }
  const rel = saveFile(c.bot.id, pathOf(c.bot.id, a.name, creatingArtifact), html);
  const existing = pages.forPath(c.bot.id, rel, appConfig.publicUrl);
  const visibility = a.visibility === "private" ? "private" : a.visibility === "link" ? "link" : undefined;
  if (existing) { pages.retitle(existing.token, String(a.title)); if (visibility) pages.setVisibility(existing.token, visibility); }
  const page = existing ?? pages.create(c.bot, String(a.title), rel, appConfig.publicUrl, visibility ?? "link");
  pageFiles.replace(c.bot.id, rel, files);
  pageVersions.record(c.user.id, c.bot.id, rel, html, existing ? "published again" : "published");
  if (!existing) {
    const chatUrl = creatingArtifact ? appConfig.publicUrl + "/?artifact=" + page.token : page.url;
    rows.append(c.bot, { kind: "message", role: "assistant", page: { token: page.token, title: page.title, open: creatingArtifact }, text: `[${String(a.title).replace(/[\[\]\r\n]/g, " ").slice(0, 120) || "Artefact"}](${chatUrl})` }, c.thread);
    bots.bumpUnread(c.bot.id);
  }
  emit(c.user.id, { type: "pages", token: page.token });
  const vis = visibility ?? existing?.visibility ?? "link";
  return { content: `${existing ? "Updated" : "Published"} at ${page.url}${existing ? "" : " — the link is in the chat"}${files.length ? `, with ${files.length} file${files.length > 1 ? "s" : ""}` : ""}. ${vis === "private" ? "Private: only the user, signed in, can open it." : "Anyone with the link can open it."} The previous version is kept in its history.${cdnWarning(html)}`, summary: String(a.title) };
}

export const pageTools: BuiltinTool[] = [
  publish,
  tool("artifact_from_file", "Deliver an existing self-contained HTML tool from this bot's own file library as a private artifact in the current chat. Use after generating a tool with Craft Anything. For subsequent edits use page_source and page_edit on the returned name.", obj({
    title: str("User-facing title"), file: str("Relative library path to a standalone .html file"),
  }, ["title", "file"]), {
    group: "pages", activity: "saving", audited: true, label: "Opening the created tool",
    run: async (a, c) => {
      const path = String(a.file ?? "");
      if (!/\.html?$/i.test(path)) return { isError: true, content: "Choose a self-contained HTML file from the bot library." };
      const { fd, size } = openLibraryFile(c.bot.id, path);
      let html: string;
      try {
        if (!size || size > pageLimits(c.user.id).htmlBytes) return { isError: true, content: "The HTML file is empty or over the page size limit." };
        const buffer = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const count = readSync(fd, buffer, offset, size - offset, offset);
          if (!count) return { isError: true, content: "The file changed while reading. Try again after the build finishes." };
          offset += count;
        }
        html = buffer.toString("utf8");
      } finally { closeSync(fd); }
      const name = `artifact-${randomToken(12)}`;
      const result = await publishPage({ name, title: a.title, html, visibility: "private" }, c, true);
      return result.isError ? result : { ...result, content: `Artifact name: ${name}. ${result.content}` };
    },
  }),
  tool("artifact_create", "Create a private, interactive web artifact in this chat. Provide self-contained HTML and optional relative CSS/JS files. Scripts may use only bundled resources. Returns its stable name for revisions.", obj({
    title: str("Artifact title"), html: str("Complete HTML document"),
    files: fileSchema,
    theme: { type: "string", enum: ["atelier-zero"], description: "Optional OpenDesign stylesheet. Use its CSS variables in the artifact." },
  }, ["title", "html"]), {
    activity: "saving", label: "Creating an artifact", group: "pages", audited: true,
    run: async (a, c) => {
      const name = `artifact-${randomToken(12)}`;
      const files = Array.isArray(a.files) ? [...a.files] : [];
      let html = String(a.html ?? "");
      if (!html.trim()) return { content: "Provide a complete HTML document.", isError: true };
      if (a.theme === "atelier-zero") {
        files.push({ path: "atelier-zero.css", content: atelierTokens() });
        const link = '<link rel="stylesheet" href="atelier-zero.css">';
        html = /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + link) : html.replace(/^(\s*<!doctype[^>]*>)?/i, (start) => start + link);
      }
      const result = await publishPage({ ...a, name, html, files, visibility: "private" }, c, true);
      return result.isError ? result : { ...result, content: `Artifact name: ${name}. ${result.content}` };
    },
  }),
  tool("page_source", "Read your saved page's current HTML or one of its relative files before revising it. Returns the file list and a bounded chunk of source.", obj({
    name: str("Saved page name"), file: str("Optional relative asset path"), offset: { type: "integer", minimum: 0 },
  }, ["name"]), {
    activity: "reading", label: "Reading artifact source", group: "pages", outside: true,
    run: async (a, c) => {
      const path = pathOf(c.bot.id, a.name);
      if (!pages.forPath(c.bot.id, path, appConfig.publicUrl)) return { content: "Page not found.", isError: true };
      const file = a.file ? cleanFileName(a.file) : null;
      const source = a.file ? (file && pageFiles.get(c.bot.id, path, file)) : readLibraryFile(c.bot.id, path).toString("utf8");
      if (source == null) return { content: "File not found.", isError: true };
      const offset = Math.max(0, Math.trunc(Number(a.offset) || 0));
      return { content: JSON.stringify({ files: pageFiles.names(c.bot.id, path), length: source.length, offset, source: source.slice(offset, offset + 20000) }) };
    },
  }),
  tool("page_edit", "Change a page you already published with targeted edits instead of rewriting it: each edit replaces one exact piece of text (which must appear exactly once) with new text. By default the edits apply to the page's HTML; give `file` to change one of its files instead (or to add a new file: one edit with an empty find and the whole content as replace). All or nothing; a version is kept. The address stays the same.",
    obj({
      name: str("The page's file name, as given to page_publish"), file: str("Optional: a file of the page (e.g. css/site.css) instead of its HTML"),
      edits: { type: "array", description: "[{\"find\": \"exact old text\", \"replace\": \"new text\"}], applied in order (at most 20)", items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] } },
    }, ["name", "edits"]), {
    activity: "saving", label: "Editing a page", group: "pages", audited: true, detail: (a) => String(a.file ? `${a.name} · ${a.file}` : a.name ?? ""),
    run: async (a, c) => {
      const rel = pathOf(c.bot.id, a.name);
      const page = pages.forPath(c.bot.id, rel, appConfig.publicUrl);
      if (!page) return { content: `You have no published page called "${a.name}". Publish it first with page_publish.`, isError: true };
      let html: string;
      try { html = readLibraryFile(c.bot.id, rel).toString("utf8"); } catch { return { content: "That page's file is gone. Publish it again with page_publish.", isError: true }; }
      const file = a.file ? cleanFileName(a.file) : null;
      if (a.file && !file) return { content: `"${String(a.file).slice(0, 80)}" is not an accepted file name (a relative name ending in ${EXTS}). Nothing was changed.`, isError: true };
      const current = file ? pageFiles.get(c.bot.id, rel, file) : html;
      const edits = (Array.isArray(a.edits) ? a.edits : []).slice(0, 20);
      if (!edits.length) return { content: "Give at least one edit.", isError: true };
      let text = current ?? "";
      // All or nothing: every edit must find its text exactly once (in the text as the previous edits left it). A new
      // file starts from a single edit with an empty find.
      if (current === null) {
        if (edits.length !== 1 || String(edits[0]?.find ?? "") !== "") return { content: `The page has no file "${file}". To add it, give one edit with an empty find and its whole content as replace. Nothing was changed.`, isError: true };
        text = String(edits[0]?.replace ?? "");
      } else {
        for (const [i, e] of edits.entries()) {
          const find = String(e?.find ?? "");
          if (!find) return { content: `Edit ${i + 1} has no text to find. Nothing was changed.`, isError: true };
          const count = text.split(find).length - 1;
          if (count !== 1) return { content: `Edit ${i + 1}: the text to find appears ${count} times (it must appear exactly once). Nothing was changed.`, isError: true, summary: "not applied" };
          text = text.replace(find, () => String(e?.replace ?? ""));
        }
      }
      // The limits of the whole page, with the change.
      const others = pageFiles.list(c.bot.id, rel).filter((f) => f.file !== file).map((f) => ({ path: f.file, content: f.content }));
      try { checkFiles(c.user.id, file ? [...others, { path: file, content: text }] : others, Buffer.byteLength(file ? html : text)); }
      catch (err) { if (err instanceof PageFileError) return { content: `${err.message} Nothing was changed.`, isError: true }; throw err; }
      if (file) pageFiles.put(c.bot.id, rel, file, text); else { saveFile(c.bot.id, rel, text); html = text; }
      pageVersions.record(c.user.id, c.bot.id, rel, html, file ? `edited ${file}` : "edited");
      emit(c.user.id, { type: "pages", token: page.token });
      return { content: `Applied ${edits.length} edit${edits.length > 1 ? "s" : ""} to ${file ? `${file} of ` : ""}${page.url}. The previous version is kept (${pageLimits(c.user.id).versions} versions at most).${file ? "" : cdnWarning(html)}`, summary: `${page.title} · ${edits.length}` };
    },
  }),
];
