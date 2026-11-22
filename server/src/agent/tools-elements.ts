import { deleteCheckAnswer } from "./deletecheck.js";
import { computerKind, noteReportedUrl, screen, workspaceOf } from "../computer.js";
import { dialogWords } from "../browser-cdp.js";
import { consoleLines, maskHeaders, maskUrl, requestLine, type ConsoleMessage, type NetRequest } from "../browser-devtools.js";
import type { ToolSpec } from "../llm/types.js";
import { linuxScreen } from "../linux.js";
import type { ElementAnswer, ElementRequest, FillResult } from "../screen-elements.js";
import { maskSecrets } from "../shared.js";
import { clip } from "../store.js";
import { committingKind, probe, seenOf, seenTarget } from "./bind.js";
import { afterClick, hostBeforeClick } from "./clickhosts.js";
import { afterAction, noteMoved, refusal, rememberSnapshot, resolveRef, snapshotUrl, typedWords } from "./elements.js";
import { shot } from "./tools-browser.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * The bot's browser by element references, in words (wave 8 item 6; L65, L74, L75, L81 — audits of agent-browser and
 * chrome-devtools-mcp, docs/audits). Linux computers only: everything goes through the desktop browser's debugging port
 * (browser-cdp.ts, screen-elements.ts, browser-devtools.ts).
 *
 *  - L65: browser_open and the element actions answer with the page's structure and what changed (addresses, controls,
 *    new text), not a screenshot; a screenshot comes when asked (`screenshot: true`) or when words are not enough (no
 *    control and almost no text, or a canvas / video covering much of the screen).
 *  - L74: hints for unnamed controls, link addresses, references stable on one page, typing read back ("verified"),
 *    whether trying again is safe, "sent but not confirmed".
 *  - L75: browser_wait (text, address, load), element_fill (several fields in one call), element_hover, element_upload,
 *    double-click; the helper waits for the page to calm down after each action.
 *  - L81: browser_console and browser_network, read-only, header values that can carry a secret masked.
 *
 * Every action keeps Sklubot's gates: a click whose words commit something is bound and asked like screen_click (bind.ts,
 * authorize.ts) and never "found again" by its name; element_fill never ticks a box whose words commit something; a file
 * upload asks the user every time; the server refuses screen actions while the user drives (tools.ts respectDriver).
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool => ({ spec: { name, description, inputSchema: schema }, ...rest });
const REF = str("An element reference from your latest element_snapshot or action result, e.g. 3f9a.12");
const SHOT = { type: "boolean", description: "Also return a screenshot (default false: the page comes back in words, which is cheaper; ask for one when the layout or pictures matter)" };
const ws = (c: ToolContext) => workspaceOf(c.bot.id);

/** L65: an action's answer in words — the caption, any dialog, the page after it — plus a screenshot when asked or when words are not enough. */
async function inWords(c: ToolContext, a: ElementAnswer, caption: string, wantShot: boolean, summary: string): Promise<ToolOutput> {
  const parts = [caption];
  if (a.dialog) parts.push(dialogWords(a.dialog));
  let sparse = false;
  if (a.after) {
    noteReportedUrl(c.bot.id, a.after.url);
    const r = afterAction(c.bot.id, a.after);
    parts.push(r.text);
    sparse = r.sparse;
  } else if (!a.dialog) parts.push("(The page could not be read back: look with element_snapshot or screen_view.)");
  if (!wantShot && !sparse) return { content: parts.join("\n"), summary };
  if (sparse && !wantShot) parts.push("Words are not enough on this page (almost no text or controls, or a canvas / video covers much of it): here is the screen too.");
  try {
    const s = await screen.view(c.bot.id, c.user.id);
    return { content: [{ type: "text", text: parts.join("\n") }, { type: "image", mediaType: s.mediaType, data: s.data }], summary };
  } catch { return { content: parts.join("\n"), summary }; }
}

