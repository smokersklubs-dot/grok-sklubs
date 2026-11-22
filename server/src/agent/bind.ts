import type { ToolUseBlock } from "../llm/index.js";
import { browserAvailable, computerKind, lastKnownUrl, screen, type ClickTarget } from "../computer.js";
import { linuxScreen } from "../linux.js";
import { findQuote, normalize, QUOTE_ARG, userWordsFor, type ActionKind } from "./grounding.js";
import type { Turn } from "./loop.js";
import { resolveRef } from "./elements.js";
import { stageDelete } from "./deletecheck.js";

/**
 * What the server itself sees, bound into an action before it is judged (wave 5b).
 *
 *  - screen_click (spec 07 A13): the control under the click point, read in the page through the page-text helper of
 *    the bot's computer (or the browser): its words, the site, and its form. A click whose words commit something
 *    (buy, pay, order, send, delete, confirm, publish…) is then judged like any state-changing action (grounding in
 *    the user's words, the reviewer, or a card), and its approval is bound to that control on that site: if the page
 *    changed by the time it runs, nothing is clicked.
 *  - element_click (wave 8): the same, for the element a reference of the bot's latest snapshot names.
 *  - card_fill (spec 07 A12): the host of the page in front, so a payment's approval is bound to amount, merchant,
 *    card AND that page; a different page at run time fills nothing.
 *  - browser_dialog: the JavaScript dialog the active tab shows (its kind, its words, the site), so an "OK" is judged and
 *    approved for that very dialog (tools-browser.ts); another dialog at run time is not answered.
 *
 * The bound values live in the call's arguments (`seen_target`, `seen_host`), so they are part of the action's hash
 * (executions.ts) and of its single-use approval. Whatever the model put in those fields is replaced.
 */
export const BOUND_KEYS = ["seen_target", "seen_host", "seen_quote", "seen_dialog", "seen_delete", "seen_check", "seen_download"] as const; // seen_delete / seen_check: DS-Bot item 10 (deletecheck.ts)

/** Replaceable in tests: how the control under a point, and the page in front, are read. */
export const probe = {
  target: (botId: string, x: number, y: number): Promise<ClickTarget | null> => (browserAvailable() ? screen.targetAt(botId, x, y) : Promise.resolve(null)),
  /** The element a reference of the bot's latest snapshot names, read live in the page (null: stale, or computer off). */
  element: async (botId: string, ref: string): Promise<ClickTarget | null> => {
    const found = resolveRef(botId, ref);
    if ("error" in found) return null;
    const a = await screen.elementInfo(botId, { ...found.req, action: "info" });
    return a?.info ? { ...a.info, url: a.info.url || a.url || "" } : null;
  },
  /** The dialog the active tab shows (Linux computers; null: none, or the computer is off). Never wakes it. */
  dialog: async (botId: string): Promise<{ type: string; message: string; host: string } | null> => {
    if (computerKind() !== "linux") return null;
    const a = await linuxScreen.dialogInfo(botId);
    return a?.dialog ? { type: String(a.dialog.type ?? ""), message: String(a.dialog.message ?? "").slice(0, 500), host: hostOf(a.dialog.url || a.url || "") } : null;
  },
  /** DS-Bot item 10: one held download by its id (browser-downloads.ts), or null. */
  download: async (botId: string, id: string): Promise<{ id: string; name: string; host: string; url: string; size: number; state: string } | null> => {
    if (computerKind() !== "linux" || !id) return null;
    const d = (await linuxScreen.heldDownloads(botId))?.find((x) => x.id === id);
    return d ? { id: d.id, name: d.name.slice(0, 200), host: hostOf(d.url), url: d.url.slice(0, 500), size: d.size, state: d.state } : null;
  },
  pageUrl: async (botId: string, userId: string): Promise<string> => {
    if (!browserAvailable()) return "";
    try { return (await screen.read(botId, userId)).url; } catch { return lastKnownUrl(botId); }
  },
};

export interface SeenTarget { label: string; host: string; form: string }

