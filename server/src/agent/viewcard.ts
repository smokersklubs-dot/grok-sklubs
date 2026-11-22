/**
 * DS-Bot item 8 (docs/audits/AUDIT-DS-BOT.md #5, #6): show_view — key figures, a table, a bar or line chart, a progress
 * bar, a short text and a small form, drawn inside the chat. Idea from DS-Bot's show_view tool and its widget cell
 * (ds-bot/src/host/tools.js, ds-bot/src/client/widget-cell.js, Apache-2.0); their schema and renderer live in an outside
 * npm package (deep-view) that is not in that repository, so this schema, its checks and the renderer are our own code.
 *
 * Safety: the model sends data, never markup. Every block is checked here (kinds, sizes, numbers finite, ids simple)
 * and anything else is refused with a reason the bot can fix; strings are plain text the app draws as text (React
 * escapes them), there is no HTML block, no image or link from an outside address, no formula evaluated. A form's answer
 * comes back as the user's own next message (POST /bots/:id/cards/:seq/view, viewroutes.ts), checked against the form's
 * fields. Every card carries a plain-text fallback for the phone app and the chat services.
 */
import { clip, rows, type BotRecord } from "../store.js";
import type { ViewBlock, ViewCard, ViewField } from "../viewtypes.js";
import { VIEW_LIMITS as L } from "../viewtypes.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

type Fail = { error: string };
const s = (v: unknown, max: number) => clip(String(v ?? "").replace(/\s+/g, " ").trim(), max);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

function block(raw: unknown, i: number): ViewBlock | Fail {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const at = `Block ${i + 1}`;
  switch (b.kind) {
    case "text": {
      const text = clip(String(b.text ?? "").trim(), L.text);
      return text ? { kind: "text", text } : { error: `${at} (text): give the text.` };
    }
    case "stats": {
      const items = arr(b.items).slice(0, L.stats).map((x) => { const o = (x ?? {}) as Record<string, unknown>; const hint = s(o.hint, L.hint); return { label: s(o.label, L.label), value: s(o.value, L.value), ...(hint ? { hint } : {}) }; }).filter((x) => x.label && x.value);
      return items.length ? { kind: "stats", items } : { error: `${at} (stats): give 1 to ${L.stats} items, each with a label and a value.` };
    }
    case "table": {
      const columns = arr(b.columns).slice(0, L.columns).map((c) => s(c, L.label)).filter(Boolean);
      if (!columns.length) return { error: `${at} (table): give 1 to ${L.columns} column names.` };
      const all = arr(b.rows);
      const tableRows = all.slice(0, L.rows).map((r) => { const cells = arr(r).slice(0, columns.length).map((c) => s(c, L.cell)); while (cells.length < columns.length) cells.push(""); return cells; });
      if (!tableRows.length) return { error: `${at} (table): give at least one row (a list of cells).` };
      return { kind: "table", columns, rows: tableRows };
    }
    case "chart": {
      const chart = b.chart === "line" ? "line" : "bar";
      const labels = arr(b.labels).slice(0, L.labels).map((x) => s(x, L.label));
      if (labels.length < 1) return { error: `${at} (chart): give 1 to ${L.labels} labels (the x axis).` };
      const series: { name: string; values: number[] }[] = [];
      for (const raw2 of arr(b.series).slice(0, L.series)) {
        const o = (raw2 ?? {}) as Record<string, unknown>;
        const values = arr(o.values).slice(0, labels.length).map(num);
        if (values.length !== labels.length || values.some((v) => v === null)) return { error: `${at} (chart): each series needs one finite number per label (${labels.length}).` };
        series.push({ name: s(o.name, L.label) || `Series ${series.length + 1}`, values: values as number[] });
      }
      if (!series.length) return { error: `${at} (chart): give 1 to ${L.series} series.` };
      const unit = s(b.unit, 12);
      return { kind: "chart", chart, labels, series, ...(unit ? { unit } : {}) };
    }
    case "progress": {
      const value = num(b.value), max = num(b.max ?? 100);
      if (value === null || max === null || max <= 0) return { error: `${at} (progress): give a value and a max above 0.` };
      return { kind: "progress", label: s(b.label, L.label), value: Math.min(Math.max(0, value), max), max };
    }
    case "form": {
      const fields: ViewField[] = [];
      const ids = new Set<string>();
      for (const raw2 of arr(b.fields).slice(0, L.fields)) {
        const o = (raw2 ?? {}) as Record<string, unknown>;
        const id = String(o.id ?? "").trim();
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(id) || ids.has(id)) return { error: `${at} (form): each field needs its own id (lower case letters, digits, _).` };
        ids.add(id);
        const type = o.type === "number" || o.type === "choice" || o.type === "checkbox" ? o.type : "text";
        const options = type === "choice" ? arr(o.options).slice(0, L.options).map((x) => s(x, L.label)).filter(Boolean) : undefined;
        if (type === "choice" && (!options || options.length < 2)) return { error: `${at} (form): the choice field “${id}” needs 2 to ${L.options} options.` };
        const placeholder = s(o.placeholder, L.label);
        fields.push({ id, label: s(o.label, L.label) || id, type, ...(options ? { options } : {}), ...(o.required === true ? { required: true } : {}), ...(placeholder ? { placeholder } : {}) });
      }
      return { kind: "form", fields, submit: s(b.submit, 40) || "Send" };
    }
    default:
      return { error: `${at}: kind must be text, stats, table, chart, progress or form (no HTML or script).` };
  }
}

