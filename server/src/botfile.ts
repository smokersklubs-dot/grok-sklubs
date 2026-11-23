import { botStyle, setBotStyle, BOT_STYLES } from "./botstyle.js";
import { AVATAR_COLORS, AVATAR_SHAPES } from "./shared.js";
import { bots, memories, skills, type BotRecord } from "./store.js";

/**
 * L144 « Exporter / Importer un bot » (backlog A-FAIRE): one bot in one JSON file — its identity, look, instructions,
 * style, notes and skills. Never in the file: secrets, connections, channel tokens, its conversations, its computer.
 * On import a NEW bot is made (plan and team limits apply); its skills come in as drafts to check and switch on
 * (like every skill that comes from outside), its notes as imported notes; the model is the account's usual one.
 */
export const BOT_FILE_FORMAT = "sklubot-bot";
export const BOT_FILE_VERSION = 1;
export const BOT_FILE_LIMITS = { memories: 500, skills: 100, text: 8000, skillBody: 40_000 };
export class BotFileError extends Error {}

export interface BotFile {
  format: typeof BOT_FILE_FORMAT; version: number; exportedAt: string;
  bot: { name: string; label: string; description: string; instructions: string; shape: string; color: string; mode: string; effort: string; style: string };
  memories: { text: string }[];
  skills: { name: string; description: string; body: string }[];
}

export function exportBot(bot: BotRecord): BotFile {
  return {
    format: BOT_FILE_FORMAT, version: BOT_FILE_VERSION, exportedAt: new Date().toISOString(),
    bot: { name: bot.name, label: bot.label, description: bot.description, instructions: bot.instructions, shape: bot.shape, color: bot.color, mode: bot.mode, effort: bot.effort, style: botStyle(bot.id) },
    memories: memories.list(bot.id, BOT_FILE_LIMITS.memories).filter((m) => m.status !== "archived").map((m) => ({ text: m.text })),
    skills: skills.list(bot.id).filter((s) => s.botId === bot.id).slice(0, BOT_FILE_LIMITS.skills).map((s) => ({ name: s.name, description: s.description, body: s.body })),
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Reads a bot file (already parsed JSON) and makes the bot. Throws BotFileError with a readable reason. */
export function importBot(userId: string, raw: unknown): BotRecord {
  const f = raw as Partial<BotFile> | null;
  if (!f || typeof f !== "object" || f.format !== BOT_FILE_FORMAT) throw new BotFileError("This is not a Sklubot bot file.");
  if (typeof f.version !== "number" || f.version > BOT_FILE_VERSION) throw new BotFileError("This bot file comes from a newer Sklubot: update first.");
  const b = (f.bot ?? {}) as Partial<BotFile["bot"]>;
  const name = str(b.name, 60).trim();
  if (!name) throw new BotFileError("The bot in this file has no name.");
  const taken = bots.byName(userId, name);
  const bot = bots.create(userId, {
    name: taken ? `${name.slice(0, 54)} (2)` : name, label: str(b.label, 60), description: str(b.description, 500), instructions: str(b.instructions, BOT_FILE_LIMITS.text),
    shape: (AVATAR_SHAPES as readonly string[]).includes(b.shape ?? "") ? (b.shape as BotRecord["shape"]) : undefined,
    color: (AVATAR_COLORS as readonly string[]).includes(b.color ?? "") ? (b.color as BotRecord["color"]) : undefined,
    mode: b.mode === "teammate" ? "teammate" : "personal", effort: str(b.effort, 10) as BotRecord["effort"],
  });
  if ((BOT_STYLES as readonly string[]).includes(b.style ?? "")) setBotStyle(bot.id, b.style);
  for (const m of (Array.isArray(f.memories) ? f.memories : []).slice(0, BOT_FILE_LIMITS.memories)) {
    const text = str(m?.text, 2000).trim();
    if (text) memories.add(bot.id, text, "import");
  }
  for (const s of (Array.isArray(f.skills) ? f.skills : []).slice(0, BOT_FILE_LIMITS.skills)) {
    const sname = str(s?.name, 80).trim(), body = str(s?.body, BOT_FILE_LIMITS.skillBody);
    if (sname && body.trim()) skills.create(bot.id, sname, str(s?.description, 500), body, false, { draft: true });
  }
  return bots.byId(bot.id)!;
}
