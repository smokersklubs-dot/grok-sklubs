/**
 * L91 — the « case masquée » card: the bot needs a one-time code (an SMS, an authenticator) typed into a field of the
 * page in front of its browser; the user types it into a hidden box on this card and the server types it into that
 * field. The code is never shown to the bot nor kept (agent/codebox.ts).
 */
export interface CodeCard {
  type: "code"; codeId: string;
  /** The field's name on the page, and the page's site, as the bot's snapshot saw them. */ label: string; host: string;
  detail: string;
  status: "pending" | "typed" | "failed" | "dismissed" | "timeout" | "stopped";
  expiresAt: number;
}
