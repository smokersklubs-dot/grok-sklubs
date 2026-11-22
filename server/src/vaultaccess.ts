import { q } from "./db.js";
import { audit, bots, now, vault, type BotRecord } from "./store.js";
import type { BuiltinTool } from "./agent/tools.js";

/**
 * L41 — finer rules for each vault item (Rakazo, Noah audits).
 *
 *  - Allowed bots: an item may be reserved to some of the owner's bots. Empty list (the default): any of their bots, as
 *    before. A bot that is not on the list cannot use it: the tool refuses without a card (and the bot is told who to
 *    ask), and the credential relay of its computer answers 403.
 *  - « Demander à chaque fois »: every use asks the owner on a card, single use, whatever was allowed before ("Always"
 *    and "for this conversation" are not offered for it).
 *  - Usage history: each use by a bot (tool, host, result) is kept for 90 days, 200 lines per item at most; the owner
 *    reads it in Settings → Vault. Never the value.
 *  - CSV import already exists (vault-import.ts, Bitwarden / 1Password / generic): nothing new here.
 *
 * The rules are wrapped around the vault tools where they are defined (tools.ts, payments.ts, mycomputer.ts:
 * `guardVault`), so every tool that takes an item by name goes through them. Additive tables created here.
 */
q.run(`CREATE TABLE IF NOT EXISTS vault_access (item_id TEXT PRIMARY KEY REFERENCES vault(id) ON DELETE CASCADE, bots TEXT NOT NULL DEFAULT '[]', ask_every INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS vault_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL REFERENCES vault(id) ON DELETE CASCADE, user_id TEXT NOT NULL, bot_id TEXT, bot_name TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL, host TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL, at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS vault_usage_item ON vault_usage (item_id, at)");

export interface VaultAccess { bots: string[]; askEveryTime: boolean }
export interface VaultUse { botId: string | null; botName: string; tool: string; host: string; ok: boolean; at: number }
const KEEP_MS = 90 * 24 * 3600_000;
const KEEP_ROWS = 200;

export const vaultAccess = {
  get(itemId: string): VaultAccess {
    const r = q.get<{ bots: string; ask_every: number }>("SELECT bots, ask_every FROM vault_access WHERE item_id = ?", itemId);
    let list: string[] = [];
    try { list = r ? (JSON.parse(r.bots) as unknown[]).filter((x): x is string => typeof x === "string") : []; } catch { /* unreadable: no restriction */ }
    return { bots: list, askEveryTime: !!r?.ask_every };
  },
  /** Only the owner's own visible bots can be listed (others are dropped). */
  set(userId: string, itemId: string, f: { bots?: unknown; askEveryTime?: unknown }): VaultAccess {
    const cur = vaultAccess.get(itemId);
    const list = f.bots === undefined ? cur.bots : (Array.isArray(f.bots) ? f.bots : []).map(String).filter((id, i, a) => a.indexOf(id) === i && bots.byId(id)?.userId === userId).slice(0, 50);
    const ask = f.askEveryTime === undefined ? cur.askEveryTime : f.askEveryTime === true;
    q.run("INSERT INTO vault_access (item_id, bots, ask_every, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET bots = excluded.bots, ask_every = excluded.ask_every, updated_at = excluded.updated_at", itemId, JSON.stringify(list), ask ? 1 : 0, now());
    audit(userId, "vault", `Vault item rules changed: ${list.length ? `${list.length} bot(s) allowed` : "any bot"}${ask ? ", ask every time" : ""}`);
    return { bots: list, askEveryTime: ask };
  },
  /** Whether this bot may use this item at all. */
  allowed: (itemId: string, botId: string) => { const a = vaultAccess.get(itemId); return !a.bots.length || a.bots.includes(botId); },
  note(itemId: string, userId: string, bot: Pick<BotRecord, "id" | "name"> | null, tool: string, host: string, ok: boolean) {
    q.run("INSERT INTO vault_usage (item_id, user_id, bot_id, bot_name, tool, host, ok, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", itemId, userId, bot?.id ?? null, bot?.name ?? "", tool, host.slice(0, 200), ok ? 1 : 0, now());
    q.run("DELETE FROM vault_usage WHERE item_id = ? AND (at < ? OR id NOT IN (SELECT id FROM vault_usage WHERE item_id = ? ORDER BY at DESC, id DESC LIMIT ?))", itemId, now() - KEEP_MS, itemId, KEEP_ROWS);
  },
  history(itemId: string, limit = 50): VaultUse[] {
    return q.all<any>("SELECT * FROM vault_usage WHERE item_id = ? ORDER BY at DESC, id DESC LIMIT ?", itemId, Math.min(KEEP_ROWS, limit))
      .map((r) => ({ botId: r.bot_id, botName: r.bot_name, tool: r.tool, host: r.host, ok: !!r.ok, at: r.at }));
  },
};

/** Which argument names the vault item, per tool. */
export const VAULT_ARG: Record<string, string> = { secret_use: "secret", vault_type: "item", totp_code: "item", card_fill: "card", my_vault_fill: "item" };
const hostIn = (a: Record<string, unknown>) => { try { return new URL(String(a.url ?? "")).hostname.toLowerCase(); } catch { return ""; } };

/** The refusal a bot gets for an item reserved to other bots (English: the model reads it). */
export const reservedLine = (name: string) => `The vault item "${name}" is reserved for other bots by the owner. It was not used. Ask the owner if this bot should have it (Settings → Vault → the item → Allowed bots).`;

/**
 * The vault tools of one list, with the rules above: a reserved item is refused before any card (gate: none, run: the
 * refusal); "ask every time" makes the tool's card strict and single use (or adds one where the tool has none); each run
 * is written to the item's history.
 */
export function guardVault(tools: BuiltinTool[]): BuiltinTool[] {
  return tools.map((t) => {
    const arg = VAULT_ARG[t.spec.name];
    if (!arg) return t;
    const itemOf = (a: Record<string, unknown>, botId: string) => { const owner = bots.byId(botId)?.userId; return owner ? vault.byName(owner, String(a[arg] ?? "")) : null; };
    const gate: BuiltinTool["gate"] = (a, ctx) => {
      const item = itemOf(a, ctx.botId);
      if (item && !vaultAccess.allowed(item.id, ctx.botId)) return null; // refused by run, without asking anyone
      const base = t.gate?.(a, ctx) ?? null;
      if (!item || !vaultAccess.get(item.id).askEveryTime) return base;
      return base ? { ...base, strict: true, once: true }
        : { key: `vault every time: ${item.name}`, strict: true, once: true, source: "Vault", title: "Allow {bot} to use {item} from the vault?", reason: "use {item} from the vault", vars: { item: item.name }, note: "Set to \"ask every time\" in the vault." };
    };
    return {
      ...t, gate,
      run: async (a, c) => {
        const item = vault.byName(c.user.id, String(a[arg] ?? ""));
        if (item && !vaultAccess.allowed(item.id, c.bot.id)) { vaultAccess.note(item.id, c.user.id, c.bot, t.spec.name, hostIn(a), false); return { content: reservedLine(item.name), isError: true, summary: "reserved" }; }
        const out = await t.run(a, c);
        if (item) vaultAccess.note(item.id, c.user.id, c.bot, t.spec.name, hostIn(a), !out.isError);
        return out;
      },
    };
  });
}
