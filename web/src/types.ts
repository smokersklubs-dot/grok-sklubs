/** Wire types shared with the server (type-only, plus the avatar and tool-group constant lists). */
export type * from "../../server/src/shared";
export { AVATAR_SHAPES, AVATAR_COLORS, TOOL_GROUPS, EYE_STYLES, ACCESSORIES, IDLE_MOTIONS, CHARACTER_TYPES, DEFAULT_CHARACTER, REACTIONS, GROK_EXPORT_PROMPT_FR, GROK_EXPORT_PROMPT_EN } from "../../server/src/shared";
/** "Aujourd'hui": the time-saved table (kinds, default minutes, how research and file edits are counted). */
export type { TodayKind } from "../../server/src/todayminutes";
export { TODAY_KINDS, DEFAULT_MINUTES, FILES_PER_TURN, RESEARCH_MIN_READS, RESEARCH_GAP_MIN, MAX_MINUTES } from "../../server/src/todayminutes";