/** Checks a show_view call. Exactly what the app may draw, or why not. */
export function checkView(a: Record<string, unknown>): { title: string; blocks: ViewBlock[]; interactive: boolean } | Fail {
  const title = s(a.title, L.title);
  if (!title) return { error: "Give the view a short title." };
  const list = arr(a.blocks);
  if (!list.length || list.length > L.blocks) return { error: `Give 1 to ${L.blocks} blocks.` };
  const blocks: ViewBlock[] = [];
  for (const [i, raw] of list.entries()) { const b = block(raw, i); if ("error" in b) return b; blocks.push(b); }
  const forms = blocks.filter((b) => b.kind === "form").length;
  if (forms > 1) return { error: "A view holds at most one form." };
  return { title, blocks, interactive: forms === 1 };
}

const numText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

/** The same view in plain text (phone app, Telegram / Slack / Discord, the bot's own record). */
export function fallbackText(title: string, blocks: ViewBlock[], fr: boolean): string {
  const out: string[] = [`📊 ${title}`];
  for (const b of blocks) {
    if (b.kind === "text") out.push(b.text);
    else if (b.kind === "stats") out.push(b.items.map((x) => `• ${x.label} : ${x.value}${x.hint ? ` (${x.hint})` : ""}`).join("\n"));
    else if (b.kind === "table") out.push([b.columns.join(" | "), ...b.rows.slice(0, 20).map((r) => r.join(" | ")), ...(b.rows.length > 20 ? [fr ? `… ${b.rows.length - 20} lignes de plus dans l'appli` : `… ${b.rows.length - 20} more rows in the app`] : [])].join("\n"));
    else if (b.kind === "chart") out.push(b.series.map((x) => `${x.name} : ${b.labels.map((l, i) => `${l} ${numText(x.values[i])}${b.unit ?? ""}`).join(", ")}`).join("\n"));
    else if (b.kind === "progress") out.push(`${b.label ? `${b.label} : ` : ""}${numText(b.value)} / ${numText(b.max)} (${Math.round((b.value / b.max) * 100)} %)`);
    else if (b.kind === "form") out.push(fr ? `📝 Formulaire (${b.fields.map((f) => f.label).join(", ") || "confirmation"}) : réponds dans l'appli, ou écris ta réponse.` : `📝 Form (${b.fields.map((f) => f.label).join(", ") || "confirmation"}): answer in the app, or write your answer.`);
  }
  return out.join("\n\n").slice(0, 6000);
}