const act = async (c: ToolContext, req: ElementRequest) => (await linuxScreen.elementAct(c.bot.id, c.user.id, ws(c), { ...req, after: true })).answer;
const notDone = (c: ToolContext, a: ElementAnswer, what: string): ToolOutput => ({ content: refusal(c.bot.id, a, what), isError: true, summary: a.stale ? "stale reference" : a.sent ? "sent, not confirmed" : "not done" });
const movedLine = (a: ElementAnswer) => (a.moved ? " (the page had redrawn it: found again by its role and name)" : "");

/** browser_open on a Linux computer: the page opened, then read back in words (a screenshot only when asked or needed). */
export async function openInWords(c: ToolContext, a: Record<string, any>): Promise<ToolOutput> {
  const url = String(a.url ?? "");
  if (computerKind() !== "linux") return shot(await screen.open(c.bot.id, c.user.id, url, a.new_tab === true), `Opened ${url}.`);
  const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  if (!/^https?:/i.test(target)) return { content: "Only http and https addresses can be opened.", isError: true };
  const r = await linuxScreen.browserOp(c.bot.id, c.user.id, ws(c), { op: "open", url: target, newTab: a.new_tab === true, after: true }, 60_000);
  if (r.error) throw new Error(r.error);
  noteReportedUrl(c.bot.id, r.url || target);
  return inWords(c, r, `Opened ${url}${r.newTab ? " in a new tab" : ""}${r.waited ? ` (loaded in ${r.waited} s)` : ""}.`, a.screenshot === true, clip(r.title || r.url || url, 80));
}

