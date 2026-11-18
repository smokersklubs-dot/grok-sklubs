import { emit } from "../bus.js";
import { config } from "../config.js";
import { subscriptionEnginesFor } from "../hosted.js";
import { isValidTimezone } from "../cron.js";
import { tr } from "../i18n.js";
import { modelAvailable, type ToolSpec } from "../llm/index.js";
import { fetchProblem, guardedFetch } from "../net.js";
import { ACCESSORIES, AVATAR_COLORS, AVATAR_SHAPES, CHARACTER_TYPES, EYE_STYLES, IDLE_MOTIONS, TOOL_GROUPS, type ToolGroup } from "../shared.js";
import { audit, bots, clip, publicBot, revisions, rows, settings, skills, type BotRecord } from "../store.js";
import { formatXResult, xSearch, xSearchProvider } from "../xsearch.js";
import { engineModelsFor, isEngineRef } from "./engine.js";
import type { BuiltinTool, ToolContext } from "./tools.js";

/**
 * Wave 4 tools: progress lines during long work, the shared profile, skills imported from a public address, a bot that
 * creates another bot or updates its own settings, and search on X. Kept apart from tools.ts (which imports these
 * lists) so neither module needs the other while it loads.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool => ({ spec: { name, description, inputSchema: schema }, ...rest });
const hostOf = (url: unknown) => { try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";

// ── Progress lines ──────────────────────────────────────────────────────────
const lastProgress = new Map<string, number>();

export const progressTools: BuiltinTool[] = [
  tool("progress_update", "During long work with many steps, post a short interim update to the user (one line: what is done, what comes next). It appears as a light line in the chat and is not your final answer: keep working after it. At most one every few steps; never for short tasks.",
    obj({ text: str("One short line, e.g. \"Read 12 of 30 pages — the pricing ones next.\"") }, ["text"]), {
    activity: "writing", label: "Posting an update",
    run: async (a, c) => {
      const line = clip(String(a.text ?? "").replace(/\s+/g, " ").trim(), 240);
      if (!line) return { content: "Write the update.", isError: true };
      const last = lastProgress.get(c.bot.id) ?? 0;
      if (Date.now() - last < config.progressGapMs) return { content: "Not posted: your last update was moments ago. Keep working and post the next one later.", summary: "too soon" };
      lastProgress.set(c.bot.id, Date.now());
      rows.append(c.bot, { kind: "event", event: "progress", text: line });
      return { content: "Posted. Keep working — this was not your final answer.", summary: line };
    },
  }),
];

// ── Shared profile ──────────────────────────────────────────────────────────
export const PROFILE_LIMITS = { name: 80, timezone: 60, company: 120, preferences: 2000 } as const;
/** Checks profile fields from a form or a tool; returns the clean fields, or an error message. */
export function cleanProfile(raw: Record<string, unknown>): { fields: Partial<Record<keyof typeof PROFILE_LIMITS, string>> } | { error: string } {
  const fields: Partial<Record<keyof typeof PROFILE_LIMITS, string>> = {};
  for (const key of Object.keys(PROFILE_LIMITS) as (keyof typeof PROFILE_LIMITS)[]) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { error: `${key} must be text.` };
    fields[key] = v.trim().slice(0, PROFILE_LIMITS[key]);
  }
  if (fields.timezone && !isValidTimezone(fields.timezone)) return { error: `Unknown timezone "${fields.timezone}". Use an IANA name such as Europe/Paris.` };
  return { fields };
}

export const profileTools: BuiltinTool[] = [
  tool("profile_update", "Update the user's shared profile, which every bot on the team knows: their name, timezone (IANA, e.g. Europe/Paris), company and lasting preferences (how they like to work, be addressed, receive answers). Only what the user told you about themselves; pass only the fields that change. `preferences` replaces the whole text, so keep what is still true.",
    obj({ name: str("How the user wants to be called"), timezone: str("IANA timezone, e.g. Europe/Paris"), company: str("Their company or organisation"), preferences: str("Their lasting preferences, a few short lines") }), {
    activity: "remembering", label: "Updating your profile", group: "memory", audited: true,
    // Facts every bot will read: after outside content a page could try to plant them, so it asks every time then.
    gate: (_a, ctx) => (ctx.tainted ? { key: "profile_update", strict: true, title: "{bot} has read outside content. Allow it to update your shared profile?", reason: "update your shared profile", source: "Outside content", vars: {} } : null),
    run: async (a, c) => {
      const r = cleanProfile(a);
      if ("error" in r) return { content: r.error, isError: true };
      if (!Object.keys(r.fields).length) return { content: "Pass at least one field to change.", isError: true };
      settings.saveProfile(c.user.id, r.fields);
      emit(c.user.id, { type: "profile" });
      return { content: "Profile updated. Every bot on the team will know it from its next turn.", summary: Object.keys(r.fields).join(", ") };
    },
  }),
];

