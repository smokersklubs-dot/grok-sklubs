/**
 * « Écouter les réponses »: a bot's reply turned into words that read well aloud, and cut into parts so the first one
 * starts playing quickly. Pure functions without imports: the server (voice/speak.ts) uses them before text-to-speech,
 * and the web app (web/src/lib/listen.ts) for the browser's own speech when the server has no voice.
 *
 *  - Markdown is taken out (titles, lists, bold, quotes, tables); a link keeps its words, a bare address is said as
 *    « lien vers example.com »; a code block becomes « bloc de code » (never read character by character), inline code
 *    keeps its text; images and HTML tags disappear.
 *  - At most SPEECH_MAX_CHARS characters are read (cut at the end of a sentence), then « … la suite est à l'écran ».
 *  - speechParts: whole sentences, grouped; the first part is short (≈ one sentence) so it is ready fast, the next ones
 *    longer (fewer requests); a sentence longer than a part is cut at a comma, else at a space.
 */

export const SPEECH_MAX_CHARS = 4000;
export const SPEECH_FIRST_PART = 160;
export const SPEECH_PART = 420;

const WORDS: Record<string, { code: string; link: string; more: string }> = {
  fr: { code: "bloc de code", link: "lien vers {host}", more: "La suite est à l'écran." },
  en: { code: "code block", link: "link to {host}", more: "The rest is on screen." },
  es: { code: "bloque de código", link: "enlace a {host}", more: "El resto está en la pantalla." },
  de: { code: "Codeblock", link: "Link zu {host}", more: "Der Rest steht auf dem Bildschirm." },
  it: { code: "blocco di codice", link: "link a {host}", more: "Il resto è sullo schermo." },
  pt: { code: "bloco de código", link: "link para {host}", more: "O resto está na tela." },
};
const words = (lang: string) => WORDS[(lang || "").slice(0, 2).toLowerCase()] ?? WORDS.en;

/** The host of an address, without "www.", or "" when it is not one. */
function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s:]+)/i.exec(url);
  return m ? m[1].replace(/^www\./i, "").toLowerCase() : "";
}

/** The reply as words to say (see the file's comment). `lang`: the bot's language, BCP-47 or two letters. */
export function speechText(md: string, lang = "fr"): string {
  const w = words(lang);
  const link = (url: string) => {
    // The punctuation right after an address ends the sentence, not the address: it is kept.
    const tail = /[).,;:!?»"']+$/.exec(url)?.[0] ?? "";
    const h = hostOf(url.slice(0, url.length - tail.length));
    return `${h ? ` ${w.link.replace("{host}", h)}` : ""}${tail.replace(/[^.,;:!?]/g, "")} `;
  };
  let s = String(md ?? "")
    .replace(/\r\n?/g, "\n")
    // Code blocks (fenced or ~~~): one short word, then a pause.
    .replace(/(^|\n)\s{0,3}(```|~~~)[^\n]*\n[\s\S]*?(\n\s{0,3}\2[^\n]*(?=\n|$)|$)/g, `$1${w.code}.\n`)
    .replace(/<[^>\n]{1,200}>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)(]|\([^)]*\))*\)/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\b(?:https?|ftp):\/\/[^\s<>()]+/gi, (u) => link(u))
    .replace(/(^|\s)www\.[^\s<>()]+/gi, (u, pre: string) => pre + link(`http://${u.trim()}`));
  s = s
    .split("\n")
    .map((line) => {
      let l = line.trim();
      if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l)) return ""; // a table's separator line
      if (l.includes("|") && /^\|.*\|$/.test(l)) l = l.slice(1, -1).split("|").map((c) => c.trim()).filter(Boolean).join(", ");
      l = l.replace(/^(#{1,6}|>+|[-*+•]|\d+[.)])\s+/, "").replace(/^[-*_]{3,}$/, "");
      // A line without its own end mark gets one, so the voice pauses between titles, list items and paragraphs.
      return l && !/[.!?…:;,]$/.test(l) ? `${l}.` : l;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/(\*\*|__|~~|\*|_)(?=\S)([^*_~]+?)\1/g, "$2")
    .replace(/[*~|#]+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.!?…])\.+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > SPEECH_MAX_CHARS) {
    const cut = s.slice(0, SPEECH_MAX_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("… "));
    s = `${(end > SPEECH_MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim()} ${w.more}`;
  }
  return s;
}

/** Sentences of an already cleaned text (an end mark followed by a space ends one; "3.5" or "e.g." mid-word do not). */
export function speechSentences(text: string): string[] {
  return text.split(/(?<=[.!?…;:])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean);
}

/** A piece longer than `max`, cut at the last comma, else the last space, before `max`. */
function cutLong(piece: string, max: number): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let at = Math.max(head.lastIndexOf(", "), head.lastIndexOf(" – "), head.lastIndexOf(" — "));
    if (at < max / 3) at = head.lastIndexOf(" ");
    if (at < max / 3) at = max - 1;
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The cleaned text in parts to synthesize one after the other: a short first one, then up to `part` characters each. */
export function speechParts(text: string, first = SPEECH_FIRST_PART, part = SPEECH_PART): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const sentence of speechSentences(text)) {
    const limit = parts.length === 0 ? first : part;
    for (const piece of cutLong(sentence, parts.length === 0 && !cur ? first : part)) {
      if (cur && cur.length + 1 + piece.length > (parts.length === 0 ? first : part)) { parts.push(cur); cur = ""; }
      cur = cur ? `${cur} ${piece}` : piece;
      // The first part goes as soon as it holds one sentence (or its limit): it is the one the listener waits for.
      if (parts.length === 0 && cur.length >= Math.min(limit, 40)) { parts.push(cur); cur = ""; }
    }
  }
  if (cur) parts.push(cur);
  return parts;
}
