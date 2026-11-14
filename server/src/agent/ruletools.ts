import { emit } from "../bus.js";
import type { ToolSpec } from "../llm/types.js";
import { routines } from "../routines.js";
import { isRuleTrigger, MAX_RULES, ruleChanges, rules } from "../rules.js";
import type { Rule, RuleTrigger } from "../shared.js";
import { RULE_TRIGGERS } from "../shared.js";
import { audit, bots, clip, rows, users } from "../store.js";
import type { BuiltinTool } from "./tools.js";
import { tr } from "../i18n.js";

/**
 * The bot edits the user's rules from the chat (wave 5b): rule_propose adds, changes or removes one rule, for every bot,
 * one bot, one routine or a trigger kind. Never applied silently: the call always stops on an approval card showing the
 * exact text and its scope (a per-call gate, "Always" never offered), it needs the user's own words asking for it
 * (authorize.ts refuses it otherwise — also after outside content), and it is recorded as "added from the chat" with
 * those words, undoable in one click (Settings → Rules, or the line it leaves in the chat).
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

interface Resolved { botId: string | null; routineId: string | null; trigger: RuleTrigger | null; label: string }

/** Where the rule applies, from the call's scope fields. */
function scopeOf(userId: string, selfId: string, a: Record<string, any>): Resolved | string {
  const loc = users.localeOf(userId);
  const scope = String(a.scope ?? "account");
  if (scope === "account") return { botId: null, routineId: null, trigger: null, label: tr(loc, "every bot") };
  if (scope === "bot") {
    const b = a.bot ? bots.byName(userId, String(a.bot)) : bots.byId(selfId);
    if (!b || b.kind !== "agent") return `No bot is called "${a.bot}".`;
    return { botId: b.id, routineId: null, trigger: null, label: tr(loc, "the bot {name}", { name: b.name }) };
  }
  if (scope === "routine") {
    const name = String(a.routine ?? "").trim().toLowerCase();
    const r = bots.list(userId).flatMap((b) => routines.forBot(b.id)).find((x) => x.name.toLowerCase() === name || x.id === a.routine);
    if (!r) return `No routine is called "${a.routine}".`;
    return { botId: r.botId, routineId: r.id, trigger: null, label: tr(loc, "the routine “{name}”", { name: r.name }) };
  }
  if (scope === "trigger") {
    if (!isRuleTrigger(a.trigger)) return `trigger must be one of ${RULE_TRIGGERS.join(", ")}.`;
    return { botId: null, routineId: null, trigger: a.trigger, label: tr(loc, "routines started by: {kind}", { kind: tr(loc, `trigger:${a.trigger}`) }) };
  }
  return "scope must be account, bot, routine or trigger.";
}

/** The rule a change or removal is about: by id, or by its exact (or nearly exact) text. */
function findRule(userId: string, ref: string): Rule | null {
  const all = rules.all(userId);
  const n = ref.trim().toLowerCase();
  return all.find((r) => r.id === ref.trim()) ?? all.find((r) => r.text.trim().toLowerCase() === n) ?? all.find((r) => r.text.toLowerCase().includes(n) && n.length >= 8) ?? null;
}

