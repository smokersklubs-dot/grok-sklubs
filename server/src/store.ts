import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { q } from "./db.js";
import { pauses } from "./pauses.js";
import { emit } from "./bus.js";
import { tr } from "./i18n.js";
import type { ChatMessage } from "./llm/types.js";
import {
  AVATAR_COLORS, AVATAR_SHAPES,
  ACCESSORIES, CHARACTER_TYPES, DEFAULT_CHARACTER, DEFAULT_NUDGES, SENSITIVE_CATEGORIES, type NudgeSettings, type MemorySettings, type MemoryStatus, type SensitiveCategory, EYE_STYLES, IDLE_MOTIONS, TOOL_GROUPS, type AuditEntry, type Character, type Bot, type Card, type CheckinSettings, type Locale, type Memory, type SearchHit, type SharedPage, type VaultItem, type VaultKind, type BotSection, type Policy, type Reaction, type Row, type RowBody, type Skill, type SkillExtras, SKILL_EXTRA_KEYS, type SkillRef, type Task, type User, type Profile, type ReliabilitySettings, RELIABILITY_LIMITS, DEFAULT_SPEND_CHECKPOINT_USD, type SpendSettings,
} from "./shared.js";

export const now = () => Date.now();
/** MAX_BOTS, read here so the store does not depend on the whole configuration module at load. */
let maxBotsOf = () => Math.max(0, Math.floor(Number(process.env.MAX_BOTS) || 0));
/** For tests: change the team limit without restarting. */
export const setMaxBots = (n: number) => { maxBotsOf = () => n; };
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ── Users ────────────────────────────────────────────────────────────────────
export interface UserRecord extends User { passHash: string }
const toUser = (r: any): UserRecord => ({ id: r.id, email: r.email, name: r.name, locale: r.locale === "fr" ? "fr" : "en", passHash: r.pass_hash });