/** A form's answer, checked against its fields: the text that goes back to the bot, or why it is refused. */
export function formAnswer(card: ViewCard, raw: unknown): { text: string } | Fail {
  const form = card.blocks.find((b): b is Extract<ViewBlock, { kind: "form" }> => b.kind === "form");
  if (!form) return { error: "This view has no form." };
  const values = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines: string[] = [];
  for (const f of form.fields) {
    const v = values[f.id];
    let shown: string;
    if (f.type === "checkbox") shown = v === true ? "yes" : "no";
    else if (f.type === "number") {
      if (v === undefined || v === null || v === "") { if (f.required) return { error: `“${f.label}” is needed.` }; shown = ""; }
      else { const n = num(v); if (n === null) return { error: `“${f.label}” must be a number.` }; shown = numText(n); }
    } else if (f.type === "choice") {
      const c = String(v ?? "");
      if (!c) { if (f.required) return { error: `“${f.label}” is needed.` }; shown = ""; }
      else if (!f.options?.includes(c)) return { error: `“${f.label}”: pick one of the options.` };
      else shown = c;
    } else {
      shown = clip(String(v ?? "").trim(), L.answer);
      if (!shown && f.required) return { error: `“${f.label}” is needed.` };
    }
    lines.push(`${f.label}: ${shown || "—"}`);
  }
  return { text: lines.length ? lines.join("\n") : form.submit };
}

const BLOCK_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["text", "stats", "table", "chart", "progress", "form"] },
    text: { type: "string", description: "text: plain text (no HTML)" },
    items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, hint: { type: "string" } } }, description: "stats: key figures" },
    columns: { type: "array", items: { type: "string" }, description: "table: column names" },
    rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "table: rows of cells" },
    chart: { type: "string", enum: ["bar", "line"] },
    labels: { type: "array", items: { type: "string" }, description: "chart: the x axis labels" },
    series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } }, description: "chart: 1 to 4 series, one number per label" },
    unit: { type: "string", description: "chart: unit shown after numbers (€, %, h…)" },
    label: { type: "string" }, value: { type: "number" }, max: { type: "number" },
    fields: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: ["text", "number", "choice", "checkbox"] }, options: { type: "array", items: { type: "string" } }, required: { type: "boolean" }, placeholder: { type: "string" } } }, description: "form: up to 8 fields (none = a simple confirmation button)" },
    submit: { type: "string", description: "form: the button's words" },
  },
  required: ["kind"],
};

/** Posts a checked view card in the conversation (main chat or thread). */
export function postView(bot: BotRecord, card: ViewCard, thread?: number) {
  return rows.append(bot, { kind: "card", card }, thread || 0);
}

export const viewTools: BuiltinTool[] = [{
  spec: {
    name: "show_view",
    description: `Show data inside the chat, drawn by the app: key figures (stats), a table, a bar or line chart, a progress bar, a short text, or a small form (up to ${L.fields} fields: text, number, choice, checkbox; no fields = a confirmation button). Up to ${L.blocks} blocks, at most one form. Plain data only: no HTML, script, image or link. Without a form it just shows; with a form it ends your turn and the user's answer arrives as their next message.`,
    inputSchema: { type: "object", properties: { title: { type: "string", description: "Short title of the view" }, blocks: { type: "array", items: BLOCK_SCHEMA, description: "The blocks, top to bottom" } }, required: ["title", "blocks"] },
  },
  activity: "waiting", label: "Showing a view",
  async run(a: Record<string, any>, c: ToolContext): Promise<ToolOutput> {
    const checked = checkView(a);
    if ("error" in checked) return { content: `${checked.error} Nothing was shown.`, isError: true, summary: "not shown" };
    const fr = c.user.locale === "fr";
    const card: ViewCard = { type: "view", title: checked.title, blocks: checked.blocks, fallback: fallbackText(checked.title, checked.blocks, fr), status: checked.interactive ? "pending" : "shown" };
    postView(c.bot, card, c.thread);
    if (!checked.interactive) return { content: "The view is on screen. Do not repeat its numbers in your reply; say only what they mean, in a sentence or two.", summary: clip(checked.title, 60) };
    return { content: "The form is in front of the user. Stop here: their answer arrives as their next message.", summary: clip(checked.title, 60), endTurn: true };
  },
}];
