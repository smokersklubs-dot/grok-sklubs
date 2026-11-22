import { tr } from "../i18n.js";
import type { ToolUseBlock } from "../llm/index.js";
import type { Ask, Decision } from "./authorize.js";
import type { Turn } from "./loop.js";

/**
 * L30 — no clone of a voice or a face without consent (guide « jumeau numérique », claude-seo audit).
 *
 * A tool whose action makes a copy of someone's voice or face (a voice clone, a face swap, a talking avatar, a lip-sync
 * on a real person's video, an "AI influencer" from a photo) always stops on a card that asks the owner the one question
 * that matters: « C'est toi, ou la personne a donné son accord écrit ? ». Allow = "yes, it is me / I have their written
 * consent", once (never "Always", never "for this conversation"); Refuse = nothing is cloned and the bot is told to drop
 * it. This holds whatever let the action through otherwise (a trusted bot, an "always" rule, the owner's words): only a
 * "Retry" the owner pressed on such a card for this exact action counts as their answer already.
 *
 * Judged by the action's NAME (the app's own tool name, or ours), never by what the model says about it. A heuristic: it
 * only ever adds the card.
 */
export const CLONE_ACTION = /(?:^|[_\-.\s])(?:voice_?clon\w*|clon\w*_?voice|create_?voice\w*|design_?voice|voice_?change|instant_?voice|face_?swap\w*|swap_?face\w*|deep_?fake\w*|avatar\w*|lip_?sync\w*|talking_?(?:head|avatar|photo)\w*|digital_?twin\w*|ai_?influencer\w*|build_ai_influencer)(?:$|[_\-.\s])/i;

/** The action name a clone is judged on: an app tool's own name, else ours. */
export function cloneActionName(turn: Pick<Turn, "remote">, name: string): string {
  return turn.remote.get(name)?.remoteName ?? name;
}
/** Reading, listing, pricing or checking an existing one copies nothing. */
const READ_ONLY = /^(?:list|get|search|show|estimate|verify|check|describe|status|view|read)(?:[_\-.]|$)|(?:^|[_\-.])(?:status|estimate|options|presets|settings|list)$/i;
export const isCloneAction = (actionName: string) => CLONE_ACTION.test(`_${actionName}_`) && !READ_ONLY.test(actionName);

/** The consent card for a clone, or null when the action clones nothing (or the owner's "Retry" already answered). */
export function cloneConsent(turn: Turn, call: ToolUseBlock, d: Decision): Ask | null {
  const action = cloneActionName(turn, call.name);
  if (!isCloneAction(action)) return null;
  if (d.kind === "block") return null;
  if (d.kind === "allow" && d.grant?.by === "retry") return null;
  const loc = turn.user.locale;
  const remote = turn.remote.get(call.name);
  const what = remote ? `${remote.connectorName}: ${remote.remoteName.replace(/[_-]+/g, " ")}` : action.replace(/_/g, " ");
  const base: Ask = d.kind === "ask" ? d : { kind: "ask", policyKey: `consent: ${remote ? `${remote.connectorName}: ${remote.remoteName}` : call.name}`, title: "", reason: tr(loc, "copy a voice or a face ({what})", { what }), source: remote?.connectorName ?? "Sklubot" };
  return {
    ...base,
    title: tr(loc, "{bot} wants to copy a voice or a face ({what}). Is it you, or did the person give their written consent?", { bot: turn.bot.name, what }),
    why: tr(loc, "No copy of a voice or a face without consent: allow only if it is your own voice or face, or if the person gave you their written agreement. Otherwise refuse: nothing will be copied."),
    once: true, fixed: true,
  };
}

/** What the bot is told when the owner refuses a clone (added to the refusal by the card's own wording). */
export const CONSENT_REFUSED = "The owner did not confirm that this voice or face is theirs or that the person gave written consent. Do not copy it, and do not try another tool to do so.";
