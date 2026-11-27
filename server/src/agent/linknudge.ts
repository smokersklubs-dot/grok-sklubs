import { hostOf, publicLinksIn } from "./links.js";
import type { Turn } from "./loop.js";

/**
 * L64 — links the user typed, during the turn too (backlog A-FAIRE L64; idea from OpenClaw / CopilotKit / OMB audits,
 * our own code).
 *
 * The hint "open this link on your screen" used to reach only the message that started a turn. A link typed while the bot
 * works (a steering note, steering.ts) now gets the same hint, and its site joins the sites the turn may open without a
 * new question (Turn.hosts), exactly as for the first message. The safety net: a bot that had a browser, was given a link
 * by the user, and ends the turn without ever opening that site is nudged once to open it (or say why it cannot).
 */
interface Given { links: Map<string, string>; opened: Set<string>; nudged: boolean }
const given = new WeakMap<object, Given>();
const of = (turn: object): Given => { let g = given.get(turn); if (!g) { g = { links: new Map(), opened: new Set(), nudged: false }; given.set(turn, g); } return g; };

/** Public links the user typed into this turn (its first message or a note sent meanwhile) are remembered for the nudge. */
export function noteLinksGiven(turn: object, typed: string): void {
  for (const url of publicLinksIn(typed, 3)) { const h = hostOf(url); if (h && !of(turn).links.has(h)) of(turn).links.set(h, url); }
}

/** A site the turn really opened (browser_open, web_fetch, page navigation). */
export function noteOpened(turn: object, host: string): void { if (host) of(turn).opened.add(host); }

/** The one nudge for a turn that ends with a typed link never opened, or null. Only for a turn that has a browser. */
export function linkNudge(turn: Pick<Turn, "builtin">): string | null {
  const g = given.get(turn);
  if (!g || g.nudged || !turn.builtin.has("browser_open")) return null;
  const missed = [...g.links].filter(([h]) => !g.opened.has(h)).map(([, url]) => url);
  if (!missed.length) return null;
  g.nudged = true;
  return `[System: the user gave you ${missed.length > 1 ? "these links" : "this link"} (${missed.join(", ")}) and you have not opened ${missed.length > 1 ? "them" : "it"}. Open ${missed.length > 1 ? "them" : "it"} now with browser_open so the user can watch on your screen, then answer — or, if ${missed.length > 1 ? "they were" : "it was"} only named (an account, an address to note down) or cannot be opened, say so in one sentence.]`;
}
