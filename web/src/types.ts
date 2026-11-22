/** Wire types shared with the server (type-only, plus the avatar and tool-group constant lists). */
export type * from "../../server/src/shared";
/** « Bibliothèque de compétences »: the bundled skills and the GitHub import. */
export type * from "../../server/src/skillstypes";
/** « Équipe Sklubot (.md) »: a whole team in one Markdown file (import with review, share). */
export type * from "../../server/src/teammdtypes";
/** « Autoriser pour cette conversation »: the owner's active grants (Settings → Permissions). */
export type * from "../../server/src/conversationgranttypes";
/** « Contrôle de sécurité des compétences »: what the check found in a skill's text. */
export type * from "../../server/src/skillscantypes";
/** « Santé des compétences », « Catalogue de l'équipe », banc d'essai (skillhealth.ts, skillcatalog.ts). */
export type * from "../../server/src/skillhealthtypes";
/** L162 « Canaux »: Slack, Discord, IMAP and who besides the owner may talk to a bot (channelroutes.ts). */
export type * from "../../server/src/channeltypes";
/** Mémoire : « Ce que reçoit ce bot », « Voir le résumé », « Mémoire par le sens », « Messages autour » (L71–L138). */
export type * from "../../server/src/memorytypes";
export { AVATAR_SHAPES, AVATAR_COLORS, TOOL_GROUPS, EYE_STYLES, ACCESSORIES, IDLE_MOTIONS, CHARACTER_TYPES, DEFAULT_CHARACTER, REACTIONS, GROK_EXPORT_PROMPT_FR, GROK_EXPORT_PROMPT_EN, TEMPLATE_ICONS, TEMPLATE_CATEGORIES, BOT_API_SCOPES } from "../../server/src/shared";
/** "Aujourd'hui": the time-saved table (kinds, default minutes, how research and file edits are counted). */
export type { TodayKind } from "../../server/src/todayminutes";
/** « Annonces »: wire types, limits and the plain-text helpers (https links only). */
export type * from "../../server/src/announcetext";
export { ANNOUNCE_KINDS, ANNOUNCE_LIMITS, linkify, safeHttpsUrl } from "../../server/src/announcetext";
export { TODAY_KINDS, DEFAULT_MINUTES, FILES_PER_TURN, RESEARCH_MIN_READS, RESEARCH_GAP_MIN, MAX_MINUTES } from "../../server/src/todayminutes";
/** « Centre de commandement » (server command.ts): the wire types and the state rule. */
export type * from "../../server/src/commandtypes";
export { COMMAND_STATES, commandStateOf } from "../../server/src/commandtypes";
export type * from "../../server/src/peerreviewtypes";
export type { ResearchWindow, ResearchExtra, SourceState } from "../../server/src/researchsignals";