export const users = {
  count: () => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n,
  byId: (id: string) => { const r = q.get("SELECT * FROM users WHERE id = ?", id); return r ? toUser(r) : null; },
  byEmail: (email: string) => { const r = q.get("SELECT * FROM users WHERE email = ?", email.trim()); return r ? toUser(r) : null; },
  all: () => q.all("SELECT * FROM users").map(toUser),
  localeOf: (id: string): Locale => (q.get<{ locale: string }>("SELECT locale FROM users WHERE id = ?", id)?.locale === "fr" ? "fr" : "en"),
  setPrefs(id: string, f: { locale?: Locale; name?: string }) {
    if (f.locale) q.run("UPDATE users SET locale = ? WHERE id = ?", f.locale, id);
    if (f.name?.trim()) q.run("UPDATE users SET name = ? WHERE id = ?", f.name.trim().slice(0, 80), id);
  },
  create(email: string, name: string, passHash: string, locale: Locale = "en"): UserRecord {
    const id = newId("usr");
    const clean = email.trim().toLowerCase();
    q.run("INSERT INTO users (id, email, name, pass_hash, locale, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, clean, name.trim() || clean.split("@")[0], passHash, locale, now());
    q.run("INSERT INTO settings (user_id) VALUES (?)", id);
    return users.byId(id)!;
  },
};

// ── Bots ─────────────────────────────────────────────────────────────────────
export interface BotRecord extends Bot { userId: string; hidden: boolean; parentId: string | null; nextSeq: number; rev: number; updatedAt: number; telegramTokenEnc: string | null; telegramChatId: string | null; telegramCode: string | null; telegramOffset: number }

function previewOf(body: RowBody, locale: Locale): string {
  if (body.kind === "message") return body.text || (body.attachments?.length ? `📎 ${body.attachments.map((a) => a.name).join(", ")}` : "");
  if (body.kind === "event") return body.text;
  if (body.kind === "card") {
    const c = body.card;
    if (c.type === "approval") return tr(locale, "Waiting for you: {title}", { title: c.title });
    if (c.type === "question") return c.question;
    if (c.type === "takeover") return tr(locale, "Needs you on its screen");
    if (c.type === "secret") return tr(locale, "Asks for a secret: {name}", { name: c.name });
    if (c.type === "uncertain") return tr(locale, "Did it go through? {title}", { title: c.title });
    if (c.type === "task") return tr(locale, "Background task: {title}", { title: c.title });
    if (c.type === "nudge") return c.title;
    if (c.type === "spend") return tr(locale, "Spend checkpoint: {title}", { title: c.title });
    if (c.type === "cap") return tr(locale, "Usage cap reached");
    if (c.type === "skill") return tr(locale, "Skill to review: {name}", { name: c.name });
    if (c.type === "apiconnector") return tr(locale, "API connector to review: {name}", { name: c.name });
    if (c.type === "memory") return tr(locale, "Which is right? {text}", { text: c.newText });
    if (c.type === "mail") return tr(locale, "Email from {from}: {subject}", { from: c.from, subject: c.subject });
    if (c.type === "disk") return tr(locale, "Its computer's disk is {pct}% full", { pct: c.usedPct });
    if (c.type === "pastedsecret") return tr(locale, "A secret was masked in your message");
    if (c.type === "files") return tr(locale, "Files changed: {n}", { n: c.files.length + c.more });
    if (c.type === "goal") return tr(locale, "Goal: {objective}", { objective: c.objective });
    if (c.type === "failure") return tr(locale, "A problem needs you");
    return tr(locale, "Connect {name}", { name: c.name });
  }
  return "";
}

function toBot(r: any): BotRecord {
  const last = q.get<{ body: string; created_at: number }>(
    "SELECT body, created_at FROM rows WHERE bot_id = ? AND generation = ? AND thread = 0 AND kind IN ('message','card','event') ORDER BY seq DESC LIMIT 1",
    r.id, r.generation,
  );
  const voice = { name: "", rate: 1, lang: "auto", ...JSON.parse(r.voice || "{}") };
  return {
    id: r.id, userId: r.user_id, kind: r.kind, name: r.name, label: r.label, description: r.description,
    instructions: r.instructions, shape: r.shape, color: r.color, mode: r.mode, primary: !!r.is_primary,
    effort: r.effort, model: r.model, autonomy: r.autonomy, voice, generation: r.generation, unread: r.unread,
    character: cleanCharacter(JSON.parse(r.character || "{}")),
    roomRule: r.room_rule === "everyone" || r.room_rule === "mentions" || r.room_rule === "auto" ? r.room_rule : "lead",
    disabledTools: JSON.parse(r.disabled_tools || "[]"), telegram: r.telegram_username ?? null,
    pinned: !!r.pinned, sectionId: r.section_id ?? null, listHidden: !!r.list_hidden,
    pause: r.kind === "agent" ? pauses.of({ id: r.id, userId: r.user_id, sectionId: r.section_id ?? null, parentId: r.parent_id ?? null }) : null,
    fallbackModels: r.fallback_models ? cleanModelList(safeJson(r.fallback_models)) : null, createdBy: r.created_by ?? null,
    nudges: cleanNudges(safeJson(r.nudges || "{}")),
    spendCheckpointUsd: typeof r.spend_checkpoint_usd === "number" ? r.spend_checkpoint_usd : null,
    computerMode: r.computer_mode === "shared" ? "shared" : "own",
    relayEnabled: !!r.relay_enabled, thirdPartyDailyCapUsd: typeof r.third_party_cap_usd === "number" ? r.third_party_cap_usd : null,
    telegramTokenEnc: r.telegram_token_enc ?? null, telegramChatId: r.telegram_chat_id ?? null, telegramCode: r.telegram_code ?? null, telegramOffset: r.telegram_offset ?? 0,
    memberIds: JSON.parse(r.members || "[]"), hidden: !!r.hidden, parentId: r.parent_id, nextSeq: r.next_seq, rev: r.rev,
    preview: last ? clip(previewOf(JSON.parse(last.body), users.localeOf(r.user_id)).replace(/\s+/g, " "), 140) : "",
    lastActivityAt: last?.created_at ?? r.updated_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Client-facing projection (drops server-only bookkeeping). */
export function publicBot(b: BotRecord): Bot {
  const { userId, hidden, parentId, nextSeq, rev, updatedAt, telegramTokenEnc, telegramChatId, telegramCode, telegramOffset, ...rest } = b;
  return rest;
}

/** Keeps only known values; anything missing or invalid falls back to the default. */
export function cleanCharacter(raw: unknown, base: Character = DEFAULT_CHARACTER): Character {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T) => (list.includes(v as T) ? (v as T) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const n = Number(c.intensity);
  const hex = typeof c.customColor === "string" && /^#[0-9a-fA-F]{6}$/.test(c.customColor) ? c.customColor.toLowerCase() : c.customColor === null ? null : base.customColor;
  return {
    type: pick(c.type, CHARACTER_TYPES, base.type), customColor: hex,
    eyes: pick(c.eyes, EYE_STYLES, base.eyes), mouth: bool(c.mouth, base.mouth), cheeks: bool(c.cheeks, base.cheeks),
    accessory: pick(c.accessory, ACCESSORIES, base.accessory), idle: pick(c.idle, IDLE_MOTIONS, base.idle),
    intensity: Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : base.intensity,
    followCursor: bool(c.followCursor, base.followCursor), blink: bool(c.blink, base.blink),
    euphoria: bool(c.euphoria, base.euphoria), shout: bool(c.shout, base.shout),
    gemThreshold: Number.isFinite(Number(c.gemThreshold)) && c.gemThreshold !== null && c.gemThreshold !== "" ? Math.min(98, Math.max(60, Math.round(Number(c.gemThreshold)))) : base.gemThreshold ?? 85,
  };
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
/** Keeps known nudge settings within bounds; anything missing falls back to the default (off). */
export function cleanNudges(raw: unknown, base: NudgeSettings = DEFAULT_NUDGES): NudgeSettings {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    enabled: typeof c.enabled === "boolean" ? c.enabled : base.enabled,
    perDay: Math.round(num(c.perDay, 1, 10, base.perDay)),
    budgetUsd: Math.round(num(c.budgetUsd, 0.01, 5, base.budgetUsd) * 100) / 100,
    everyMin: Math.round(num(c.everyMin, 15, 24 * 60, base.everyMin)),
  };
}
/** A model reference as the pickers write it: "provider:model" (or a bare model name), no spaces. */
const MODEL_REF = /^[A-Za-z0-9._-]+(:[A-Za-z0-9._:/@+-]+)?$/;
/** Keeps valid, distinct model references, in order, at most RELIABILITY_LIMITS.fallbackModels. */
export function cleanModelList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const ref = v.trim();
    if (!ref || ref.length > 120 || !MODEL_REF.test(ref) || out.includes(ref)) continue;
    out.push(ref);
    if (out.length >= RELIABILITY_LIMITS.fallbackModels) break;
  }
  return out;
}

function stablePick<T>(seed: string, options: readonly T[]): T {
  const h = createHash("sha256").update(seed).digest();
  return options[h.readUInt32BE(0) % options.length];
}

const BOT_COLUMNS: Record<string, string> = {
  name: "name", label: "label", description: "description", instructions: "instructions", shape: "shape", color: "color",
  mode: "mode", effort: "effort", model: "model", autonomy: "autonomy",
};
const ENUMS: Record<string, readonly string[]> = {
  shape: AVATAR_SHAPES, color: AVATAR_COLORS, mode: ["personal", "teammate"],
  effort: ["low", "medium", "high", "xhigh"], autonomy: ["careful", "balanced", "trusted", "auto"],
};
const LIMITS: Record<string, number> = { name: 60, label: 60, description: 500, instructions: 8000, model: 120 };

/**
 * The installation is full (MAX_BOTS): no agent bot is created, nothing is evicted to make room. Rooms and hidden
 * helpers are not counted.
 */
export class TeamFullError extends Error {
  constructor(public max: number) { super(`The team is full: this installation holds at most ${max} bots. Remove one to create another.`); }
}

/** Hosted mode (hosted.ts): the account's plan may limit its number of bots. Throws when one more would not fit. */
let botGuard: (userId: string) => void = () => {};
export const setBotGuard = (fn: (userId: string) => void) => { botGuard = fn; };

export const bots = {
  /** Agent bots across every account (group chats and hidden helpers excluded): what MAX_BOTS limits. */
  teamCount: () => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE kind = 'agent' AND hidden = 0")!.n,
  /** Throws TeamFullError when `extra` more agent bots would not fit (MAX_BOTS; 0 = no limit). */
  assertRoom(extra = 1) {
    const max = maxBotsOf();
    if (max > 0 && bots.teamCount() + extra > max) throw new TeamFullError(max);
  },
  byId: (id: string) => { const r = q.get("SELECT * FROM bots WHERE id = ?", id); return r ? toBot(r) : null; },
  owned(userId: string, id: string) { const b = bots.byId(id); return b && b.userId === userId ? b : null; },
  list: (userId: string, includeHidden = false) =>
    q.all(`SELECT * FROM bots WHERE user_id = ? ${includeHidden ? "" : "AND hidden = 0"} ORDER BY is_primary DESC, created_at ASC`, userId).map(toBot),
  primary: (userId: string) => { const r = q.get("SELECT * FROM bots WHERE user_id = ? AND is_primary = 1 AND hidden = 0", userId); return r ? toBot(r) : null; },
  children: (parentId: string) => q.all("SELECT * FROM bots WHERE parent_id = ? ORDER BY created_at", parentId).map(toBot),
  byName(userId: string, name: string) {
    const r = q.get("SELECT * FROM bots WHERE user_id = ? AND hidden = 0 AND name = ? COLLATE NOCASE", userId, name.trim());
    return r ? toBot(r) : null;
  },
  create(userId: string, input: Partial<Bot> & { hidden?: boolean; parentId?: string | null }): BotRecord {
    if ((input.kind ?? "agent") === "agent" && !input.hidden) { bots.assertRoom(); botGuard(userId); }
    const id = newId("bot");
    const name = (input.name ?? "").trim().slice(0, 60) || "New bot";
    const shape = AVATAR_SHAPES.includes(input.shape as any) ? input.shape! : stablePick(id + "s", AVATAR_SHAPES);
    const color = AVATAR_COLORS.includes(input.color as any) ? input.color! : stablePick(id + "c", AVATAR_COLORS.filter((c) => c !== "ink"));
    const t = now();
    // A human creates from the main bot; a teammate creates from its own model.
    // An explicit empty model still means the server default (imports and settings).
    let model = input.model;
    if (model === undefined && (input.kind ?? "agent") === "agent") {
      const creator = input.createdBy ?? input.parentId;
      model = (creator ? bots.owned(userId, creator) : bots.primary(userId))?.model;
    }
    q.run(
      `INSERT INTO bots (id, user_id, kind, name, label, description, instructions, shape, color, mode, effort, model, autonomy, hidden, parent_id, members, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, userId, input.kind ?? "agent", name, (input.label ?? "").slice(0, 60), (input.description ?? "").slice(0, 500),
      (input.instructions ?? "").slice(0, 8000), shape, color, input.mode === "teammate" ? "teammate" : "personal",
      ENUMS.effort.includes(input.effort ?? "") ? input.effort! : "medium", model ?? "",
      ENUMS.autonomy.includes(input.autonomy ?? "") ? input.autonomy! : "careful",
      input.hidden ? 1 : 0, input.parentId ?? null, JSON.stringify(input.memberIds ?? []), t, t,
    );
    if (input.character) bots.patch(id, { character: input.character });
    if (input.createdBy) q.run("UPDATE bots SET created_by = ? WHERE id = ?", input.createdBy, id);
    if (input.primary) bots.makePrimary(userId, id);
    return bots.byId(id)!;
  },
  /** Applies a validated partial update; unknown fields and invalid enum values are ignored. */
  patch(id: string, patch: Record<string, unknown>) {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [key, col] of Object.entries(BOT_COLUMNS)) {
      const v = patch[key];
      if (typeof v !== "string") continue;
      if (ENUMS[key] && !ENUMS[key].includes(v)) continue;
      const value = LIMITS[key] ? v.slice(0, LIMITS[key]) : v;
      if (key === "name" && !value.trim()) continue;
      sets.push(`${col} = ?`);
      vals.push(key === "name" ? value.trim() : value);
    }
    if (patch.voice && typeof patch.voice === "object") {
      const v = patch.voice as Record<string, unknown>;
      const rate = Number(v.rate);
      // « Lire les réponses à voix haute » (voice/speak.ts): kept as it was when a patch does not say (older apps).
      const was = v.readAloud === undefined ? !!(safeJson(q.get<{ voice: string }>("SELECT voice FROM bots WHERE id = ?", id)?.voice || "{}") as { readAloud?: unknown } | null)?.readAloud : false;
      sets.push("voice = ?");
      vals.push(JSON.stringify({
        name: typeof v.name === "string" ? v.name.slice(0, 120) : "",
        rate: Number.isFinite(rate) ? Math.min(1.5, Math.max(0.7, rate)) : 1,
        lang: typeof v.lang === "string" ? v.lang.slice(0, 20) : "auto",
        ...((v.readAloud === undefined ? was : v.readAloud === true) ? { readAloud: true } : {}),
      }));
    }
    if (patch.character && typeof patch.character === "object") {
      const cur = q.get<{ character: string }>("SELECT character FROM bots WHERE id = ?", id);
      sets.push("character = ?");
      vals.push(JSON.stringify(cleanCharacter(patch.character, cleanCharacter(JSON.parse(cur?.character || "{}")))));
    }
    if (Array.isArray(patch.memberIds)) {
      // Only a group chat has members, and only the owner's own visible agent bots can be members.
      const self = q.get<{ user_id: string; kind: string }>("SELECT user_id, kind FROM bots WHERE id = ?", id);
      const members = [...new Set(patch.memberIds.filter((m): m is string => typeof m === "string"))].filter((m) => {
        const b = q.get<{ user_id: string; kind: string; hidden: number }>("SELECT user_id, kind, hidden FROM bots WHERE id = ?", m);
        return !!b && !!self && b.user_id === self.user_id && b.kind === "agent" && !b.hidden;
      });
      if (self?.kind === "room") { sets.push("members = ?"); vals.push(JSON.stringify(members)); }
    }
    if (patch.roomRule === "lead" || patch.roomRule === "everyone" || patch.roomRule === "mentions" || patch.roomRule === "auto") { sets.push("room_rule = ?"); vals.push(patch.roomRule); }
    if (typeof patch.pinned === "boolean") { sets.push("pinned = ?"); vals.push(patch.pinned ? 1 : 0); }
    if (typeof patch.listHidden === "boolean") { sets.push("list_hidden = ?"); vals.push(patch.listHidden ? 1 : 0); }
    if (patch.sectionId === null || typeof patch.sectionId === "string") {
      // Only one of the owner's own sections; anything else files the bot back under the default list.
      const owner = q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", id)?.user_id;
      const ok = typeof patch.sectionId === "string" && !!owner && !!q.get("SELECT 1 FROM bot_sections WHERE id = ? AND user_id = ?", patch.sectionId, owner);
      sets.push("section_id = ?"); vals.push(ok ? (patch.sectionId as string) : null);
    }
    // A bot's own backup models: a list (possibly empty: no backup), or null to follow the account's list.
    if (patch.fallbackModels === null) { sets.push("fallback_models = ?"); vals.push(null); }
    else if (Array.isArray(patch.fallbackModels)) { sets.push("fallback_models = ?"); vals.push(JSON.stringify(cleanModelList(patch.fallbackModels))); }
    if (patch.nudges && typeof patch.nudges === "object") {
      const cur = q.get<{ nudges: string }>("SELECT nudges FROM bots WHERE id = ?", id);
      sets.push("nudges = ?"); vals.push(JSON.stringify(cleanNudges(patch.nudges, cleanNudges(safeJson(cur?.nudges || "{}")))));
    }
    // The bot's own spend checkpoint (USD, 0 = never stops), or null to follow the account's setting.
    if (patch.spendCheckpointUsd === null) { sets.push("spend_checkpoint_usd = ?"); vals.push(null); }
    else if (typeof patch.spendCheckpointUsd === "number" && Number.isFinite(patch.spendCheckpointUsd)) { sets.push("spend_checkpoint_usd = ?"); vals.push(Math.round(Math.min(10_000, Math.max(0, patch.spendCheckpointUsd)) * 100) / 100); }
    // Wave 7: the credential relay for this bot's programs, and its daily cap on paid third-party tools (null: none).
    if (typeof patch.relayEnabled === "boolean") { sets.push("relay_enabled = ?"); vals.push(patch.relayEnabled ? 1 : 0); }
    // Part B: its own computer, or one of the account's shared computers.
    if (patch.computerMode === "own" || patch.computerMode === "shared") { sets.push("computer_mode = ?"); vals.push(patch.computerMode); }
    if (patch.thirdPartyDailyCapUsd === null) { sets.push("third_party_cap_usd = ?"); vals.push(null); }
    else if (typeof patch.thirdPartyDailyCapUsd === "number" && Number.isFinite(patch.thirdPartyDailyCapUsd)) { sets.push("third_party_cap_usd = ?"); vals.push(Math.round(Math.min(10_000, Math.max(0, patch.thirdPartyDailyCapUsd)) * 100) / 100); }
    if (Array.isArray(patch.disabledTools)) { sets.push("disabled_tools = ?"); vals.push(JSON.stringify(patch.disabledTools.filter((g) => (TOOL_GROUPS as readonly string[]).includes(g as string)))); }
    if (!sets.length) return;
    q.run(`UPDATE bots SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, now(), id);
  },
  makePrimary(userId: string, id: string) {
    q.tx(() => {
      q.run("UPDATE bots SET is_primary = 0 WHERE user_id = ?", userId);
      q.run("UPDATE bots SET is_primary = 1 WHERE id = ? AND user_id = ?", id, userId);
    });
  },
  setTelegram(id: string, f: { tokenEnc: string | null; username: string | null; chatId?: string | null; code?: string | null }) {
    q.run("UPDATE bots SET telegram_token_enc = ?, telegram_username = ?, telegram_chat_id = ?, telegram_code = ?, telegram_offset = 0 WHERE id = ?", f.tokenEnc, f.username, f.chatId ?? null, f.code ?? null, id);
  },
  linkTelegram: (id: string, chatId: string) => q.run("UPDATE bots SET telegram_chat_id = ?, telegram_code = NULL WHERE id = ?", chatId, id),
  setTelegramOffset: (id: string, offset: number) => q.run("UPDATE bots SET telegram_offset = ? WHERE id = ?", offset, id),
  withTelegram: () => q.all("SELECT * FROM bots WHERE telegram_token_enc IS NOT NULL").map(toBot),
  setUnread(id: string, n: number) { q.run("UPDATE bots SET unread = ? WHERE id = ?", n, id); },
  /** "Mark as unread": at least one unread message, without inventing a count. */
  markUnread(id: string) { q.run("UPDATE bots SET unread = MAX(unread, 1) WHERE id = ?", id); },
  /**
   * A copy of a bot: its settings, look, instructions and skills. Its conversation (current one, threads included) and
   * its memories only when asked. Never its Telegram link, routines, computer or files.
   */
  duplicate(src: BotRecord, opts: { name?: string; memories?: boolean; conversation?: boolean } = {}): BotRecord {
    const copy = bots.create(src.userId, {
      name: (opts.name ?? "").trim() || clip(`${src.name} (copy)`, 60), label: src.label, description: src.description, instructions: src.instructions,
      shape: src.shape, color: src.color, mode: src.mode, effort: src.effort, model: src.model, autonomy: src.autonomy, character: src.character,
    });
    bots.patch(copy.id, { voice: src.voice, disabledTools: src.disabledTools, pinned: src.pinned, sectionId: src.sectionId, fallbackModels: src.fallbackModels });
    q.tx(() => {
      for (const k of skills.list(src.id)) skills.create(copy.id, k.name, k.description, k.body, false, {}, { needs: k.needs, check: k.check, output: k.output, approvals: k.approvals });
      if (opts.memories) for (const m of [...memories.list(src.id, 5000)].reverse()) memories.add(copy.id, m.text, m.source, { quote: m.quote, category: m.category, status: m.status });
      if (opts.conversation) {
        const g = q.get<{ next_seq: number; generation: number }>("SELECT next_seq, generation FROM bots WHERE id = ?", src.id)!;
        q.run("INSERT INTO rows (bot_id, generation, seq, rev, kind, body, created_at, thread) SELECT ?, 1, seq, rev, kind, body, created_at, thread FROM rows WHERE bot_id = ? AND generation = ?", copy.id, src.id, g.generation);
        q.run("INSERT INTO history (bot_id, generation, role, content, thread) SELECT ?, 1, role, content, thread FROM history WHERE bot_id = ? AND generation = ? ORDER BY id", copy.id, src.id, g.generation);
        // Cards copied from the original are records only: nothing waits on them in the copy.
        q.run("UPDATE bots SET next_seq = ?, rev = (SELECT COALESCE(MAX(rev), 0) FROM rows WHERE bot_id = ?) WHERE id = ?", g.next_seq, copy.id, copy.id);
      }
    });
    return bots.byId(copy.id)!;
  },
  bumpUnread(id: string) { q.run("UPDATE bots SET unread = unread + 1 WHERE id = ?", id); },
  /** How many bots this user's bots created (bot_create) since `since`, for the daily limit. */
  createdByBotsSince: (userId: string, since: number) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ? AND created_by IS NOT NULL AND created_at > ?", userId, since)!.n,
  remove(id: string) { q.run("DELETE FROM bots WHERE id = ? OR parent_id = ?", id, id); pauses.forget("bot", id); },
  resetConversation(id: string): number {
    q.run("UPDATE bots SET generation = generation + 1, next_seq = 1, unread = 0, updated_at = ? WHERE id = ?", now(), id);
    q.run("DELETE FROM paused WHERE bot_id = ?", id);
    return bots.byId(id)!.generation;
  },
  announce(b: BotRecord | null) { if (b && !b.hidden) emit(b.userId, { type: "bot", bot: publicBot(bots.byId(b.id)!) }); },
};

// ── Sidebar sections ─────────────────────────────────────────────────────────
const toSection = (r: any): BotSection => ({ id: r.id, name: r.name, position: r.position, createdAt: r.created_at, paused: pauses.sectionPaused(r.user_id, r.id) });
export const sections = {
  list: (userId: string) => q.all("SELECT * FROM bot_sections WHERE user_id = ? ORDER BY position, created_at", userId).map(toSection),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM bot_sections WHERE id = ? AND user_id = ?", id, userId); return r ? toSection(r) : null; },
  create(userId: string, name: string): BotSection {
    const id = newId("sec");
    const pos = (q.get<{ p: number | null }>("SELECT MAX(position) AS p FROM bot_sections WHERE user_id = ?", userId)?.p ?? -1) + 1;
    q.run("INSERT INTO bot_sections (id, user_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)", id, userId, clip(name.trim(), 40), pos, now());
    return sections.owned(userId, id)!;
  },
  update(id: string, f: { name?: string; position?: number }) {
    if (f.name !== undefined) q.run("UPDATE bot_sections SET name = ? WHERE id = ?", clip(f.name.trim(), 40), id);
    if (f.position !== undefined) q.run("UPDATE bot_sections SET position = ? WHERE id = ?", Math.max(0, Math.round(f.position)), id);
  },
  /** Removing a section keeps its bots: they go back to the default list. */
  remove(userId: string, id: string) {
    q.tx(() => {
      q.run("UPDATE bots SET section_id = NULL WHERE user_id = ? AND section_id = ?", userId, id);
      q.run("DELETE FROM bot_sections WHERE id = ? AND user_id = ?", id, userId);
      // Its pause goes with it: its bots, back in the default list, are no longer paused because of it.
      if (!q.get("SELECT 1 FROM bot_sections WHERE id = ?", id)) pauses.forget("section", id);
    });
  },
};

// ── Transcript rows ──────────────────────────────────────────────────────────
const toRow = (r: any): Row => ({ botId: r.bot_id, generation: r.generation, seq: r.seq, rev: r.rev, createdAt: r.created_at, body: JSON.parse(r.body), ...(r.thread ? { thread: r.thread } : {}) });

/**
 * The thread a bot's turn is working in. Everything that turn writes into its own chat (replies, steps,
 * cards, pictures) lands in that thread without each tool having to know about threads.
 */
export const rowScope = new AsyncLocalStorage<{ botId: string; thread: number }>();
const scopedThread = (botId: string) => { const s = rowScope.getStore(); return s && s.botId === botId ? s.thread : 0; };

/** What a rewrite keeps from the stored row unless it sets it itself: reactions and the thread summary live alongside the text. */
function keepMeta(cur: RowBody, next: RowBody): RowBody {
  if (cur.kind !== "message" || next.kind !== "message") return next;
  return { ...next, ...(!("reactions" in next) && cur.reactions?.length ? { reactions: cur.reactions } : {}), ...(!("replies" in next) && cur.replies ? { replies: cur.replies } : {}) };
}

export const rows = {
  /** Adds a row. `thread`: the seq of the message a thread reply hangs on; by default, the thread of the bot's turn under way (or the main chat). */
  append(bot: { id: string; userId: string }, raw: RowBody, thread?: number, onStored?: (seq: number) => void): Row {
    const th = thread ?? scopedThread(bot.id);
    const body = scrub(bot.userId, raw);
    const row = q.tx(() => {
      const b = q.get<{ generation: number; next_seq: number; rev: number }>("SELECT generation, next_seq, rev FROM bots WHERE id = ?", bot.id);
      if (!b) throw new Error("bot no longer exists");
      const t = now();
      q.run("INSERT INTO rows (bot_id, generation, seq, rev, kind, body, created_at, thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", bot.id, b.generation, b.next_seq, b.rev + 1, body.kind, JSON.stringify(body), t, th);
      q.run("UPDATE bots SET next_seq = next_seq + 1, rev = rev + 1, updated_at = ? WHERE id = ?", t, bot.id);
      onStored?.(b.next_seq);
      return { botId: bot.id, generation: b.generation, seq: b.next_seq, rev: b.rev + 1, createdAt: t, body, ...(th ? { thread: th } : {}) } satisfies Row;
    });
    emit(bot.userId, { type: "rows", botId: bot.id, generation: row.generation, rows: [row] });
    if (th && body.kind === "message") rows.countReplies(bot, row.generation, th);
    return row;
  },
  /** Refreshes the "N replies" line under the message a thread hangs on. */
  countReplies(bot: { id: string; userId: string }, generation: number, parentSeq: number) {
    const parent = rows.get(bot.id, generation, parentSeq);
    if (!parent || parent.body.kind !== "message") return;
    const n = q.get<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind = 'message'", bot.id, generation, parentSeq)!;
    rows.rewrite(bot, generation, parentSeq, { ...parent.body, replies: { count: n.n, lastAt: n.last ?? now() } });
  },
  /** Rewrites a row in place with a higher revision so clients replace their copy. Reactions and the thread summary are kept unless `body` sets them. */
  rewrite(bot: { id: string; userId: string }, generation: number, seq: number, raw: RowBody): Row | null {
    const body = scrub(bot.userId, raw);
    const row = q.tx(() => {
      const cur = q.get("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND seq = ?", bot.id, generation, seq);
      const b = q.get<{ rev: number }>("SELECT rev FROM bots WHERE id = ?", bot.id);
      if (!cur || !b) return null;
      const before = toRow(cur);
      const next = keepMeta(before.body, body);
      q.run("UPDATE rows SET body = ?, rev = ? WHERE bot_id = ? AND generation = ? AND seq = ?", JSON.stringify(next), b.rev + 1, bot.id, generation, seq);
      q.run("UPDATE bots SET rev = rev + 1, updated_at = ? WHERE id = ?", now(), bot.id);
      return { ...before, rev: b.rev + 1, body: next };
    });
    if (row) emit(bot.userId, { type: "rows", botId: bot.id, generation, rows: [row] });
    return row;
  },
  get(botId: string, generation: number, seq: number): Row | null {
    const r = q.get("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND seq = ?", botId, generation, seq);
    return r ? toRow(r) : null;
  },
  /** One page of the main chat, or of one thread (`thread` = the seq it hangs on). */
  list(botId: string, generation: number, limit = 200, before?: number, thread = 0): Row[] {
    const lim = Math.min(Math.max(1, limit), 500);
    const found = before
      ? q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND seq < ? ORDER BY seq DESC LIMIT ?", botId, generation, thread, before, lim)
      : q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? ORDER BY seq DESC LIMIT ?", botId, generation, thread, lim);
    return found.reverse().map(toRow);
  },
  /** Every row of a conversation, threads included, in order (exports). */
  all(botId: string, generation: number): Row[] {
    return q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? ORDER BY seq", botId, generation).map(toRow);
  },
  recentMessages(botId: string, generation: number, limit: number, thread = 0): Row[] {
    return q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind = 'message' ORDER BY seq DESC LIMIT ?", botId, generation, thread, limit).reverse().map(toRow);
  },
  messagesAfter(botId: string, generation: number, after: number, limit: number): Row[] {
    return q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' AND created_at > ? ORDER BY seq DESC LIMIT ?", botId, generation, after, limit).reverse().map(toRow);
  },
  updateCard(bot: { id: string; userId: string }, generation: number, seq: number, change: (card: Card) => Card): Row | null {
    const row = rows.get(bot.id, generation, seq);
    if (!row || row.body.kind !== "card") return null;
    return rows.rewrite(bot, generation, seq, { kind: "card", card: change(row.body.card) });
  },
  /**
   * Adds or removes one reaction (toggle) on a message. Returns the new list, or null when the row is not a
   * message. Each reactor has each emoji at most once.
   */
  react(bot: { id: string; userId: string }, generation: number, seq: number, reaction: Reaction, on?: boolean): Reaction[] | null {
    const row = rows.get(bot.id, generation, seq);
    if (!row || row.body.kind !== "message") return null;
    const list = row.body.reactions ?? [];
    const has = list.some((r) => r.emoji === reaction.emoji && r.by === reaction.by);
    const want = on ?? !has;
    if (want === has) return list;
    const next = want ? [...list, reaction].slice(-40) : list.filter((r) => !(r.emoji === reaction.emoji && r.by === reaction.by));
    rows.rewrite(bot, generation, seq, { ...row.body, reactions: next });
    return next;
  },
};

// ── Light feedback: reactions the bot hears about in its next turn ───────────
export const feedback = {
  add: (botId: string, generation: number, thread: number, seq: number, emoji: string, text: string) =>
    q.run("INSERT INTO feedback (bot_id, generation, thread, seq, emoji, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", botId, generation, thread, seq, emoji, text, now()),
  /** A reaction taken back before the bot heard about it is forgotten. */
  drop: (botId: string, generation: number, seq: number, emoji: string) => q.run("DELETE FROM feedback WHERE bot_id = ? AND generation = ? AND seq = ? AND emoji = ?", botId, generation, seq, emoji),
  /** The notes waiting for this chat or thread, removed as they are handed over (at most the 10 latest). */
  take(botId: string, generation: number, thread: number): string[] {
    const found = q.all<{ text: string }>("SELECT text FROM feedback WHERE bot_id = ? AND generation = ? AND thread = ? ORDER BY id DESC LIMIT 10", botId, generation, thread).reverse();
    q.run("DELETE FROM feedback WHERE bot_id = ? AND generation = ? AND thread = ?", botId, generation, thread);
    return found.map((f) => f.text);
  },
};

// ── Model-facing history ─────────────────────────────────────────────────────
// `thread` 0 is the main conversation; a thread keeps its own history under the seq it hangs on.
export const history = {
  load(botId: string, generation: number, thread = 0): ChatMessage[] {
    return q.all<{ role: string; content: string }>("SELECT role, content FROM history WHERE bot_id = ? AND generation = ? AND thread = ? ORDER BY id", botId, generation, thread)
      .map((r) => ({ role: r.role as ChatMessage["role"], content: JSON.parse(r.content) }));
  },
  append(botId: string, generation: number, msg: ChatMessage, thread = 0) {
    q.run("INSERT INTO history (bot_id, generation, role, content, thread) VALUES (?, ?, ?, ?, ?)", botId, generation, msg.role, JSON.stringify(msg.content), thread);
  },
  replace(botId: string, generation: number, msgs: ChatMessage[], thread = 0) {
    q.tx(() => {
      q.run("DELETE FROM history WHERE bot_id = ? AND generation = ? AND thread = ?", botId, generation, thread);
      for (const m of msgs) history.append(botId, generation, m, thread);
    });
  },
  count: (botId: string, generation: number, thread = 0) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM history WHERE bot_id = ? AND generation = ? AND thread = ?", botId, generation, thread)!.n,
};

// ── Memories, skills, tasks ──────────────────────────────────────────────────
const toMemory = (r: any): Memory => ({
  id: r.id, botId: r.bot_id, text: r.text, source: r.source === "learned" || r.source === "import" ? r.source : "chat", createdAt: r.created_at,
  status: r.status === "archived" || r.status === "contested" ? r.status : "active", quote: r.quote ?? "",
  category: (SENSITIVE_CATEGORIES as readonly string[]).includes(r.category) ? r.category : null,
  confidence: r.confidence === "confirmed" ? "confirmed" : "once", confirmedAt: r.confirmed_at ?? null, lastUsedAt: r.last_used_at ?? null,
});
export const memories = {
  list: (botId: string, limit = 500) => q.all("SELECT * FROM memories WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?", botId, limit).map(toMemory),
  /** Notes a bot may use: active ones, then contested ones (used with caution); archived ones never. */
  usable: (botId: string, limit = 500) => q.all("SELECT * FROM memories WHERE bot_id = ? AND status != 'archived' ORDER BY created_at DESC, rowid DESC LIMIT ?", botId, limit).map(toMemory),
  add(botId: string, text: string, source: Memory["source"] = "chat", extra: { quote?: string; category?: SensitiveCategory | null; status?: MemoryStatus } = {}): Memory {
    const id = newId("mem");
    q.run("INSERT INTO memories (id, bot_id, text, source, created_at, status, quote, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, botId, text.trim(), source, now(), extra.status ?? "active", clip(extra.quote ?? "", 500), extra.category ?? null);
    return toMemory(q.get("SELECT * FROM memories WHERE id = ?", id));
  },
  owned(userId: string, id: string) {
    const r = q.get("SELECT m.* FROM memories m JOIN bots b ON b.id = m.bot_id WHERE m.id = ? AND b.user_id = ?", id, userId);
    return r ? toMemory(r) : null;
  },
  setStatus: (id: string, status: MemoryStatus) => q.run("UPDATE memories SET status = ? WHERE id = ?", status, id),
  /** The user said it again (a verified quote of their own words), or confirmed it: confidence grows, never shrinks here. */
  confirm: (id: string) => q.run("UPDATE memories SET confidence = 'confirmed', confirmed_at = ? WHERE id = ?", now(), id),
  setConfidence: (id: string, c: Memory["confidence"]) => q.run("UPDATE memories SET confidence = ?, confirmed_at = ? WHERE id = ?", c, c === "confirmed" ? now() : null, id),
  /** Found relevant (in the prompt for what the user is talking about, or by memory_search). */
  touch: (ids: string[]) => { const t = now(); for (const id of ids) q.run("UPDATE memories SET last_used_at = ? WHERE id = ?", t, id); },
  removeOwned(userId: string, id: string) {
    q.run("DELETE FROM memories WHERE id = ? AND bot_id IN (SELECT id FROM bots WHERE user_id = ?)", id, userId);
  },
};

const toSkill = (r: any): Skill => ({ id: r.id, botId: r.bot_id, name: r.name, description: r.description, body: r.body, needs: r.needs ?? "", check: r.check_how ?? "", output: r.output ?? "", approvals: r.approvals ?? "", shared: !!r.shared, learned: !!r.learned, outside: !!r.outside, draft: !!r.draft, createdAt: r.created_at, updatedAt: r.updated_at });
/** Column of each structured part of a skill. */
const SKILL_COLUMNS: Record<keyof SkillExtras, string> = { needs: "needs", check: "check_how", output: "output", approvals: "approvals" };
function saveSkillExtras(id: string, extras: Partial<SkillExtras> | undefined) {
  for (const k of SKILL_EXTRA_KEYS) if (typeof extras?.[k] === "string") q.run(`UPDATE skills SET ${SKILL_COLUMNS[k]} = ? WHERE id = ?`, extras[k]!.trim().slice(0, 2000), id);
}
/**
 * A skill as the bot reads it: when to use it, what it needs, its steps, the steps that need the user's approval, how
 * to check the result and what to hand back. Parts not given are left out, so an older skill reads as it always did.
 */
export function skillText(s: Pick<Skill, "description" | "body"> & Partial<SkillExtras>): string {
  return [
    s.description ? `Use when: ${s.description}` : "",
    s.needs ? `Needs first (accounts, access, files): ${s.needs}` : "",
    s.needs || s.approvals || s.check || s.output ? `Steps:\n${s.body}` : s.body,
    s.approvals ? `Steps that need the user's approval — ask before doing them, even if you could go ahead otherwise: ${s.approvals}` : "",
    s.check ? `How to check the result: ${s.check}` : "",
    s.output ? `What to hand back at the end: ${s.output}` : "",
  ].filter(Boolean).join("\n");
}
export const skills = {
  list: (botId: string) => q.all("SELECT * FROM skills WHERE bot_id = ? ORDER BY created_at", botId).map(toSkill),
  /** The skills a bot is given (its prompt, skill_read): its own, without the drafts the user has not activated yet. */
  usable: (botId: string) => q.all("SELECT * FROM skills WHERE bot_id = ? AND draft = 0 ORDER BY created_at", botId).map(toSkill),
  owned(userId: string, id: string) {
    const r = q.get("SELECT s.* FROM skills s JOIN bots b ON b.id = s.bot_id WHERE s.id = ? AND b.user_id = ?", id, userId);
    return r ? toSkill(r) : null;
  },
  /** `learned`/`outside`: a procedure the bot proposed and the user approved; outside: it came from a turn that read outside content. */
  /** `extras`: the optional structured parts (needs, check, output, approvals); missing ones stay empty. */
  /** `draft`: came from outside (an import) and waits for the user to activate it; the bot does not get it until then. */
  create(botId: string, name: string, description: string, body: string, shared = false, origin: { learned?: boolean; outside?: boolean; draft?: boolean } = {}, extras?: Partial<SkillExtras>): Skill {
    const id = newId("skl");
    const t = now();
    q.run("INSERT INTO skills (id, bot_id, name, description, body, shared, learned, outside, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, botId, name, description, body, shared ? 1 : 0, origin.learned ? 1 : 0, origin.outside ? 1 : 0, origin.draft ? 1 : 0, t, t);
    saveSkillExtras(id, extras);
    return toSkill(q.get("SELECT * FROM skills WHERE id = ?", id));
  },
  /** A structured part left undefined keeps its value; an empty string clears it. */
  update(id: string, f: { name: string; description: string; body: string; shared?: boolean; draft?: boolean } & Partial<SkillExtras>) {
    q.run("UPDATE skills SET name = ?, description = ?, body = ?, updated_at = ? WHERE id = ?", f.name, f.description, f.body, now(), id);
    saveSkillExtras(id, f);
    if (typeof f.shared === "boolean") q.run("UPDATE skills SET shared = ? WHERE id = ?", f.shared ? 1 : 0, id);
    if (typeof f.draft === "boolean") q.run("UPDATE skills SET draft = ? WHERE id = ?", f.draft ? 1 : 0, id);
    return toSkill(q.get("SELECT * FROM skills WHERE id = ?", id));
  },
  /** Skills other bots of the same user shared (never this bot's own). */
  sharedWith(botId: string): (Skill & { botName: string })[] {
    return q.all("SELECT s.*, b.name AS bot_name FROM skills s JOIN bots b ON b.id = s.bot_id WHERE s.shared = 1 AND s.draft = 0 AND s.bot_id != ? AND b.user_id = (SELECT user_id FROM bots WHERE id = ?) ORDER BY s.created_at", botId, botId)
      .map((r: any) => ({ ...toSkill(r), botName: r.bot_name }));
  },
  /** Every skill a bot can follow: its own first, then the ones its teammates shared (an own skill wins on a name clash). */
  available(botId: string): (Skill & { botName: string; own: boolean })[] {
    const self = q.get<{ name: string }>("SELECT name FROM bots WHERE id = ?", botId)?.name ?? "";
    const own = skills.usable(botId).map((k) => ({ ...k, botName: self, own: true }));
    const names = new Set(own.map((k) => k.name.toLowerCase()));
    return [...own, ...skills.sharedWith(botId).filter((k) => !names.has(k.name.toLowerCase())).map((k) => ({ ...k, own: false }))];
  },
  refs: (botId: string): SkillRef[] => skills.available(botId).map((k) => ({ id: k.id, name: k.name, description: k.description, botId: k.botId, botName: k.botName, own: k.own, shared: k.shared })),
  /** The skill a bot means by `name` (case-insensitive): its own, else a shared one. */
  find(botId: string, name: string) {
    const want = name.trim().toLowerCase();
    return skills.available(botId).find((k) => k.name.toLowerCase() === want) ?? null;
  },
  remove: (id: string) => q.run("DELETE FROM skills WHERE id = ?", id),
};

const toTask = (r: any): Task => ({ id: r.id, botId: r.bot_id, title: r.title, state: r.state, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at });
export const tasks = {
  forBot: (botId: string) => q.all("SELECT * FROM tasks WHERE bot_id = ? ORDER BY updated_at DESC", botId).map(toTask),
  forUser: (userId: string) => q.all("SELECT t.* FROM tasks t JOIN bots b ON b.id = t.bot_id WHERE b.user_id = ? ORDER BY t.updated_at DESC LIMIT 200", userId).map(toTask),
  create(botId: string, title: string): Task {
    const id = newId("tsk");
    const t = now();
    q.run("INSERT INTO tasks (id, bot_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, botId, clip(title.trim(), 200), t, t);
    return toTask(q.get("SELECT * FROM tasks WHERE id = ?", id));
  },
  update(botId: string, id: string, state: Task["state"], note?: string): Task | null {
    const cur = q.get("SELECT * FROM tasks WHERE id = ? AND bot_id = ?", id, botId);
    if (!cur) return null;
    q.run("UPDATE tasks SET state = ?, note = ?, updated_at = ? WHERE id = ?", state, note ?? (cur as any).note, now(), id);
    return toTask(q.get("SELECT * FROM tasks WHERE id = ?", id));
  },
};

// ── Approvals and policies ───────────────────────────────────────────────────
/** `actionHash`: the exact action the approval is bound to (see actionHash in agent/executions.ts); `consumedAt`: when it ran. */
export interface ApprovalRecord { id: string; botId: string; userId: string; seq: number; generation: number; tool: string; status: string; actionHash: string | null; consumedAt: number | null }
const toApproval = (r: any): ApprovalRecord => ({ id: r.id, botId: r.bot_id, userId: r.user_id, seq: r.seq, generation: r.generation, tool: r.tool, status: r.status, actionHash: r.action_hash ?? null, consumedAt: r.consumed_at ?? null });
export const approvals = {
  create(botId: string, userId: string, generation: number, seq: number, tool: string, id = newId("apr"), actionHash: string | null = null): ApprovalRecord {
    q.run("INSERT INTO approvals (id, bot_id, user_id, seq, generation, tool, created_at, action_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, botId, userId, seq, generation, tool, now(), actionHash);
    return approvals.byId(id)!;
  },
  /**
   * Uses an allowed approval for the action it is bound to: true once, for that exact action. A second use, or a
   * different action, gets false (it then needs a new approval).
   */
  consume(id: string, actionHash: string): boolean {
    return Number(q.run("UPDATE approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND status IN ('allowed','always') AND (action_hash IS NULL OR action_hash = ?)", now(), id, actionHash).changes) > 0;
  },
  byId: (id: string) => { const r = q.get("SELECT * FROM approvals WHERE id = ?", id); return r ? toApproval(r) : null; },
  resolve: (id: string, status: string) => q.run("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?", status, now(), id),
  pendingForUser: (userId: string) => q.all("SELECT * FROM approvals WHERE user_id = ? AND status = 'pending'", userId).map(toApproval),
  /** Approvals still waiting that were asked before `before` (for the stuck-work reminder). */
  pendingBefore: (before: number) => q.all("SELECT * FROM approvals WHERE status = 'pending' AND created_at < ?", before).map(toApproval),
};

export const policies = {
  list: (userId: string) => q.all<Policy>("SELECT tool, mode FROM policies WHERE user_id = ? ORDER BY tool", userId),
  get: (userId: string, tool: string) => q.get<{ mode: Policy["mode"] }>("SELECT mode FROM policies WHERE user_id = ? AND tool = ?", userId, tool)?.mode ?? null,
  set: (userId: string, tool: string, mode: Policy["mode"]) =>
    q.run("INSERT INTO policies (user_id, tool, mode) VALUES (?, ?, ?) ON CONFLICT(user_id, tool) DO UPDATE SET mode = excluded.mode", userId, tool, mode),
  remove: (userId: string, tool: string) => q.run("DELETE FROM policies WHERE user_id = ? AND tool = ?", userId, tool),
};

// ── Paused turns ─────────────────────────────────────────────────────────────
export const paused = {
  get<T>(botId: string): T | null {
    const r = q.get<{ state: string }>("SELECT state FROM paused WHERE bot_id = ?", botId);
    return r ? (JSON.parse(r.state) as T) : null;
  },
  set: (botId: string, state: unknown) =>
    q.run("INSERT INTO paused (bot_id, state) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET state = excluded.state", botId, JSON.stringify(state)),
  clear: (botId: string) => q.run("DELETE FROM paused WHERE bot_id = ?", botId),
};

// ── Per-user settings ────────────────────────────────────────────────────────
export interface CheckinState extends CheckinSettings { lastSlot: string; quietStreak: number }
const CHECKIN_DEFAULT: CheckinState = { enabled: false, times: ["09:00", "16:30"], timezone: "UTC", lastSlot: "", quietStreak: 0 };
export const settings = {
  checkins(userId: string): CheckinState {
    const r = q.get<{ checkins: string }>("SELECT checkins FROM settings WHERE user_id = ?", userId);
    return { ...CHECKIN_DEFAULT, ...(r ? JSON.parse(r.checkins || "{}") : {}) };
  },
  saveCheckins(userId: string, state: CheckinState) {
    q.run("INSERT INTO settings (user_id, checkins) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET checkins = excluded.checkins", userId, JSON.stringify(state));
  },
  budgetWarned: (userId: string) => q.get<{ budget_warned: string }>("SELECT budget_warned FROM settings WHERE user_id = ?", userId)?.budget_warned ?? "",
  setBudgetWarned: (userId: string, month: string) => q.run("UPDATE settings SET budget_warned = ? WHERE user_id = ?", month, userId),
  reliability(userId: string): Omit<ReliabilitySettings, "envFallbacks"> {
    const raw = (safeJson(q.get<{ reliability: string }>("SELECT reliability FROM settings WHERE user_id = ?", userId)?.reliability ?? "{}") ?? {}) as Record<string, unknown>;
    const int = (v: unknown, max: number, fallback: number) => (Number.isInteger(v) ? Math.min(max, Math.max(0, v as number)) : fallback);
    return { fallbackModels: cleanModelList(raw.fallbackModels), maxRetries: int(raw.maxRetries, RELIABILITY_LIMITS.maxRetries, 3), maxContinuations: int(raw.maxContinuations, RELIABILITY_LIMITS.maxContinuations, 3), mutualAid: raw.mutualAid !== false };
  },
  saveReliability(userId: string, f: Partial<Omit<ReliabilitySettings, "envFallbacks">>) {
    const cur = settings.reliability(userId);
    const next = { ...cur, ...f };
    q.run("INSERT INTO settings (user_id, reliability) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET reliability = excluded.reliability", userId, JSON.stringify(next));
    return settings.reliability(userId);
  },
  profile(userId: string): Profile {
    const raw = (safeJson(q.get<{ profile: string }>("SELECT profile FROM settings WHERE user_id = ?", userId)?.profile ?? "{}") ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return { name: s(raw.name), timezone: s(raw.timezone), company: s(raw.company), preferences: s(raw.preferences), updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null };
  },
  /** Merges the given fields (already checked by the caller) into the profile. */
  saveProfile(userId: string, f: Partial<Omit<Profile, "updatedAt">>): Profile {
    const next = { ...settings.profile(userId), ...f, updatedAt: now() };
    q.run("INSERT INTO settings (user_id, profile) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile", userId, JSON.stringify(next));
    return settings.profile(userId);
  },
  memory(userId: string): MemorySettings {
    const raw = (safeJson(q.get<{ memory: string }>("SELECT memory FROM settings WHERE user_id = ?", userId)?.memory ?? "{}") ?? {}) as Record<string, any>;
    const allow = (raw.allowSensitive && typeof raw.allowSensitive === "object" ? raw.allowSensitive : {}) as Record<string, unknown>;
    const st = (raw.style && typeof raw.style === "object" ? raw.style : {}) as Record<string, unknown>;
    return {
      autoCapture: raw.autoCapture !== false,
      allowSensitive: Object.fromEntries(SENSITIVE_CATEGORIES.map((c) => [c, allow[c] === true])) as Record<SensitiveCategory, boolean>,
      style: {
        enabled: st.enabled === true, profile: typeof st.profile === "string" ? st.profile.slice(0, 3000) : "",
        updatedAt: typeof st.updatedAt === "number" ? st.updatedAt : null, source: st.source === "mail" || st.source === "chat" ? st.source : null,
        samples: typeof st.samples === "number" ? st.samples : 0,
      },
    };
  },
  saveMemory(userId: string, f: { autoCapture?: boolean; allowSensitive?: Partial<Record<SensitiveCategory, boolean>>; style?: Partial<MemorySettings["style"]> }): MemorySettings {
    const cur = settings.memory(userId);
    const next: MemorySettings = {
      autoCapture: typeof f.autoCapture === "boolean" ? f.autoCapture : cur.autoCapture,
      allowSensitive: { ...cur.allowSensitive, ...Object.fromEntries(Object.entries(f.allowSensitive ?? {}).filter(([k, v]) => (SENSITIVE_CATEGORIES as readonly string[]).includes(k) && typeof v === "boolean")) },
      style: { ...cur.style, ...(f.style ?? {}) },
    };
    q.run("INSERT INTO settings (user_id, memory) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET memory = excluded.memory", userId, JSON.stringify(next));
    return settings.memory(userId);
  },
  /** The reviewer of "auto" mode: its model ("" = AUX_MODEL, else the bot's own). */
  review(userId: string): { model: string } {
    const raw = (safeJson(q.get<{ review: string }>("SELECT review FROM settings WHERE user_id = ?", userId)?.review ?? "{}") ?? {}) as Record<string, unknown>;
    return { model: typeof raw.model === "string" && (raw.model === "" || MODEL_REF.test(raw.model)) ? raw.model : "" };
  },
  saveReview(userId: string, f: { model: string }) {
    q.run("INSERT INTO settings (user_id, review) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET review = excluded.review", userId, JSON.stringify({ model: f.model }));
    return settings.review(userId);
  },
  /** Spend checkpoint of the account (spec 07 A5): USD a task may spend since the user last spoke to it (0: off). */
  spend(userId: string): SpendSettings {
    const raw = (safeJson(q.get<{ spend: string }>("SELECT spend FROM settings WHERE user_id = ?", userId)?.spend ?? "{}") ?? {}) as Record<string, unknown>;
    const n = Number(raw.checkpointUsd);
    return { checkpointUsd: raw.checkpointUsd !== undefined && Number.isFinite(n) && n >= 0 ? n : DEFAULT_SPEND_CHECKPOINT_USD };
  },
  saveSpend(userId: string, f: { checkpointUsd: number }): SpendSettings {
    const v = Math.round(Math.min(10_000, Math.max(0, f.checkpointUsd)) * 100) / 100;
    q.run("INSERT INTO settings (user_id, spend) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET spend = excluded.spend", userId, JSON.stringify({ checkpointUsd: v }));
    return settings.spend(userId);
  },
  /**
   * Wave 8: the account's team folder — one folder shared, at ~/team, by the computers of this account's own bots. Off by
   * default; `since`: when it was last switched on or off.
   */
  team(userId: string): { enabled: boolean; since: number | null } {
    const raw = (safeJson(q.get<{ team: string }>("SELECT team FROM settings WHERE user_id = ?", userId)?.team ?? "{}") ?? {}) as Record<string, unknown>;
    return { enabled: raw.enabled === true, since: typeof raw.since === "number" ? raw.since : null };
  },
  saveTeam(userId: string, enabled: boolean) {
    q.run("INSERT INTO settings (user_id, team) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET team = excluded.team", userId, JSON.stringify({ enabled, since: now() }));
    return settings.team(userId);
  },
  budget: (userId: string) => q.get<{ budget_usd: number | null }>("SELECT budget_usd FROM settings WHERE user_id = ?", userId)?.budget_usd ?? null,
  setBudget: (userId: string, usd: number | null) =>
    q.run("INSERT INTO settings (user_id, budget_usd) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET budget_usd = excluded.budget_usd", userId, usd),
};

// ── Vault: saved logins, secrets (API keys) and TOTP seeds ──────────────────
export interface VaultRecord extends VaultItem { userId: string; passwordEnc: string | null }
export interface VaultFields { kind?: VaultKind; name: string; site: string; username: string; passwordEnc: string | null; note: string; hosts?: string[]; header?: string; prefix?: string; checkUrl?: string; digits?: number; period?: number; brand?: string; last4?: string; dailyCapUsd?: number | null; monthlyCapUsd?: number | null }
const toVault = (r: any): VaultRecord => {
  const meta = (() => { try { return JSON.parse(r.meta || "{}"); } catch { return {}; } })();
  const kind: VaultKind = r.kind === "secret" || r.kind === "totp" || r.kind === "card" ? r.kind : "login";
  return {
    id: r.id, kind, userId: r.user_id, name: r.name, site: r.site, username: r.username, hasPassword: !!r.password_enc, passwordEnc: r.password_enc, note: r.note, createdAt: r.created_at,
    hosts: Array.isArray(meta.hosts) ? meta.hosts.filter((h: unknown) => typeof h === "string") : [], header: typeof meta.header === "string" ? meta.header : "", prefix: typeof meta.prefix === "string" ? meta.prefix : "",
    checkUrl: typeof meta.checkUrl === "string" ? meta.checkUrl : "",
    digits: meta.digits === 8 ? 8 : 6, period: Number.isInteger(meta.period) && meta.period >= 15 && meta.period <= 120 ? meta.period : 30,
    card: kind === "card" ? {
      brand: typeof meta.brand === "string" ? meta.brand : "", last4: typeof meta.last4 === "string" ? meta.last4 : "",
      dailyCapUsd: typeof meta.dailyCapUsd === "number" ? meta.dailyCapUsd : null, monthlyCapUsd: typeof meta.monthlyCapUsd === "number" ? meta.monthlyCapUsd : null,
      spentTodayUsd: cardSpent(r.id, "day"), spentMonthUsd: cardSpent(r.id, "month"),
    } : null,
  };
};
/** What was spent with a card today or this month (UTC): payments filled, submitted or of unknown outcome. */
export function cardSpent(cardId: string, period: "day" | "month"): number {
  const d = new Date();
  const since = period === "day" ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return q.get<{ s: number | null }>("SELECT SUM(amount) AS s FROM payments WHERE card_id = ? AND created_at >= ? AND status IN ('approved','filled','submitted','uncertain')", cardId, since)?.s ?? 0;
}
const metaOf = (f: VaultFields) => JSON.stringify(f.kind === "secret" ? { hosts: f.hosts ?? [], header: f.header ?? "", prefix: f.prefix ?? "", ...(f.checkUrl ? { checkUrl: f.checkUrl } : {}) } : f.kind === "totp" ? { digits: f.digits ?? 6, period: f.period ?? 30 }
  : f.kind === "card" ? { brand: f.brand ?? "", last4: f.last4 ?? "", dailyCapUsd: f.dailyCapUsd ?? null, monthlyCapUsd: f.monthlyCapUsd ?? null } : {});
export const publicVault = ({ userId, passwordEnc, ...rest }: VaultRecord): VaultItem => rest;
export const vault = {
  list: (userId: string) => q.all("SELECT * FROM vault WHERE user_id = ? ORDER BY name COLLATE NOCASE", userId).map(toVault),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM vault WHERE id = ? AND user_id = ?", id, userId); return r ? toVault(r) : null; },
  byName(userId: string, name: string) { const r = q.get("SELECT * FROM vault WHERE user_id = ? AND name = ? COLLATE NOCASE", userId, name.trim()); return r ? toVault(r) : null; },
  create(userId: string, f: VaultFields): VaultRecord {
    const id = newId("vlt");
    q.run("INSERT INTO vault (id, user_id, kind, name, site, username, password_enc, note, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, userId, f.kind ?? "login", f.name, f.site, f.username, f.passwordEnc, f.note, metaOf(f), now());
    forgetSecrets(userId);
    return vault.owned(userId, id)!;
  },
  update(id: string, f: VaultFields) {
    const owner = q.get<{ user_id: string; kind: string }>("SELECT user_id, kind FROM vault WHERE id = ?", id);
    const kind = f.kind ?? (owner?.kind as VaultKind | undefined) ?? "login";
    q.run("UPDATE vault SET kind = ?, name = ?, site = ?, username = ?, password_enc = ?, note = ?, meta = ? WHERE id = ?", kind, f.name, f.site, f.username, f.passwordEnc, f.note, metaOf({ ...f, kind }), id);
    if (owner) forgetSecrets(owner.user_id);
  },
  remove: (id: string) => {
    const owner = q.get<{ user_id: string }>("SELECT user_id FROM vault WHERE id = ?", id);
    q.run("DELETE FROM vault WHERE id = ?", id);
    if (owner) forgetSecrets(owner.user_id);
  },
};

/**
 * Every value saved in a user's vault (passwords, keys, TOTP seeds), unsealed once and kept in memory until the vault
 * changes, so that whatever is written to a chat or handed to a model can be checked against them cheaply.
 */
const secretCache = new Map<string, string[]>();
let unsealFn: ((s: string) => string | null) | null = null;
/** auth.ts registers its unseal() here (store.ts cannot import auth.ts, which imports it). */
export const setUnsealer = (fn: (s: string) => string | null) => { unsealFn = fn; };
function forgetSecrets(userId: string) { secretCache.delete(userId); }
function secretsOf(userId: string): string[] {
  let list = secretCache.get(userId);
  if (!list) {
    list = q.all<{ password_enc: string | null }>("SELECT password_enc FROM vault WHERE user_id = ? AND password_enc IS NOT NULL", userId)
      .map((r) => (r.password_enc && unsealFn ? unsealFn(r.password_enc) : null))
      // A card is sealed as JSON: its number (as typed, and without spaces) is what must never be shown.
      .flatMap((v): (string | null)[] => { const card = v && v.startsWith("{\"card\"") ? safeJson(v) as { number?: string } | null : null; return card?.number ? [card.number, card.number.replace(/\D/g, "")] : [v]; })
      .filter((v): v is string => !!v && v.length >= 4)
      // Longest first, so a value that contains another is hidden whole.
      .sort((a, b) => b.length - a.length);
    secretCache.set(userId, list);
  }
  return list;
}
/** Exact-match redaction of every vault value of this user. */
/**
 * Short-lived secrets that are not in the vault, e.g. a sign-in code fetched from the mailbox and typed by the server
 * (email_code_type): hidden from anything a model sees for a while, like vault values.
 */
const transient = new Map<string, { value: string; until: number }[]>();
export function hideForAWhile(userId: string, value: string, ms = 30 * 60_000) {
  if (!value || value.length < 4) return;
  const list = (transient.get(userId) ?? []).filter((e) => e.until > now());
  list.push({ value, until: now() + ms });
  transient.set(userId, list);
}
export function redactSecrets(userId: string, text: string): string {
  if (!text) return text;
  let out = text;
  for (const secret of secretsOf(userId)) if (out.includes(secret)) out = out.split(secret).join("[hidden]");
  for (const e of transient.get(userId) ?? []) if (e.until > now() && out.includes(e.value)) out = out.split(e.value).join("[hidden]");
  return out;
}
/** A chat row with any vault value replaced, wherever text can appear in it. */
function scrub(userId: string, body: RowBody): RowBody {
  if (!secretsOf(userId).length) return body;
  const r = (s: string) => redactSecrets(userId, s);
  switch (body.kind) {
    case "message": return { ...body, text: r(body.text) };
    case "notice": case "event": return { ...body, text: r(body.text) };
    case "step": return { ...body, summary: body.summary === undefined ? undefined : r(body.summary), args: Object.fromEntries(Object.entries(body.args).map(([k, v]) => [k, typeof v === "string" ? r(v) : v])) };
    case "card": return body.card.type === "approval" ? { ...body, card: { ...body.card, detail: r(body.card.detail) } } : body;
  }
}

export const account = {
  setPassword: (userId: string, passHash: string) => q.run("UPDATE users SET pass_hash = ? WHERE id = ?", passHash, userId),
  dropOtherSessions: (userId: string, keepHash: string) => q.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", userId, keepHash),
  remove: (userId: string) => q.run("DELETE FROM users WHERE id = ?", userId),
};

// ── Activity log ─────────────────────────────────────────────────────────────
export function audit(userId: string, kind: AuditEntry["kind"], text: string, botId: string | null = null) {
  try { q.run("INSERT INTO audit (user_id, at, bot_id, kind, text) VALUES (?, ?, ?, ?, ?)", userId, now(), botId, kind, clip(text, 500)); } catch { /* logging must never break the action it records */ }
}
export function auditList(userId: string, before?: number, limit = 50): AuditEntry[] {
  const lim = Math.min(Math.max(1, limit), 200);
  const found = before
    ? q.all("SELECT * FROM audit WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?", userId, before, lim)
    : q.all("SELECT * FROM audit WHERE user_id = ? ORDER BY id DESC LIMIT ?", userId, lim);
  return found.map((r: any) => ({ id: r.id, at: r.at, botId: r.bot_id, kind: r.kind, text: r.text }));
}

// ── Search across every conversation, current and earlier ────────────────────
export function searchMessages(userId: string, query: string, opts: { botId?: string; limit?: number } = {}): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const like = words.map(() => "LOWER(json_extract(r.body, '$.text')) LIKE ? ESCAPE '\\'").join(" AND ");
  const params = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const found = q.all<any>(
    `SELECT r.bot_id, r.generation, r.seq, r.thread, r.created_at, r.body, b.name, b.generation AS cur FROM rows r JOIN bots b ON b.id = r.bot_id
     WHERE b.user_id = ? AND b.hidden = 0 ${opts.botId ? "AND b.id = ?" : ""} AND r.kind = 'message' AND ${like} ORDER BY r.created_at DESC LIMIT ?`,
    userId, ...(opts.botId ? [opts.botId] : []), ...params, Math.min(opts.limit ?? 40, 40));
  return found.map((r) => {
    const body = JSON.parse(r.body);
    const text: string = body.text ?? "";
    const at = Math.max(0, text.toLowerCase().indexOf(words[0]));
    return {
      botId: r.bot_id, botName: r.name, generation: r.generation, current: r.generation === r.cur, seq: r.seq, at: r.created_at, role: body.role, ...(r.thread ? { thread: r.thread } : {}),
      snippet: (at > 80 ? "…" : "") + text.slice(Math.max(0, at - 80), at + 220).replace(/\s+/g, " ") + (text.length > at + 220 ? "…" : ""),
    };
  });
}

// ── Pages published at a public address ──────────────────────────────────────
export interface PageRecord extends SharedPage { userId: string; path: string }
const toPage = (r: any, base: string): PageRecord => ({ token: r.token, botId: r.bot_id, userId: r.user_id, title: r.title, path: r.path, url: `${base}/p/${r.token}`, createdAt: r.created_at, visibility: r.visibility === "private" ? "private" : "link" });
export const pages = {
  list: (userId: string, base: string) => q.all("SELECT * FROM pages WHERE user_id = ? ORDER BY created_at DESC", userId).map((r) => toPage(r, base)),
  byToken: (token: string, base: string) => { const r = q.get("SELECT * FROM pages WHERE token = ?", token); return r ? toPage(r, base) : null; },
  forPath: (botId: string, path: string, base: string) => { const r = q.get("SELECT * FROM pages WHERE bot_id = ? AND path = ?", botId, path); return r ? toPage(r, base) : null; },
  create(bot: { id: string; userId: string }, title: string, path: string, base: string, visibility: SharedPage["visibility"] = "link"): PageRecord {
    const token = randomToken(18);
    q.run("INSERT INTO pages (token, bot_id, user_id, title, path, created_at, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)", token, bot.id, bot.userId, clip(title, 120), path, now(), visibility);
    return pages.byToken(token, base)!;
  },
  setVisibility: (token: string, visibility: SharedPage["visibility"]) => q.run("UPDATE pages SET visibility = ? WHERE token = ?", visibility, token),
  retitle: (token: string, title: string) => q.run("UPDATE pages SET title = ? WHERE token = ?", clip(title, 120), token),
  remove: (userId: string, token: string) => q.run("DELETE FROM pages WHERE token = ? AND user_id = ?", token, userId),
};

// ── Turns under way (to notice the ones a restart cut off) ───────────────────
/**
 * A bot's queue, kept on disk (bot_queue) so that work waiting behind a turn survives a restart. The order of rows (id)
 * is the order of the queue. Done rows are kept a week, then dropped (prune).
 */
export interface QueuedWork { id: number; bot_id: string; trigger: string; status: "pending" | "running" | "deferred" | "held" | "limited" | "done" }
export const botQueue = {
  /** Writes a job; null when it cannot be written (a bot that is not in the database): it then runs from memory only. */
  add(botId: string, trigger: unknown): number | null {
    try { return Number(q.run("INSERT INTO bot_queue (bot_id, trigger, created_at) VALUES (?, ?, ?)", botId, JSON.stringify(trigger), now()).lastInsertRowid); } catch { return null; }
  },
  start: (id: number) => q.run("UPDATE bot_queue SET status = 'running', started_at = ? WHERE id = ?", now(), id),
  /** Done, unless it was set aside meanwhile (deferred, or waiting for the subscription: limited). */
  finish: (id: number) => q.run("UPDATE bot_queue SET status = 'done', done_at = ? WHERE id = ? AND status NOT IN ('deferred', 'limited')", now(), id),
  done: (id: number) => q.run("UPDATE bot_queue SET status = 'done', done_at = ? WHERE id = ?", now(), id),
  defer: (id: number) => q.run("UPDATE bot_queue SET status = 'deferred' WHERE id = ?", id),
  /** Puts other work in a row's place, back to pending (the turn a restart cut off becomes its recovery, in its place). */
  replace: (id: number, trigger: unknown) => q.run("UPDATE bot_queue SET trigger = ?, status = 'pending', started_at = NULL WHERE id = ?", JSON.stringify(trigger), id),
  unfinished: () => q.all<QueuedWork>("SELECT id, bot_id, trigger, status FROM bot_queue WHERE status IN ('pending', 'running', 'deferred', 'held') ORDER BY id"),
  /** "Pause" (agent/pause.ts): work that came for a paused bot is set aside, in its order, until the bot is resumed. */
  hold: (id: number) => q.run("UPDATE bot_queue SET status = 'held', started_at = NULL WHERE id = ?", id),
  /** The work set aside for a bot while it was paused, oldest first. */
  heldFor: (botId: string) => q.all<QueuedWork>("SELECT id, bot_id, trigger, status FROM bot_queue WHERE bot_id = ? AND status = 'held' ORDER BY id", botId),
  /** Back to pending (the bot was resumed): it runs again, in its place. */
  unhold: (id: number) => q.run("UPDATE bot_queue SET status = 'pending' WHERE id = ? AND status = 'held'", id),
  /** The subscription is at its usage limit and there is no backup model (agent/sublimit.ts): the work waits, in its order. */
  limit: (id: number) => q.run("UPDATE bot_queue SET status = 'limited', started_at = NULL WHERE id = ?", id),
  /** The work of a bot that waits for its subscription, oldest first. */
  limitedFor: (botId: string) => q.all<QueuedWork>("SELECT id, bot_id, trigger, status FROM bot_queue WHERE bot_id = ? AND status = 'limited' ORDER BY id", botId),
  /** The bots with work waiting for their subscription. */
  limitedBots: () => q.all<{ bot_id: string; n: number }>("SELECT bot_id, COUNT(*) AS n FROM bot_queue WHERE status = 'limited' GROUP BY bot_id"),
  /** Back to pending (the subscription is back): it runs again, in its place. */
  unlimit: (id: number) => q.run("UPDATE bot_queue SET status = 'pending' WHERE id = ? AND status = 'limited'", id),
  status: (id: number) => q.get<{ status: QueuedWork["status"] }>("SELECT status FROM bot_queue WHERE id = ?", id)?.status ?? null,
  prune: (olderThanMs = 7 * 86_400_000) => q.run("DELETE FROM bot_queue WHERE status = 'done' AND done_at < ?", now() - olderThanMs),
};

export const activeTurns = {
  begin: (botId: string) => q.run("INSERT INTO active_turns (bot_id, started_at) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET started_at = excluded.started_at, acted = 0", botId, now()),
  acted: (botId: string) => q.run("UPDATE active_turns SET acted = 1 WHERE bot_id = ?", botId),
  end: (botId: string) => q.run("DELETE FROM active_turns WHERE bot_id = ?", botId),
  leftover: () => q.all<{ bot_id: string; acted: number }>("SELECT bot_id, acted FROM active_turns"),
};

// ── A bot's changes to its own settings (self_update), for undo ─────────────
export interface RevisionRecord { id: string; botId: string; before: Record<string, unknown>; after: Record<string, unknown>; createdAt: number; undoneAt: number | null }
const toRevision = (r: any): RevisionRecord => ({ id: r.id, botId: r.bot_id, before: JSON.parse(r.before), after: JSON.parse(r.after), createdAt: r.created_at, undoneAt: r.undone_at ?? null });
export const revisions = {
  create(botId: string, before: Record<string, unknown>, after: Record<string, unknown>): RevisionRecord {
    const id = newId("rev");
    q.run("INSERT INTO bot_revisions (id, bot_id, before, after, created_at) VALUES (?, ?, ?, ?, ?)", id, botId, JSON.stringify(before), JSON.stringify(after), now());
    return revisions.byId(id)!;
  },
  byId: (id: string) => { const r = q.get("SELECT * FROM bot_revisions WHERE id = ?", id); return r ? toRevision(r) : null; },
  markUndone: (id: string) => q.run("UPDATE bot_revisions SET undone_at = ? WHERE id = ?", now(), id),
};

// ── Reminders already sent for work left waiting ─────────────────────────────
export const stuckReminders = {
  /** Records the reminder; false when it was already sent (so each piece of waiting work is reminded once). */
  claim: (botId: string, key: string) => Number(q.run("INSERT OR IGNORE INTO stuck_reminders (bot_id, key, at) VALUES (?, ?, ?)", botId, key, now()).changes) > 0,
};

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
