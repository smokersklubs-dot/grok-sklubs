/**
 * L140 « Commenter un passage » and L106 « Explique plus simplement »: the words sent to the bot when you select a passage
 * of one of its replies and press a quick button, or press « Explique plus simplement » under a reply. Plain Markdown: the
 * passage as a quote ("> …"), then the request. The bot reads exactly what was quoted; nothing is sent without a click.
 * Ideas only (Plannotator's annotations, ECC): our own code.
 */

/** The quick buttons of the passage bar, in the order shown. "remark" opens a small box for your own words. */
export const PASSAGE_ASKS = ["explain", "simpler", "shorter", "example", "remark"] as const;
export type PassageAsk = (typeof PASSAGE_ASKS)[number];

/** Longest passage quoted (characters): a longer selection is cut with "…" so a message never carries a whole page. */
export const PASSAGE_MAX = 1200;
/** Shortest selection that shows the bar (a stray click selects one or two letters). */
export const PASSAGE_MIN = 3;

/** The passage as Markdown quote lines, tidied: spaces collapsed per line, empty lines kept as ">". */
export function quoteLines(passage: string): string {
  let text = passage.replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();
  if (text.length > PASSAGE_MAX) text = text.slice(0, PASSAGE_MAX - 1).trimEnd() + "…";
  return text.split("\n").map((l) => `> ${l.replace(/[ \t]+/g, " ").trim()}`.trimEnd()).join("\n");
}

/**
 * The message for one quick button. `request` is the request in the reader's language (from the dictionary); for
 * "remark" it is the remark typed by the owner. Empty when there is nothing to send.
 */
export function passageMessage(passage: string, request: string): string {
  const quote = passage.trim();
  const words = request.trim();
  if (quote.length < PASSAGE_MIN || !words) return "";
  return `${quoteLines(quote)}\n\n${words}`;
}

/**
 * « Explique plus simplement » under a reply: the start of the reply as a quote (code blocks shortened, Markdown marks
 * removed, at most 200 characters) so the bot knows which reply is meant, then the request.
 */
export function simplerMessage(reply: string, request: string): string {
  const start = reply.replace(/```[\s\S]*?```/g, "…").replace(/[#*_`>|]/g, "").replace(/\s+/g, " ").trim();
  if (!start || !request.trim()) return "";
  const cut = start.length > 200 ? start.slice(0, 199).trimEnd() + "…" : start;
  return `${quoteLines(cut)}\n\n${request.trim()}`;
}

/** Whether a selection is worth the bar: long enough and not only spaces or punctuation. */
export function worthQuoting(selection: string): boolean {
  const s = selection.trim();
  return s.length >= PASSAGE_MIN && /[\p{L}\p{N}]/u.test(s);
}
