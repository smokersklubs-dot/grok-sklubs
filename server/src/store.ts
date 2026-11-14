import { createHash, randomBytes, randomUUID } from "node:crypto";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { tr } from "./i18n.js";
import type { ChatMessage } from "./llm/types.js";
import {
  AVATAR_COLORS, AVATAR_SHAPES,
  ACCESSORIES, CHARACTER_TYPES, DEFAULT_CHARACTER, EYE_STYLES, IDLE_MOTIONS, TOOL_GROUPS, type AuditEntry, type Character, type Bot, type Card, type CheckinSettings, type Locale, type Memory, type SearchHit, type SharedPage, type VaultItem, type Policy, type Row, type RowBody, type Skill, type Task, type User,
} from "./shared.js";

export const now = () => Date.now();
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
    return tr(locale, "Connect {name}", { name: c.name });
  }
  return "";
}

function toBot(r: any): BotRecord {
  const last = q.get<{ body: string; created_at: number }>(
    "SELECT body, created_at FROM rows WHERE bot_id = ? AND generation = ? AND kind IN ('message','card','event') ORDER BY seq DESC LIMIT 1",
    r.id, r.generation,
  );
  const voice = { name: "", rate: 1, lang: "auto", ...JSON.parse(r.voice || "{}") };
  return {
    id: r.id, userId: r.user_id, kind: r.kind, name: r.name, label: r.label, description: r.description,
    instructions: r.instructions, shape: r.shape, color: r.color, mode: r.mode, primary: !!r.is_primary,
    effort: r.effort, model: r.model, autonomy: r.autonomy, voice, generation: r.generation, unread: r.unread,
    character: cleanCharacter(JSON.parse(r.character || "{}")),
    roomRule: r.room_rule === "everyone" || r.room_rule === "mentions" ? r.room_rule : "lead",
    disabledTools: JSON.parse(r.disabled_tools || "[]"), telegram: r.telegram_username ?? null,
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
  };
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
  effort: ["low", "medium", "high", "xhigh"], autonomy: ["careful", "balanced", "trusted"],
};
const LIMITS: Record<string, number> = { name: 60, label: 60, description: 500, instructions: 8000, model: 120 };

