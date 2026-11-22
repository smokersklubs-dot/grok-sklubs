import { q } from "./db.js";
import { findSecrets } from "./shared.js";

/**
 * L152 « Commandes personnelles »: the owner's own `/` shortcuts in the web chat — a short name and the words it stands
 * for (« /bilan » → « Fais-moi le bilan de la semaine… »). Typing `/` in the composer lists them; picking one puts its
 * words in the box, to read and send (nothing is sent on its own). One list per account, kept here (ideas from Hermes,
 * Agent Zero, Rakazo; our own code). A command's words may not carry a secret: they are typed in plain view and sent in
 * plain text.
 */
q.run(`CREATE TABLE IF NOT EXISTS personal_commands (
  user_id TEXT PRIMARY KEY, list TEXT NOT NULL, updated_at INTEGER NOT NULL
)`);

export interface PersonalCommand { name: string; text: string }
export const COMMAND_LIMITS = { count: 30, name: 24, text: 2000 } as const;
/** Names taken by the app itself. */
export const RESERVED_COMMANDS = ["skill", "s", "sk", "ski", "skil"] as const;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The list, checked: an error sentence (English, translated by the route) or the clean list. */
export function cleanCommands(raw: unknown): { ok: true; list: PersonalCommand[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "commands must be a list." };
  if (raw.length > COMMAND_LIMITS.count) return { ok: false, error: `At most ${COMMAND_LIMITS.count} commands.` };
  const seen = new Set<string>();
  const list: PersonalCommand[] = [];
  for (const item of raw) {
    const name = String((item as PersonalCommand)?.name ?? "").trim().replace(/^\//, "").toLowerCase();
    const text = String((item as PersonalCommand)?.text ?? "").trim();
    if (!name || name.length > COMMAND_LIMITS.name || !NAME.test(name)) return { ok: false, error: "A command name is 1 to 24 letters, digits or dashes." };
    if ((RESERVED_COMMANDS as readonly string[]).includes(name)) return { ok: false, error: "That command name is taken by the app." };
    if (seen.has(name)) return { ok: false, error: "Two commands have the same name." };
    if (!text || text.length > COMMAND_LIMITS.text) return { ok: false, error: "A command's words are 1 to 2000 characters." };
    if (findSecrets(text).length) return { ok: false, error: "A command's words may not contain a password or key." };
    seen.add(name);
    list.push({ name, text });
  }
  return { ok: true, list };
}

export const personalCommands = {
  list(userId: string): PersonalCommand[] {
    const r = q.get<{ list: string }>("SELECT list FROM personal_commands WHERE user_id = ?", userId);
    try { return r ? (JSON.parse(r.list) as PersonalCommand[]) : []; } catch { return []; }
  },
  save(userId: string, list: PersonalCommand[]) {
    q.run("INSERT INTO personal_commands (user_id, list, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET list = excluded.list, updated_at = excluded.updated_at", userId, JSON.stringify(list), Date.now());
  },
};