// ── Skills from a public address ────────────────────────────────────────────
/** A markdown skill file: optional front matter (`name:`, `description:`), else the first heading names it. */
export function parseSkillMarkdown(md: string): { name: string; description: string; body: string } {
  let text = md.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  let name = "", description = "";
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = /^(name|description)\s*:\s*(.*)$/i.exec(line.trim());
      if (m) { const v = m[2].trim().replace(/^["']|["']$/g, ""); if (m[1].toLowerCase() === "name") name = v; else description = v; }
    }
    text = text.slice(fm[0].length);
  }
  if (!name) { const h = /^#\s+(.+)$/m.exec(text); if (h) name = h[1].trim(); }
  return { name: clip(name, 80), description: clip(description, 300), body: text.trim() };
}

/** Downloads a markdown skill (public addresses only, 200 kB at most). Throws a readable error. */
export async function fetchSkillMarkdown(url: string, signal: AbortSignal): Promise<{ name: string; description: string; body: string }> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("That is not a full address."); }
  if (u.protocol !== "https:" && !(allowHttp() && u.protocol === "http:")) throw new Error("Skills are imported over https only.");
  let res: Response;
  try { res = await guardedFetch(u.toString(), { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "follow", headers: { accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" } }); }
  catch (err) { throw new Error(`Could not fetch it: ${fetchProblem(err) ?? (err as Error).message}`); }
  if (!res.ok) throw new Error(`Could not fetch it (status ${res.status}).`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type && !/text\/|markdown|octet-stream/.test(type)) { await res.body?.cancel().catch(() => {}); throw new Error(`That is not a text file (${type}).`); }
  if (Number(res.headers.get("content-length") ?? 0) > 200_000) { await res.body?.cancel().catch(() => {}); throw new Error("That file is too large (200 kB at most)."); }
  const md = await res.text();
  if (md.length > 200_000) throw new Error("That file is too large (200 kB at most).");
  if (/^\s*<(!doctype|html)/i.test(md)) throw new Error("That address gives a web page, not a markdown file. Use the file's raw address.");
  const parsed = parseSkillMarkdown(md);
  if (!parsed.body) throw new Error("That file is empty.");
  return parsed;
}

/** Saves an imported skill on a bot (replacing one of the same name). */
export function saveImportedSkill(bot: BotRecord, s: { name: string; description: string; body: string }, fallbackName: string, shared = false) {
  const name = clip((s.name || fallbackName).trim(), 80) || "Imported skill";
  const existing = skills.list(bot.id).find((k) => k.name.toLowerCase() === name.toLowerCase());
  const body = s.body.slice(0, 20_000);
  const saved = existing ? skills.update(existing.id, { name, description: s.description, body, shared }) : skills.create(bot.id, name, s.description, body, shared);
  emit(bot.userId, { type: "memories", botId: bot.id });
  return { skill: saved, replaced: !!existing };
}

export const skillImportTools: BuiltinTool[] = [
  tool("skill_import", "Import a skill from a markdown file at a public address (for example a raw file on GitHub): its steps become one of your skills. The user is asked first, every time, because the file's words will guide you later. Front matter `name:` / `description:` is used when present, else the first heading.",
    obj({ url: str("https address of the .md file (its raw address)"), name: str("Name to save it under, if the file has none"), shared: { type: "boolean", description: "Share it with every bot of the user" } }, ["url"]), {
    activity: "reading", label: "Importing a skill", group: "memory", audited: true, detail: (a) => hostOf(a.url),
    gate: (a) => ({
      key: `skill_import: ${hostOf(a.url) || "?"}`, strict: true,
      title: "Allow {bot} to import a skill from {host}?", reason: "import a skill from {host}", source: "Skill from the web", vars: { host: hostOf(a.url) || "?" },
      note: "Its steps come from this file and will guide the bot later: only allow it if you trust where it comes from.",
    }),
    run: async (a, c) => {
      let parsed;
      try { parsed = await fetchSkillMarkdown(String(a.url), c.signal); } catch (err) { return { content: (err as Error).message, isError: true, summary: "not imported" }; }
      const { skill, replaced } = saveImportedSkill(c.bot, parsed, String(a.name ?? ""), a.shared === true);
      audit(c.user.id, "tool", `${c.bot.name}: skill imported from ${hostOf(a.url)} — ${skill.name}`, c.bot.id);
      return { content: `${replaced ? "Replaced" : "Imported"} the skill "${skill.name}" (${skill.body.length} characters)${skill.shared ? ", shared with the team" : ""}. Read it with skill_read before following it.`, summary: skill.name };
    },
  }),
];

// ── A bot that creates bots, or updates its own settings ───────────────────
const pick = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);
/** The look fields a bot may set (on a new bot or itself): its shape and colour, and its character's style. */
function lookPatch(raw: unknown): Record<string, unknown> {
  const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const shape = pick(l.shape, AVATAR_SHAPES); if (shape) out.shape = shape;
  const color = pick(l.color, AVATAR_COLORS); if (color) out.color = color;
  const character: Record<string, unknown> = {};
  const type = pick(l.type ?? l.character_type, CHARACTER_TYPES); if (type) character.type = type;
  const eyes = pick(l.eyes, EYE_STYLES); if (eyes) character.eyes = eyes;
  const accessory = pick(l.accessory, ACCESSORIES); if (accessory) character.accessory = accessory;
  const idle = pick(l.idle, IDLE_MOTIONS); if (idle) character.idle = idle;
  if (typeof l.custom_color === "string" && /^#[0-9a-fA-F]{6}$/.test(l.custom_color)) character.customColor = l.custom_color.toLowerCase();
  if (Object.keys(character).length) out.character = character;
  return out;
}
const LOOK_SCHEMA = {
  type: "object", description: "Optional look",
  properties: {
    shape: { type: "string", enum: [...AVATAR_SHAPES] }, color: { type: "string", enum: [...AVATAR_COLORS] },
    character_type: { type: "string", enum: [...CHARACTER_TYPES] }, eyes: { type: "string", enum: [...EYE_STYLES] },
    accessory: { type: "string", enum: [...ACCESSORIES] }, idle: { type: "string", enum: [...IDLE_MOTIONS] },
    custom_color: { type: "string", description: "#RRGGBB" },
  },
};

/** Model references a bot may give a new bot: "" (the server's default), an API model set up here, or a subscription choice offered here. */
async function modelAllowed(ref: string, userId: string): Promise<boolean> {
  if (!ref) return true;
  if (isEngineRef(ref)) return subscriptionEnginesFor(userId) && (await engineModelsFor(userId)).some((m) => m.ref === ref);
  return modelAvailable(ref, userId);
}

/** What self_update would change, compared with the bot's current settings. */
export function selfPatch(bot: BotRecord, a: Record<string, unknown>): { patch: Record<string, unknown>; turnsOn: ToolGroup[]; error?: string } {
  const patch: Record<string, unknown> = {};
  if (a.instructions !== undefined) {
    if (typeof a.instructions !== "string") return { patch, turnsOn: [], error: "instructions must be text." };
    patch.instructions = a.instructions.slice(0, 8000);
  }
  Object.assign(patch, lookPatch(a.look));
  const turnsOn: ToolGroup[] = [];
  if (a.tools && typeof a.tools === "object") {
    const disabled = new Set<ToolGroup>(bot.disabledTools);
    for (const [g, on] of Object.entries(a.tools as Record<string, unknown>)) {
      if (!(TOOL_GROUPS as readonly string[]).includes(g) || typeof on !== "boolean") continue;
      const group = g as ToolGroup;
      if (on && disabled.has(group)) { disabled.delete(group); turnsOn.push(group); }
      if (!on) disabled.add(group);
    }
    if (disabled.size !== bot.disabledTools.length || turnsOn.length) patch.disabledTools = [...disabled];
  }
  return { patch, turnsOn };
}

/** The settings self_update can touch, as they are now (kept on the revision so the user can undo it). */
export const selfSnapshot = (b: BotRecord) => ({ instructions: b.instructions, shape: b.shape, color: b.color, character: b.character, disabledTools: b.disabledTools });

export const botTools: BuiltinTool[] = [
  tool("bot_create", "Create a new bot on the user's team, with its own name, role, standing instructions, look and model. Only when the user asked for a new teammate (or clearly agreed). The user is asked first, and only a few bots can be created this way each day. The new bot starts careful (it asks before acting).",
    obj({
      name: str("Its name (unique on the team)"), role: str("Its role in a few words, e.g. \"SEO analyst\""),
      instructions: str("Its standing instructions: what it does, how, for whom"),
      look: LOOK_SCHEMA, model: str("An optional model from Settings. Omit to use your own model."),
    }, ["name", "role", "instructions"]), {
    activity: "messaging", label: "Creating a bot", group: "team", audited: true, detail: (a) => String(a.name ?? ""),
    gate: (a, ctx) => ({
      key: "bot_create", strict: ctx.tainted,
      title: ctx.tainted ? "{bot} has read outside content. Allow it to create a new bot, {name}?" : "Allow {bot} to create a new bot, {name}?",
      reason: "create a bot", source: "Team", vars: { name: clip(String(a.name ?? "").trim(), 60) || "?", role: clip(String(a.role ?? ""), 80), model: String(a.model ?? "").trim() || bots.byId(ctx.botId)?.model || "default", n: String(config.botCreatePerDay) },
      note: "Role: {role} · Model: {model}. A bot can create at most {n} bots a day; you can delete it at any time.",
    }),
    run: async (a, c) => {
      if (c.bot.parentId) return { content: "Helpers cannot create bots.", isError: true };
      const name = clip(String(a.name ?? "").trim(), 60);
      if (!name) return { content: "Give the new bot a name.", isError: true };
      if (bots.byName(c.user.id, name)) return { content: `A bot called "${name}" already exists. Pick another name.`, isError: true };
      const used = bots.createdByBotsSince(c.user.id, Date.now() - 86_400_000);
      if (used >= config.botCreatePerDay) return { content: `Not created: bots already created ${used} bots in the last 24 hours (the limit is ${config.botCreatePerDay}). Tell the user they can create one in the sidebar.`, isError: true };
      const model = String(a.model ?? "").trim();
      if (!await modelAllowed(model, c.user.id)) return { content: `"${model}" is not a model set up for this account. Leave model empty to use your own model.`, isError: true };
      const look = lookPatch(a.look);
      const created = bots.create(c.user.id, {
        name, label: clip(String(a.role ?? "").trim(), 60), instructions: String(a.instructions ?? "").slice(0, 8000), model: model || undefined,
        shape: look.shape as BotRecord["shape"] | undefined, color: look.color as BotRecord["color"] | undefined,
        character: look.character as BotRecord["character"] | undefined, createdBy: c.bot.id,
      });
      const loc = c.user.locale;
      rows.append(created, { kind: "event", event: "bot", text: tr(loc, "{bot} created this bot.", { bot: c.bot.name }) }, 0);
      rows.append(c.bot, { kind: "event", event: "bot", text: tr(loc, "{bot} created a new bot: {name} ({role}).", { bot: c.bot.name, name: created.name, role: created.label || "—" }) });
      audit(c.user.id, "account", `${c.bot.name}: created the bot ${created.name}`, c.bot.id);
      emit(c.user.id, { type: "roster" });
      emit(c.user.id, { type: "bot", bot: publicBot(created) });
      return { content: `Created ${created.name} (${created.label || "no role"}). It is on the team now: talk to it with bot_message.`, summary: created.name };
    },
  }),
  tool("self_update", "Change your own settings: your standing instructions, your look, or switch whole families of your tools on or off. Use it when the user asks you to change how you work or look. Your autonomy, model and name stay as the user set them. The user can undo the change in one click; switching a family of tools back on that the user switched off asks them first.",
    obj({
      instructions: str("Your new standing instructions, in full (they replace the current ones)"),
      look: LOOK_SCHEMA,
      tools: { type: "object", description: `Tool families to switch on (true) or off (false): ${TOOL_GROUPS.join(", ")}`, additionalProperties: { type: "boolean" } },
    }), {
    activity: "saving", label: "Updating my settings", audited: true,
    gate: (a, ctx) => {
      const self = bots.byId(ctx.botId);
      if (!self) return null;
      const { turnsOn } = selfPatch(self, a);
      if (turnsOn.length) return { key: "self_update: tools", strict: true, title: "Allow {bot} to switch these tools back on: {groups}?", reason: "switch tools back on", source: "Its settings", vars: { groups: turnsOn.join(", ") } };
      if (ctx.tainted) return { key: "self_update", strict: true, title: "{bot} has read outside content. Allow it to change its own settings?", reason: "change its own settings", source: "Outside content", vars: {} as Record<string, string> };
      return null;
    },
    run: async (a, c) => {
      const self = bots.byId(c.bot.id)!;
      const { patch, error } = selfPatch(self, a);
      if (error) return { content: error, isError: true };
      if (!Object.keys(patch).length) return { content: "Nothing to change: pass instructions, look or tools.", isError: true };
      const before = selfSnapshot(self);
      bots.patch(self.id, patch);
      const now = bots.byId(self.id)!;
      const rev = revisions.create(self.id, before, selfSnapshot(now));
      const loc = c.user.locale;
      const what = [patch.instructions !== undefined ? tr(loc, "instructions") : "", patch.shape || patch.color || patch.character ? tr(loc, "look") : "", patch.disabledTools ? tr(loc, "tools") : ""].filter(Boolean).join(", ");
      rows.append(c.bot, { kind: "event", event: "selfupdate", text: tr(loc, "{bot} changed its own settings: {what}.", { bot: c.bot.name, what }), undo: { revisionId: rev.id, status: "available" } });
      audit(c.user.id, "account", `${c.bot.name}: changed its own settings (${what})`, c.bot.id);
      bots.announce(now);
      return { content: `Updated (${what}). The change applies from your next turn; the user can undo it.`, summary: what };
    },
  }),
];

/** Puts back what a self_update changed. False when there is nothing to undo. */
export function undoRevision(bot: BotRecord, revisionId: string): boolean {
  const rev = revisions.byId(revisionId);
  if (!rev || rev.botId !== bot.id || rev.undoneAt) return false;
  bots.patch(bot.id, rev.before);
  revisions.markUndone(rev.id);
  audit(bot.userId, "account", `${bot.name}: its own settings change was undone`, bot.id);
  bots.announce(bots.byId(bot.id));
  return true;
}

// ── Search on X ─────────────────────────────────────────────────────────────
export const xTools: BuiltinTool[] = [
  tool("x_search", "Search recent posts on X (Twitter) through the official API: what people say about a topic, a brand, a person or an event. Returns posts with their author, date and link. Posts are outside content.",
    obj({
      query: str("What to search for. With the X API, its search operators work too (e.g. \"from:handle\", \"#tag\", \"lang:fr\", \"-is:retweet\")"),
      max_results: int("How many posts (10 to 100, default 10)"),
      sort: { type: "string", enum: ["recency", "relevancy"], description: "Newest first (default) or most relevant" },
      from_date: str("Only posts from this day on, YYYY-MM-DD"), to_date: str("Only posts before this day, YYYY-MM-DD"),
      handles: { type: "array", items: { type: "string" }, description: "Only posts from these accounts (without @, at most 20)" },
      exclude_handles: { type: "array", items: { type: "string" }, description: "Leave out posts from these accounts (not together with handles)" },
    }, ["query"]), {
    activity: "searching", label: "Searching X", group: "web", outside: true, audited: true, detail: (a) => clip(String(a.query ?? ""), 40),
    run: async (a, c: ToolContext) => {
      try {
        const r = await xSearch({ query: String(a.query), max: Number(a.max_results) || undefined, sort: a.sort === "relevancy" ? "relevancy" : a.sort === "recency" ? "recency" : undefined, fromDate: a.from_date ? String(a.from_date) : undefined, toDate: a.to_date ? String(a.to_date) : undefined, handles: a.handles, excludeHandles: a.exclude_handles }, c.signal);
        return { content: formatXResult(r), summary: r.provider === "x" ? `${r.posts.length} posts` : `${r.citations.length} sources · xAI` };
      } catch (err) {
        if (c.signal.aborted) throw err;
        return { content: (err as Error).message, isError: true, summary: "failed" };
      }
    },
  }),
];
export const xSearchAvailable = () => xSearchProvider() !== null;