/** The upload's site: the page of the bot's current references. */
const hostOfUrl = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export const elementTools: BuiltinTool[] = [
  tool("element_snapshot", "List the interactive elements (links with their address, buttons, fields, lists, checkboxes…) of the page in front of your browser, each with a short reference, its role, its name, its state, and a hint for a control without a name; also the page's headings. Prefer this and the element_* tools over pixel coordinates when the browser is in front.", obj({ limit: int("At most this many elements (default 150, max 300)") }), {
    activity: "reading", label: "Listing the page's controls", outside: true,
    run: async (a, c) => {
      const snap = await screen.elements(c.bot.id, c.user.id, Math.min(300, Math.max(1, Number(a.limit) || 150)));
      return { content: rememberSnapshot(c.bot.id, snap), summary: `${snap.elements.length} · ${clip(snap.title || snap.url, 60)}` };
    },
  }),
  tool("element_click", "Click an element of the page by its reference. It is scrolled into view first, and refused (nothing done) when something covers it or the reference is stale. Answers with what changed on the page, in words (screenshot: true adds a picture). double: double-click.", obj({ ref: REF, double: { type: "boolean", description: "Double-click (default false)" }, screenshot: SHOT, confirm: { type: "boolean", description: "Only to confirm a delete click you were asked to check (same element)" } }, ["ref"]), {
    activity: "computer", label: "Clicking", outside: true,
    run: async (a, c) => {
      const check = deleteCheckAnswer(a); // DS-Bot item 10: a delete click is checked first, nothing clicked (deletecheck.ts)
      if (check) return check;
      const found = resolveRef(c.bot.id, a.ref);
      if ("error" in found) return { content: found.error, isError: true, summary: "no such element" };
      // As screen_click: a click that commits something was judged for this control on this site; if it changed since, nothing is clicked.
      const seen = seenTarget(a), committing = !!seen && !!committingKind(seen.label);
      if (seen && committing) {
        const live = await probe.element(c.bot.id, String(a.ref)).catch(() => null);
        const still = live ? seenOf(live) : null;
        if (!still || still.label !== seen.label || still.host !== seen.host) return { content: `The page changed since this click was checked (it was “${seen.label}” on ${seen.host || "?"}; now ${still ? `“${still.label}” on ${still.host || "?"}` : "nothing readable"}). Nothing was clicked. Take a new element_snapshot.`, isError: true, summary: "page changed" };
      }
      // …and checked once more by the helper on that same tab right before it clicks (`expect`), with what is really
      // under the point; an approved committing click is never "found again" by its name (screen-elements.ts check_node).
      const before = hostBeforeClick(c.bot.id); // L33
      const r = await act(c, { ...found.req, action: "click", double: a.double === true, ...(seen && committing ? { expect: { label: seen.label, host: seen.host } } : {}) });
      if (!r.ok) return notDone(c, r, "click");
      noteMoved(c.bot.id, a.ref, r.moved);
      return afterClick(c, before, await inWords(c, r, `${a.double === true ? "Double-clicked" : "Clicked"} ${found.element.role} “${clip(found.element.name, 80)}”${movedLine(r)}.`, a.screenshot === true, clip(found.element.name || found.element.role, 60)));
    },
  }),
  tool("element_type", "Type text into a field of the page by its reference: it is focused first, and what the field holds afterwards is read back (verified or not). clear: replace what is in it. submit: press Enter afterwards. Answers with what changed, in words.", obj({ ref: REF, text: str("Text to type"), clear: { type: "boolean", description: "Replace the field's content (default false)" }, submit: { type: "boolean", description: "Press Enter afterwards (default false)" }, screenshot: SHOT }, ["ref", "text"]), {
    activity: "computer", label: "Typing", outside: true,
    run: async (a, c) => {
      const found = resolveRef(c.bot.id, a.ref);
      if ("error" in found) return { content: found.error, isError: true, summary: "no such element" };
      const text = String(a.text ?? "");
      const r = await act(c, { ...found.req, action: "type", text, clear: a.clear === true, submit: a.submit === true });
      if (!r.ok) return notDone(c, r, "typing");
      noteMoved(c.bot.id, a.ref, r.moved);
      return inWords(c, r, `Typed ${text.length} characters into “${clip(found.element.name, 80)}”${movedLine(r)} ${typedWords(r.typed)}${a.submit === true ? ", then pressed Enter" : ""}.`, a.screenshot === true, `${clip(found.element.name, 40)} ${r.typed?.verified ? "✓" : r.typed?.verified === false ? "≠" : ""}`.trim());
    },
  }),
  tool("element_select", "Choose an option in a drop-down list (<select>) of the page by its reference, by the option's label or value.", obj({ ref: REF, option: str("The option's label (or value)"), screenshot: SHOT }, ["ref", "option"]), {
    activity: "computer", label: "Choosing in a list", outside: true,
    run: async (a, c) => {
      const found = resolveRef(c.bot.id, a.ref);
      if ("error" in found) return { content: found.error, isError: true, summary: "no such element" };
      const r = await act(c, { ...found.req, action: "select", value: String(a.option ?? "") });
      if (!r.ok) return notDone(c, r, "choice");
      noteMoved(c.bot.id, a.ref, r.moved);
      return inWords(c, r, `Chose “${clip(r.chosen ?? String(a.option), 80)}” in “${clip(found.element.name, 80)}”${r.verified === false ? " — NOT verified: the list shows something else now" : r.verified ? " — verified" : ""}.`, a.screenshot === true, clip(r.chosen ?? String(a.option), 60));
    },
  }),
  tool("element_fill", "Fill several fields of a form in one call, by reference: text fields get the text (replacing what was there), drop-down lists the option, checkboxes and switches true or false, a radio button true. Each field is read back (verified or not). It never clicks a button: send the form with element_click. A box whose words commit something (accept the terms, pay…) is left for element_click, which asks.",
    obj({ fields: { type: "array", description: "[{\"ref\": \"3f9a.4\", \"value\": \"Zoé\"}, {\"ref\": \"3f9a.7\", \"value\": true}] — at most 30", items: { type: "object", properties: { ref: { type: "string" }, value: { type: "string", description: "The text, the option, or \"true\" / \"false\" for a box" } }, required: ["ref", "value"] } }, screenshot: SHOT }, ["fields"]), {
    activity: "computer", label: "Filling a form", outside: true, detail: (a) => `${Array.isArray(a.fields) ? a.fields.length : 0}`,
    run: async (a, c) => {
      const list = (Array.isArray(a.fields) ? a.fields : []).slice(0, 30);
      if (!list.length) return { content: "Give at least one field: [{\"ref\": …, \"value\": …}].", isError: true };
      const lines: string[] = new Array(list.length).fill(""), send: Array<Record<string, unknown>> = [], index: number[] = [];
      let req: Omit<ElementRequest, "action"> | null = null;
      for (const [i, f] of list.entries()) {
        const found = resolveRef(c.bot.id, f?.ref);
        if ("error" in found) { lines[i] = `${i + 1}. ${clip(String(f?.ref ?? "?"), 20)}: ${found.error}`; continue; }
        if (/^(checkbox|switch|radio|menuitemcheckbox|menuitemradio)$/.test(found.element.role) && committingKind(found.element.name)) { lines[i] = `${i + 1}. ${found.element.role} “${clip(found.element.name, 60)}”: not ticked here — its words commit something, so use element_click on it (the user is asked).`; continue; }
        req ??= found.req;
        send.push({ node: found.element.node, role: found.element.role, name: found.element.name, value: f.value });
        index.push(i);
      }
      if (!send.length || !req) return { content: lines.filter(Boolean).join("\n") || "Nothing to fill.", isError: true, summary: "nothing filled" };
      const r = await linuxScreen.browserOp<ElementAnswer>(c.bot.id, c.user.id, ws(c), { op: "fill", target: req.target, loader: req.loader, fields: send, after: true }, 90_000);
      if (!r.ok) return notDone(c, r, "filling");
      const word = (f: FillResult | undefined, s: Record<string, unknown>) => {
        if (!f) return "not reached (stopped before)";
        if (!f.ok) return refusal(c.bot.id, f, "change");
        if (f.chosen !== undefined) return `chose “${clip(f.chosen, 60)}”${f.verified === false ? " — NOT verified" : " — verified"}`;
        if (f.checked !== undefined) return `${f.checked ? "ticked" : "unticked"}${f.verified ? " — verified" : " — NOT verified (the page did not keep it)"}`;
        return `typed ${String(s.value ?? "").length} characters ${typedWords(f.typed)}`;
      };
      send.forEach((s, k) => { const res = r.results?.[k]; if (res?.moved) noteMoved(c.bot.id, list[index[k]].ref, res.moved); lines[index[k]] = `${index[k] + 1}. ${s.role} “${clip(String(s.name), 60)}”: ${word(res, s)}`; });
      const ok = (r.results ?? []).filter((x) => x.ok && x.verified !== false && x.typed?.verified !== false).length;
      return inWords(c, r, `Filled ${ok} of ${list.length} field${list.length > 1 ? "s" : ""} (nothing was sent: element_click the form's button for that).\n${lines.join("\n")}`, a.screenshot === true, `${ok}/${list.length}`);
    },
  }),
  tool("element_hover", "Move the mouse over an element by its reference (to open a menu or show a tooltip) without clicking. Answers with what changed.", obj({ ref: REF, screenshot: SHOT }, ["ref"]), {
    activity: "computer", label: "Hovering", outside: true,
    run: async (a, c) => {
      const found = resolveRef(c.bot.id, a.ref);
      if ("error" in found) return { content: found.error, isError: true, summary: "no such element" };
      const r = await act(c, { ...found.req, action: "hover" });
      if (!r.ok) return notDone(c, r, "hover");
      return inWords(c, r, `The mouse is over “${clip(found.element.name, 80)}”${movedLine(r)}.`, a.screenshot === true, clip(found.element.name, 60));
    },
  }),
  tool("element_upload", "Put one of your files (from your files folder) into a file field of the page, by the reference of the field or of the button that opens the file picker. The user is asked first, every time: the file goes to that site once the form is sent.", obj({ ref: REF, file: str("Path of the file inside your files folder, e.g. reports/cv.pdf") }, ["ref", "file"]), {
    activity: "computer", label: "Attaching a file", outside: true, detail: (a) => String(a.file ?? ""),
    gate: (a, ctx) => {
      const host = hostOfUrl(snapshotUrl(ctx.botId)) || "?";
      return { key: `upload: ${host}`, strict: true, once: true, source: "Browser", title: "Allow {bot} to attach the file {file} on {host}?", reason: "attach the file {file} on {host}", vars: { file: clip(String(a.file ?? ""), 80), host }, note: "The file will be sent to {host} when the form is sent." };
    },
    run: async (a, c) => {
      const found = resolveRef(c.bot.id, a.ref);
      if ("error" in found) return { content: found.error, isError: true, summary: "no such element" };
      const file = String(a.file ?? "").replace(/^~?\/?(root\/)?files\//, "").replace(/^\/+/, "");
      if (!file || file.split("/").includes("..")) return { content: "Give the path of a file inside your files folder (no “..”).", isError: true };
      const r = await act(c, { ...found.req, action: "upload", path: file });
      if (!r.ok) return notDone(c, r, "attachment");
      return inWords(c, r, `Attached ${file}${r.verified ? " — verified: the field now holds it" : ` — NOT verified (the field holds: ${(r.uploaded ?? []).join(", ") || "nothing"})`}. Nothing is sent until the form is.`, false, clip(file, 60));
    },
  }),
  tool("browser_wait", "Wait (up to 30 s) until the page in front shows a text, no longer shows one (gone), is at an address containing some words, and/or has finished loading — instead of looking again and again. Then answers with what changed.", obj({ text: str("Wait until this text is on the page (not case-sensitive)"), gone: str("Wait until this text is no longer on the page (e.g. Loading…)"), url: str("Wait until the address contains this"), load: { type: "boolean", description: "Wait until the page has finished loading and the network is quiet" }, timeout: int("Seconds to wait at most (default 10, max 30)") }), {
    activity: "reading", label: "Waiting for the page", outside: true, detail: (a) => clip(String(a.text ?? a.gone ?? a.url ?? (a.load ? "load" : "")), 40),
    run: async (a, c) => {
      if (!a.text && !a.gone && !a.url && a.load !== true) return { content: "Say what to wait for: text, gone, url or load.", isError: true };
      const timeout = Math.max(1, Math.min(30, Number(a.timeout) || 10));
      const r = await linuxScreen.browserOp<ElementAnswer>(c.bot.id, c.user.id, ws(c), { op: "wait", text: a.text ?? "", gone: a.gone ?? "", url: a.url ?? "", load: a.load === true, timeout, after: true }, (timeout + 25) * 1000);
      if (r.dialog && !r.ok) return { content: dialogWords(r.dialog), isError: true, summary: "dialog open" };
      if (r.timeout) {
        const still = [a.text && !r.textSeen ? `the text “${clip(String(a.text), 60)}” is not there` : "", a.gone && r.goneSeen ? `“${clip(String(a.gone), 60)}” is still there` : "", a.url ? `the address is ${clip(r.url ?? "", 120)}` : "", a.load ? `the page is “${r.state ?? "?"}”` : ""].filter(Boolean).join("; ");
        return { content: `Waited ${r.waited ?? timeout} s: still not there (${still || "condition not met"}). Look at the page (page_read or screen_view) before deciding; waiting longer rarely helps.`, isError: true, summary: "not yet" };
      }
      if (!r.ok) return { content: r.error ?? "The page could not be watched.", isError: true };
      return inWords(c, r, `Waited ${r.waited} s: done.`, false, `${r.waited} s`);
    },
  }),
  tool("browser_console", "Read the console of the page in front of your browser (its last 3 pages): JavaScript errors and warnings, or every message with all: true. Useful to see why a page you built or use does not work. Read-only.", obj({ all: { type: "boolean", description: "Every message, not only errors and warnings (default false)" }, limit: int("At most this many lines, newest last (default 40, max 200)") }), {
    activity: "reading", label: "Reading the page's console", outside: true, parallel: true,
    run: async (a, c) => {
      const r = await linuxScreen.browserOp<{ error?: string; dialog?: unknown; messages?: ConsoleMessage[]; watched?: boolean; url?: string; title?: string }>(c.bot.id, c.user.id, ws(c), { op: "console" });
      if (r.error) return { content: r.error, isError: true };
      const { lines, errors, total } = consoleLines(r.messages ?? [], a.all === true, Math.max(1, Math.min(200, Number(a.limit) || 40)));
      const head = `Console of “${clip(r.title || "(untitled)", 80)}” — ${clip(r.url ?? "", 160)} (last 3 pages): ${total} message${total === 1 ? "" : "s"}, ${errors} error${errors === 1 ? "" : "s"}.`;
      const watched = r.watched === false ? "\nThis tab was opened before the console was watched: reload it (browser_open its address) to see its messages." : "";
      return { content: `${head}${watched}\n${lines.length ? maskSecrets(lines.join("\n"), "(masked)").text : a.all === true ? "(nothing written to the console)" : "(no error or warning; all: true shows every message)"}`, summary: `${errors} error${errors === 1 ? "" : "s"}` };
    },
  }),
  tool("browser_network", "List the requests of the page in front of your browser (its last 3 pages): method, status, kind, address, size — to see what failed or find the data a page loads. request: one request's number for its headers (secret values masked) and, for text, the start of its answer. Read-only.", obj({ filter: str("Only requests whose address contains this"), failed: { type: "boolean", description: "Only failed requests (status 400 or more, or no answer)" }, request: int("A request's number from the list, for its details"), limit: int("At most this many requests, newest last (default 40, max 200)") }), {
    activity: "reading", label: "Reading the page's requests", outside: true, parallel: true,
    run: async (a, c) => {
      const r = await linuxScreen.browserOp<{ error?: string; requests?: NetRequest[]; watched?: boolean; url?: string; title?: string }>(c.bot.id, c.user.id, ws(c), { op: "network" });
      if (r.error) return { content: r.error, isError: true };
      const all = r.requests ?? [];
      if (a.request !== undefined) {
        const q = all[Number(a.request) - 1];
        if (!q) return { content: `There is no request #${a.request} (${all.length} listed).`, isError: true };
        const head = (h: Record<string, string>) => Object.entries(maskHeaders(h)).slice(0, 40).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  (none)";
        let body = "";
        if (q.done && !q.failed && /json|text|xml|javascript|csv/i.test(q.mime ?? "")) {
          const b = await linuxScreen.browserOp<{ body?: string; base64Encoded?: boolean; error?: string }>(c.bot.id, c.user.id, ws(c), { op: "body", id: q.id }).catch(() => ({ error: "unreadable" }) as { body?: string; base64Encoded?: boolean; error?: string });
          body = b.body && !b.base64Encoded ? `\nAnswer (start, secrets masked):\n${clip(maskSecrets(b.body, "(masked)").text, 3000)}` : `\nAnswer: ${b.error ? `not available (${clip(b.error, 80)})` : "not text"}.`;
        }
        return { content: `${requestLine(q, Number(a.request))}\nAddress: ${clip(maskUrl(q.url), 600)}\nRequest headers (secret values masked):\n${head(q.reqHeaders ?? {})}\nAnswer headers (secret values masked):\n${head(q.resHeaders ?? {})}${body}`, summary: `#${a.request}` };
      }
      const want = String(a.filter ?? "").toLowerCase();
      const picked = all.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => (!want || q.url.toLowerCase().includes(want)) && (a.failed !== true || !!q.failed || (q.status ?? 0) >= 400));
      const limit = Math.max(1, Math.min(200, Number(a.limit) || 40));
      const failed = all.filter((q) => q.failed || (q.status ?? 0) >= 400).length;
      const watched = r.watched === false ? "\nThis tab was opened before its requests were watched: reload it (browser_open its address) to see them." : "";
      return { content: `Requests of “${clip(r.title || "(untitled)", 80)}” — ${clip(r.url ?? "", 160)} (last 3 pages): ${all.length}, ${failed} failed.${watched}\n${picked.slice(-limit).map(({ q, n }) => requestLine(q, n)).join("\n") || "(none)"}${picked.length > limit ? `\n(${picked.length - limit} older ones not shown)` : ""}\nGive request: <number> for one request's headers and answer.`, summary: `${all.length} · ${failed} failed` };
    },
  }),
];