export const hostOf = (url: unknown): string => {
  try { return new URL(String(url ?? "")).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};

export async function bindCall(turn: Turn, call: ToolUseBlock): Promise<void> {
  const input = call.input as Record<string, unknown>;
  if (call.name === "rule_propose") {
    // A rule change carries the user's own words that ask for it — only once the server found them in their messages.
    delete input.seen_quote;
    const quote = String(input[QUOTE_ARG] ?? "").trim();
    input.seen_quote = quote && findQuote(quote, userWordsFor(turn.bot, turn.thread)) ? quote : "";
    return;
  }
  if (call.name !== "screen_click" && call.name !== "element_click" && call.name !== "card_fill" && call.name !== "browser_dialog" && call.name !== "browser_download") return;
  for (const k of BOUND_KEYS) delete input[k];
  try {
    // DS-Bot item 10: the held download the call names (its file name, site and size), so its approval is for that file.
    if (call.name === "browser_download") { input.seen_download = await probe.download(turn.bot.id, String(input.id ?? "")); return; }
    if (call.name === "browser_dialog") { input.seen_dialog = await probe.dialog(turn.bot.id); return; }
    if (call.name === "screen_click") {
      const t = await probe.target(turn.bot.id, Number(input.x), Number(input.y));
      input.seen_target = t ? seenOf(t) : null;
    } else if (call.name === "element_click") {
      // Wave 8: the element named by its reference, read live (its words, the site, its form), exactly as for a pixel click.
      const t = await probe.element(turn.bot.id, String(input.ref ?? ""));
      input.seen_target = t ? seenOf(t) : null;
    }
    if (call.name === "screen_click" || call.name === "element_click") { const seen = seenTarget(input); stageDelete(turn.bot.id, call.name, input, seen, !!seen && committingKind(seen.label) === "delete"); return; }
    {
      input.seen_host = hostOf(await probe.pageUrl(turn.bot.id, turn.user.id));
    }
  } catch {
    // Nothing could be read: a click is then judged as an ordinary one; a payment has no page to be bound to and fails.
    if (call.name === "card_fill") input.seen_host = "";
  }
}

export const seenOf = (t: ClickTarget): SeenTarget => ({
  label: t.label.slice(0, 120), host: hostOf(t.url),
  form: t.formAction ? `${(t.formMethod || "get").toUpperCase()} ${t.formAction.slice(0, 200)}` : "",
});

// ── Committing words ────────────────────────────────────────────────────────
/**
 * Control words that commit something, written as `normalize` leaves them (French and English). A cookie banner, "add
 * to cart" or "next" are not in here: they are steps, not commitments.
 */
const COMMITTING: [ActionKind | "submit", string[]][] = [
  ["pay", ["acheter", "achat", "payer", "paiement", "regler", "commander", "passer la commande", "valider la commande", "valider ma commande", "confirmer la commande", "confirmer et payer", "buy", "buy now", "pay", "pay now", "purchase", "checkout", "place order", "place your order", "order now", "complete order", "complete purchase", "subscribe", "s'abonner"]],
  ["delete", ["supprimer", "effacer", "vider la corbeille", "delete", "remove", "erase", "empty trash", "resilier", "close account"]],
  ["publish", ["publier", "mettre en ligne", "publish", "go live", "post"]],
  ["calendar", ["reserver", "confirmer la reservation", "book", "book now", "reserve"]],
  ["send", ["envoyer", "envoi", "send", "repondre", "reply", "transferer", "forward"]],
  ["submit", ["confirmer", "valider", "soumettre", "enregistrer", "sauvegarder", "accepter et continuer", "confirm", "submit", "save", "apply", "sign", "signer"]],
];
/** Phrases that make a control a mere step even if it also has a committing word ("add to cart", "save for later"…). */
const STEP_PHRASES = ["ajouter au panier", "add to cart", "add to basket", "plus tard", "for later", "brouillon", "draft", "accepter les cookies", "reject all", "accept all", "tout accepter", "tout refuser", "accepter tout", "refuser tout", "cookies"];
/** Whole labels that only close or go back. */
const STEP_LABELS = ["annuler", "cancel", "fermer", "close", "retour", "back", "refuser", "non", "no"];

const hasPhrase = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

/** The kind of commitment a control's words make, or null for an ordinary click. */
export function committingKind(label: string): ActionKind | "submit" | null {
  const n = normalize(label);
  if (!n || n.length > 80) return null;
  if (STEP_LABELS.includes(n) || STEP_PHRASES.some((w) => hasPhrase(n, normalize(w)))) return null;
  for (const [kind, words] of COMMITTING) if (words.some((w) => hasPhrase(n, normalize(w)))) return kind;
  return null;
}

/** The bound click target of a call, if any. */
export function seenTarget(input: Record<string, unknown>): SeenTarget | null {
  const t = input.seen_target as SeenTarget | null | undefined;
  return t && typeof t === "object" && typeof t.label === "string" ? t : null;
}