export const ruleTools: BuiltinTool[] = [{
  spec: {
    name: "rule_propose",
    description: "Add, change or remove one of the user's rules when they ask you to (\"from now on never…\", \"forget the rule about…\"). The user always sees a card with the exact rule and where it applies, and decides. Give user_quote with their words asking for it. Scope: account (every bot), bot (one bot, by default you), routine (only when that routine runs) or trigger (only for routines started by that kind of event, e.g. email).",
    inputSchema: obj({
      action: { type: "string", enum: ["add", "change", "remove"] },
      text: str("The rule, in the user's own words (for add and change)"),
      rule: str("For change and remove: the existing rule's exact text (or its id)"),
      scope: { type: "string", enum: ["account", "bot", "routine", "trigger"], description: "Where it applies (default account)" },
      bot: str("For scope bot: the bot's name (default: you)"),
      routine: str("For scope routine: the routine's name"),
      trigger: { type: "string", enum: [...RULE_TRIGGERS], description: "For scope trigger: the kind of event" },
    }, ["action"]),
  },
  activity: "planning", label: "Changing your rules", audited: true, detail: (a) => clip(String(a.text ?? a.rule ?? ""), 50),
  // Always a card, with the exact rule and its scope; "Always" is never offered.
  gate: (a, ctx) => {
    const action = String(a.action ?? "add");
    const owner = bots.byId(ctx.botId);
    const scope = owner ? scopeOf(owner.userId, owner.id, a) : "?";
    const where = typeof scope === "string" ? "?" : scope.label;
    const text = clip(String(action === "remove" ? a.rule ?? "" : a.text ?? ""), 300);
    return {
      key: `rules: ${owner?.name ?? ""}`, strict: true, once: true, source: "Rules", vars: { text, scope: where, old: clip(String(a.rule ?? ""), 200) },
      title: action === "remove" ? "Allow {bot} to remove this rule: “{text}” ({scope})?" : action === "change" ? "Allow {bot} to change the rule “{old}” to: “{text}” ({scope})?" : "Allow {bot} to add this rule: “{text}” ({scope})?",
      reason: "change your rules",
      note: "It will be marked as added from the chat, with your words, and can be undone in one click in Settings → Rules.",
    };
  },
  run: async (a, c) => {
    const action = String(a.action ?? "add");
    // The user's words, checked by the server before the card (bind.ts): the tool itself never gets the bot's quote.
    const quote = String(a.seen_quote ?? "").trim();
    const scope = scopeOf(c.user.id, c.bot.id, a);
    if (typeof scope === "string") return { content: scope, isError: true };
    const loc = c.user.locale;
    let line = "";
    if (action === "add") {
      const text = String(a.text ?? "").trim();
      if (!text) return { content: "Give the rule's text.", isError: true };
      if (rules.count(c.user.id) >= MAX_RULES) return { content: `The user already has ${MAX_RULES} rules.`, isError: true };
      const rule = rules.create(c.user.id, text, scope.botId, { routineId: scope.routineId, trigger: scope.trigger, source: "chat", quote });
      ruleChanges.record(c.user.id, { action: "add", rule, before: null, botId: c.bot.id, quote });
      line = tr(loc, "Rule added from the chat: “{text}” ({scope})", { text: clip(rule.text, 200), scope: scope.label });
    } else {
      const cur = findRule(c.user.id, String(a.rule ?? ""));
      if (!cur) return { content: `No rule matches "${a.rule}". The rules: ${rules.all(c.user.id).map((r) => `"${r.text}"`).join("; ") || "none"}.`, isError: true };
      if (action === "remove") {
        rules.remove(cur.id);
        ruleChanges.record(c.user.id, { action: "remove", rule: cur, before: cur, botId: c.bot.id, quote });
        line = tr(loc, "Rule removed from the chat: “{text}”", { text: clip(cur.text, 200) });
      } else {
        const text = String(a.text ?? "").trim();
        if (!text) return { content: "Give the rule's new text.", isError: true };
        const next = rules.update(cur.id, { text, botId: scope.botId, routineId: scope.routineId, trigger: scope.trigger });
        ruleChanges.record(c.user.id, { action: "change", rule: next, before: cur, botId: c.bot.id, quote });
        line = tr(loc, "Rule changed from the chat: “{text}” ({scope})", { text: clip(next.text, 200), scope: scope.label });
      }
    }
    rows.append(c.bot, { kind: "event", event: "bot", text: line });
    audit(c.user.id, "account", `${c.bot.name}: ${line}${quote ? ` — « ${clip(quote, 160)} »` : ""}`, c.bot.id);
    emit(c.user.id, { type: "rules" });
    return { content: `Done: ${line}. The user can undo it in Settings → Rules.`, summary: clip(line, 80) };
  },
}];
