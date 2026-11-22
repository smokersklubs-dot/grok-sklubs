/** Wire types of the memory screens added in wave L67–L138 (kept out of shared.ts, which is at its size limit). */

/** L137 « Ce que reçoit ce bot »: one part of the instructions, in the order the bot reads them. */
export interface PromptPart {
  title: string;
  text: string;
  chars: number;
  /** About chars / 4: an estimate, not the provider's count. */
  tokens: number;
  /** "fixed": the same from message to message (cached by the provider); "turn": refreshed with each message. */
  kind: "fixed" | "turn";
}

export interface PromptView {
  parts: PromptPart[];
  totalChars: number;
  totalTokens: number;
  /** « Ce que ton bot voit de sa mémoire »: notes usable, shown in the instructions, left out (found with memory_search). */
  memory: { total: number; shown: number; hidden: number; chars: number; tokens: number; lines: string[] };
  /** L138: the conversation the bot carries, against the size at which it is summarised. */
  context: { chars: number; tokens: number; compactAt: number; percent: number };
  /** L88: the shared « Fiche sur moi » (Settings → Profile) is in the instructions; « Ne rien retenir » is on for this bot. */
  profileShared: boolean;
  noLearn: boolean;
}

/** L80/L138 « Voir le résumé »: the latest summary of this conversation. */
export interface ConversationSummary { at: number; before: number; after: number; summary: string; flushed: boolean }

/** L71 « Mémoire par le sens » (off by default). `provider`: who would receive the notes, null when no key allows it. */
export interface SemanticSetting { enabled: boolean; provider: string | null; model: string | null }

/** L73 « Messages autour ». */
export interface AroundMessage { seq: number; at: number; role: "user" | "assistant"; text: string; hit: boolean }
