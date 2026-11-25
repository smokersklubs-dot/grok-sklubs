import { builtinTools } from "./agent/tools.js";
import { connectorAllowedFor } from "./connectorbots.js";
import { connectors } from "./connectors.js";
import { TOOL_GROUPS, type ToolGroup } from "./shared.js";
import type { BotRecord } from "./store.js";

/**
 * L161 « Ce que ce bot peut lire et écrire » (last30days --preflight, idea only): one card derived from what the bot really
 * gets on its next turn — the same builtinTools() call the turn makes (agent/loop.ts) with its switched-off families, and
 * the apps (connectors) this bot may use (connectorbots.ts). Nothing is read or started to build it, and no secret value
 * is ever part of it. Each tool is sorted as:
 *   reads  read-only tools (marked `parallel`: never change anything)
 *   asks   tools that ask first: sensitive ones, a per-call approval, an app write (unless the user said « toujours »)
 *   acts   everything else (writes in its own library, its own computer, messages to teammates…)
 */
export interface ReachFamily { group: ToolGroup | "general"; reads: string[]; acts: string[]; asks: string[] }
export interface ReachApp { name: string; status: string; reads: number; writes: number }
export interface ReachCard { autonomy: string; families: ReachFamily[]; off: ToolGroup[]; apps: ReachApp[] }

export function reachCard(bot: BotRecord): ReachCard {
  const tools = builtinTools({ owner: bot.userId, disabled: bot.disabledTools });
  const fams = new Map<string, ReachFamily>();
  for (const t of tools) {
    const g = t.group ?? "general";
    const f = fams.get(g) ?? { group: g, reads: [], acts: [], asks: [] };
    const asks = !!(t.sensitive || t.gate || t.appWrite);
    (asks ? f.asks : t.parallel ? f.reads : f.acts).push(t.spec.name);
    fams.set(g, f);
  }
  const off = TOOL_GROUPS.filter((g) => bot.disabledTools.includes(g));
  const order = ["general", ...TOOL_GROUPS] as string[];
  const families = [...fams.values()].filter((f) => f.reads.length + f.acts.length + f.asks.length > 0)
    .map((f) => ({ ...f, reads: [...new Set(f.reads)].sort(), acts: [...new Set(f.acts)].sort(), asks: [...new Set(f.asks)].sort() }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const apps = off.includes("apps") ? [] : connectors.list(bot.userId).filter((c) => connectorAllowedFor(c.id, bot.id))
    .map((c) => ({ name: c.name, status: c.status, reads: c.tools.filter((t) => t.readOnly).length, writes: c.tools.filter((t) => !t.readOnly).length }));
  return { autonomy: bot.autonomy, families, off, apps };
}