export const bots = {
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
    const id = newId("bot");
    const name = (input.name ?? "").trim().slice(0, 60) || "New bot";
    const shape = AVATAR_SHAPES.includes(input.shape as any) ? input.shape! : stablePick(id + "s", AVATAR_SHAPES);
    const color = AVATAR_COLORS.includes(input.color as any) ? input.color! : stablePick(id + "c", AVATAR_COLORS.filter((c) => c !== "ink"));
    const t = now();
    q.run(
      `INSERT INTO bots (id, user_id, kind, name, label, description, instructions, shape, color, mode, effort, model, autonomy, hidden, parent_id, members, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, userId, input.kind ?? "agent", name, (input.label ?? "").slice(0, 60), (input.description ?? "").slice(0, 500),
      (input.instructions ?? "").slice(0, 8000), shape, color, input.mode === "teammate" ? "teammate" : "personal",
      ENUMS.effort.includes(input.effort ?? "") ? input.effort! : "medium", input.model ?? "",
      ENUMS.autonomy.includes(input.autonomy ?? "") ? input.autonomy! : "careful",
      input.hidden ? 1 : 0, input.parentId ?? null, JSON.stringify(input.memberIds ?? []), t, t,
    );
    if (input.character) bots.patch(id, { character: input.character });
    if (input.primary) bots.makePrimary(userId, id);
    return bots.byId(id)!;
  },
  /** Applies a validated partial update; unknown fields and invalid enum values are ignored. */
  patch(id: string, patch: Record<string, unknown>) {
    const sets: string[] = [];
    const vals: (string | number)[] = [];
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
      sets.push("voice = ?");
      vals.push(JSON.stringify({
        name: typeof v.name === "string" ? v.name.slice(0, 120) : "",
        rate: Number.isFinite(rate) ? Math.min(1.5, Math.max(0.7, rate)) : 1,
        lang: typeof v.lang === "string" ? v.lang.slice(0, 20) : "auto",
      }));
    }
    if (patch.character && typeof patch.character === "object") {
      const cur = q.get<{ character: string }>("SELECT character FROM bots WHERE id = ?", id);
      sets.push("character = ?");
      vals.push(JSON.stringify(cleanCharacter(patch.character, cleanCharacter(JSON.parse(cur?.character || "{}")))));
    }
    if (Array.isArray(patch.memberIds)) { sets.push("members = ?"); vals.push(JSON.stringify(patch.memberIds)); }
    if (patch.roomRule === "lead" || patch.roomRule === "everyone" || patch.roomRule === "mentions") { sets.push("room_rule = ?"); vals.push(patch.roomRule); }
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
  bumpUnread(id: string) { q.run("UPDATE bots SET unread = unread + 1 WHERE id = ?", id); },
  remove(id: string) { q.run("DELETE FROM bots WHERE id = ? OR parent_id = ?", id, id); },
  resetConversation(id: string): number {
    q.run("UPDATE bots SET generation = generation + 1, next_seq = 1, unread = 0, updated_at = ? WHERE id = ?", now(), id);
    q.run("DELETE FROM paused WHERE bot_id = ?", id);
    return bots.byId(id)!.generation;
  },
  announce(b: BotRecord | null) { if (b && !b.hidden) emit(b.userId, { type: "bot", bot: publicBot(bots.byId(b.id)!) }); },
};

// ── Transcript rows ──────────────────────────────────────────────────────────
const toRow = (r: any): Row => ({ botId: r.bot_id, generation: r.generation, seq: r.seq, rev: r.rev, createdAt: r.created_at, body: JSON.parse(r.body) });

export const rows = {
  append(bot: { id: string; userId: string }, body: RowBody): Row {
    const row = q.tx(() => {
      const b = q.get<{ generation: number; next_seq: number; rev: number }>("SELECT generation, next_seq, rev FROM bots WHERE id = ?", bot.id);
      if (!b) throw new Error("bot no longer exists");
      const t = now();
      q.run("INSERT INTO rows (bot_id, generation, seq, rev, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", bot.id, b.generation, b.next_seq, b.rev + 1, body.kind, JSON.stringify(body), t);
      q.run("UPDATE bots SET next_seq = next_seq + 1, rev = rev + 1, updated_at = ? WHERE id = ?", t, bot.id);
      return { botId: bot.id, generation: b.generation, seq: b.next_seq, rev: b.rev + 1, createdAt: t, body } satisfies Row;
    });
    emit(bot.userId, { type: "rows", botId: bot.id, generation: row.generation, rows: [row] });
    return row;
  },
  /** Rewrites a row in place with a higher revision so clients replace their copy. */
  rewrite(bot: { id: string; userId: string }, generation: number, seq: number, body: RowBody): Row | null {
    const row = q.tx(() => {
      const cur = q.get("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND seq = ?", bot.id, generation, seq);
      const b = q.get<{ rev: number }>("SELECT rev FROM bots WHERE id = ?", bot.id);
      if (!cur || !b) return null;
      q.run("UPDATE rows SET body = ?, rev = ? WHERE bot_id = ? AND generation = ? AND seq = ?", JSON.stringify(body), b.rev + 1, bot.id, generation, seq);
      q.run("UPDATE bots SET rev = rev + 1, updated_at = ? WHERE id = ?", now(), bot.id);
      return { ...toRow(cur), rev: b.rev + 1, body };
    });
    if (row) emit(bot.userId, { type: "rows", botId: bot.id, generation, rows: [row] });
    return row;
  },
  get(botId: string, generation: number, seq: number): Row | null {
    const r = q.get("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND seq = ?", botId, generation, seq);
    return r ? toRow(r) : null;
  },
  list(botId: string, generation: number, limit = 200, before?: number): Row[] {
    const lim = Math.min(Math.max(1, limit), 500);
    const found = before
      ? q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND seq < ? ORDER BY seq DESC LIMIT ?", botId, generation, before, lim)
      : q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? ORDER BY seq DESC LIMIT ?", botId, generation, lim);
    return found.reverse().map(toRow);
  },
  recentMessages(botId: string, generation: number, limit: number): Row[] {
    return q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' ORDER BY seq DESC LIMIT ?", botId, generation, limit).reverse().map(toRow);
  },
  messagesAfter(botId: string, generation: number, after: number, limit: number): Row[] {
    return q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' AND created_at > ? ORDER BY seq DESC LIMIT ?", botId, generation, after, limit).reverse().map(toRow);
  },
  updateCard(bot: { id: string; userId: string }, generation: number, seq: number, change: (card: Card) => Card): Row | null {
    const row = rows.get(bot.id, generation, seq);
    if (!row || row.body.kind !== "card") return null;
    return rows.rewrite(bot, generation, seq, { kind: "card", card: change(row.body.card) });
  },
};

// ── Model-facing history ─────────────────────────────────────────────────────
export const history = {
  load(botId: string, generation: number): ChatMessage[] {
    return q.all<{ role: string; content: string }>("SELECT role, content FROM history WHERE bot_id = ? AND generation = ? ORDER BY id", botId, generation)
      .map((r) => ({ role: r.role as ChatMessage["role"], content: JSON.parse(r.content) }));
  },
  append(botId: string, generation: number, msg: ChatMessage) {
    q.run("INSERT INTO history (bot_id, generation, role, content) VALUES (?, ?, ?, ?)", botId, generation, msg.role, JSON.stringify(msg.content));
  },
  replace(botId: string, generation: number, msgs: ChatMessage[]) {
    q.tx(() => {
      q.run("DELETE FROM history WHERE bot_id = ? AND generation = ?", botId, generation);
      for (const m of msgs) history.append(botId, generation, m);
    });
  },
  count: (botId: string, generation: number) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM history WHERE bot_id = ? AND generation = ?", botId, generation)!.n,
};

// ── Memories, skills, tasks ──────────────────────────────────────────────────
const toMemory = (r: any): Memory => ({ id: r.id, botId: r.bot_id, text: r.text, source: r.source, createdAt: r.created_at });
export const memories = {
  list: (botId: string, limit = 500) => q.all("SELECT * FROM memories WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?", botId, limit).map(toMemory),
  add(botId: string, text: string, source: Memory["source"] = "chat"): Memory {
    const id = newId("mem");
    q.run("INSERT INTO memories (id, bot_id, text, source, created_at) VALUES (?, ?, ?, ?, ?)", id, botId, text.trim(), source, now());
    return toMemory(q.get("SELECT * FROM memories WHERE id = ?", id));
  },
  removeOwned(userId: string, id: string) {
    q.run("DELETE FROM memories WHERE id = ? AND bot_id IN (SELECT id FROM bots WHERE user_id = ?)", id, userId);
  },
};

const toSkill = (r: any): Skill => ({ id: r.id, botId: r.bot_id, name: r.name, description: r.description, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at });
export const skills = {
  list: (botId: string) => q.all("SELECT * FROM skills WHERE bot_id = ? ORDER BY created_at", botId).map(toSkill),
  owned(userId: string, id: string) {
    const r = q.get("SELECT s.* FROM skills s JOIN bots b ON b.id = s.bot_id WHERE s.id = ? AND b.user_id = ?", id, userId);
    return r ? toSkill(r) : null;
  },
  create(botId: string, name: string, description: string, body: string): Skill {
    const id = newId("skl");
    const t = now();
    q.run("INSERT INTO skills (id, bot_id, name, description, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, botId, name, description, body, t, t);
    return toSkill(q.get("SELECT * FROM skills WHERE id = ?", id));
  },
  update(id: string, f: { name: string; description: string; body: string }) {
    q.run("UPDATE skills SET name = ?, description = ?, body = ?, updated_at = ? WHERE id = ?", f.name, f.description, f.body, now(), id);
    return toSkill(q.get("SELECT * FROM skills WHERE id = ?", id));
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
export interface ApprovalRecord { id: string; botId: string; userId: string; seq: number; generation: number; tool: string; status: string }
const toApproval = (r: any): ApprovalRecord => ({ id: r.id, botId: r.bot_id, userId: r.user_id, seq: r.seq, generation: r.generation, tool: r.tool, status: r.status });
export const approvals = {
  create(botId: string, userId: string, generation: number, seq: number, tool: string, id = newId("apr")): ApprovalRecord {
    q.run("INSERT INTO approvals (id, bot_id, user_id, seq, generation, tool, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, botId, userId, seq, generation, tool, now());
    return approvals.byId(id)!;
  },
  byId: (id: string) => { const r = q.get("SELECT * FROM approvals WHERE id = ?", id); return r ? toApproval(r) : null; },
  resolve: (id: string, status: string) => q.run("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?", status, now(), id),
  pendingForUser: (userId: string) => q.all("SELECT * FROM approvals WHERE user_id = ? AND status = 'pending'", userId).map(toApproval),
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
  budget: (userId: string) => q.get<{ budget_usd: number | null }>("SELECT budget_usd FROM settings WHERE user_id = ?", userId)?.budget_usd ?? null,
  setBudget: (userId: string, usd: number | null) =>
    q.run("INSERT INTO settings (user_id, budget_usd) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET budget_usd = excluded.budget_usd", userId, usd),
};

// ── Vault: saved logins ──────────────────────────────────────────────────────
export interface VaultRecord extends VaultItem { userId: string; passwordEnc: string | null }
const toVault = (r: any): VaultRecord => ({ id: r.id, userId: r.user_id, name: r.name, site: r.site, username: r.username, hasPassword: !!r.password_enc, passwordEnc: r.password_enc, note: r.note, createdAt: r.created_at });
export const publicVault = ({ userId, passwordEnc, ...rest }: VaultRecord): VaultItem => rest;
export const vault = {
  list: (userId: string) => q.all("SELECT * FROM vault WHERE user_id = ? ORDER BY name COLLATE NOCASE", userId).map(toVault),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM vault WHERE id = ? AND user_id = ?", id, userId); return r ? toVault(r) : null; },
  byName(userId: string, name: string) { const r = q.get("SELECT * FROM vault WHERE user_id = ? AND name = ? COLLATE NOCASE", userId, name.trim()); return r ? toVault(r) : null; },
  create(userId: string, f: { name: string; site: string; username: string; passwordEnc: string | null; note: string }): VaultRecord {
    const id = newId("vlt");
    q.run("INSERT INTO vault (id, user_id, name, site, username, password_enc, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, userId, f.name, f.site, f.username, f.passwordEnc, f.note, now());
    return vault.owned(userId, id)!;
  },
  update(id: string, f: { name: string; site: string; username: string; passwordEnc: string | null; note: string }) {
    q.run("UPDATE vault SET name = ?, site = ?, username = ?, password_enc = ?, note = ? WHERE id = ?", f.name, f.site, f.username, f.passwordEnc, f.note, id);
  },
  remove: (id: string) => q.run("DELETE FROM vault WHERE id = ?", id),
};

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
    `SELECT r.bot_id, r.generation, r.seq, r.created_at, r.body, b.name, b.generation AS cur FROM rows r JOIN bots b ON b.id = r.bot_id
     WHERE b.user_id = ? AND b.hidden = 0 ${opts.botId ? "AND b.id = ?" : ""} AND r.kind = 'message' AND ${like} ORDER BY r.created_at DESC LIMIT ?`,
    userId, ...(opts.botId ? [opts.botId] : []), ...params, Math.min(opts.limit ?? 40, 40));
  return found.map((r) => {
    const body = JSON.parse(r.body);
    const text: string = body.text ?? "";
    const at = Math.max(0, text.toLowerCase().indexOf(words[0]));
    return {
      botId: r.bot_id, botName: r.name, generation: r.generation, current: r.generation === r.cur, seq: r.seq, at: r.created_at, role: body.role,
      snippet: (at > 80 ? "…" : "") + text.slice(Math.max(0, at - 80), at + 220).replace(/\s+/g, " ") + (text.length > at + 220 ? "…" : ""),
    };
  });
}

// ── Pages published at a public address ──────────────────────────────────────
export interface PageRecord extends SharedPage { userId: string; path: string }
const toPage = (r: any, base: string): PageRecord => ({ token: r.token, botId: r.bot_id, userId: r.user_id, title: r.title, path: r.path, url: `${base}/p/${r.token}`, createdAt: r.created_at });
export const pages = {
  list: (userId: string, base: string) => q.all("SELECT * FROM pages WHERE user_id = ? ORDER BY created_at DESC", userId).map((r) => toPage(r, base)),
  byToken: (token: string, base: string) => { const r = q.get("SELECT * FROM pages WHERE token = ?", token); return r ? toPage(r, base) : null; },
  forPath: (botId: string, path: string, base: string) => { const r = q.get("SELECT * FROM pages WHERE bot_id = ? AND path = ?", botId, path); return r ? toPage(r, base) : null; },
  create(bot: { id: string; userId: string }, title: string, path: string, base: string): PageRecord {
    const token = randomToken(18);
    q.run("INSERT INTO pages (token, bot_id, user_id, title, path, created_at) VALUES (?, ?, ?, ?, ?, ?)", token, bot.id, bot.userId, clip(title, 120), path, now());
    return pages.byToken(token, base)!;
  },
  retitle: (token: string, title: string) => q.run("UPDATE pages SET title = ? WHERE token = ?", clip(title, 120), token),
  remove: (userId: string, token: string) => q.run("DELETE FROM pages WHERE token = ? AND user_id = ?", token, userId),
};

// ── Turns under way (to notice the ones a restart cut off) ───────────────────
export const activeTurns = {
  begin: (botId: string) => q.run("INSERT INTO active_turns (bot_id, started_at) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET started_at = excluded.started_at, acted = 0", botId, now()),
  acted: (botId: string) => q.run("UPDATE active_turns SET acted = 1 WHERE bot_id = ?", botId),
  end: (botId: string) => q.run("DELETE FROM active_turns WHERE bot_id = ?", botId),
  leftover: () => q.all<{ bot_id: string; acted: number }>("SELECT bot_id, acted FROM active_turns"),
};

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
