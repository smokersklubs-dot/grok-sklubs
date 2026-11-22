import type { ToolSpec } from "../llm/types.js";
import { botEditRefusal, metaOf, nearDuplicates, readSkill, skillMeta } from "../skillhealth.js";
import type { Skill } from "../shared.js";
import { skills } from "../store.js";
import type { BuiltinTool, ToolOutput } from "./tools.js";

/**
 * The bot's side of « Santé des compétences » (skillhealth.ts): what skill_read gives (L132: a long skill by its index,
 * then one section; every read counted), the checks before skill_save replaces a skill (locked by the user; no more
 * than a quarter of its text lost in one save; Hermes audit line 117-118), the « presque identique » note after a save,
 * and skill_feedback (a skill whose steps did not work: counted as a failure the owner sees).
 */
type Found = Skill & { own: boolean; botName: string };

export function skillReadOutput(s: Found, section: unknown): ToolOutput {
  if (metaOf(s.id).onlyOnRequest)
    return { content: `The skill "${s.name}" is used only when the user asks for it ("/skill ${s.name}"). Do not follow it on your own.`, isError: true, summary: s.name };
  const r = readSkill(s, typeof section === "string" || typeof section === "number" ? String(section) : undefined);
  skillMeta.used(s.id);
  // A skill learned in a turn that had read outside content is itself outside content: a page may have shaped it.
  return { content: `# ${s.name}${s.own ? "" : ` (shared by ${s.botName})`}${s.learned ? " (learned from an earlier task)" : ""}\n${r.text}`, summary: r.part === "all" ? s.name : `${s.name} · ${r.part === "index" ? "index" : `§${r.part}`}`, outside: s.outside };
}
export const skillSectionParam = { section: { type: "string", description: "For a long skill: the number or title of the section to read (skill_read without it gives the index)" } };

/** Why skill_save may not replace this skill (the user locked it, or too much of it would go), or null. */
export const saveRefusal = (existing: Skill | undefined, body: string): string | null => (existing ? botEditRefusal(existing, body) : null);

/** After skill_save: marks a new skill as made by the bot (the curator may retire it if never used) and warns of a near twin. */
export function afterSave(userId: string, botId: string, name: string, existed: boolean): string {
  const s = skills.list(botId).find((k) => k.name.toLowerCase() === name.toLowerCase());
  if (!s) return "";
  if (!existed) skillMeta.setMadeBy(s.id, "bot");
  const twin = nearDuplicates(userId, s, s.id)[0];
  return twin ? ` Note: it is almost identical to the skill "${twin.skill.name}"${twin.botName ? ` (${twin.botName})` : ""}. Tell the user; they may want to keep only one.` : "";
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
export const skillFeedbackTools: BuiltinTool[] = [{
  spec: {
    name: "skill_feedback",
    description: "Say that one of your skills (or a shared one) did not work as written: a step was wrong, out of date or missing. The user sees it in the skill's health and can fix it. Do not use it for a failure that had nothing to do with the skill's steps.",
    inputSchema: obj({ name: { type: "string", description: "Name of the skill" }, problem: { type: "string", description: "What did not work, in one or two lines (which step, what happened)" } }, ["name", "problem"]),
  },
  activity: "remembering", label: "Reporting a skill problem", group: "memory",
  run: async (a, c) => {
    const s = skills.find(c.bot.id, String(a.name ?? ""));
    if (!s) return { content: `You have no skill called "${a.name}".`, isError: true };
    const problem = String(a.problem ?? "").trim();
    if (!problem) return { content: "Say what did not work.", isError: true };
    skillMeta.failed(s.id, problem);
    return { content: "Noted: the user will see that this skill needs fixing. Carry on with the task another way if you can, and tell the user.", summary: s.name };
  },
}];
