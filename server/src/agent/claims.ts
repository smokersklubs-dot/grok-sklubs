/**
 * Claims (audit DS-Bot #63 and F9, À faire n° 3): what a bot's final reply says it did or is doing, checked against its
 * computer. Two checks, made WITHOUT a model, that feed the existing receipt (receipt.ts, L85) and the existing promise
 * guard (promises.ts, L21) instead of a third mechanism:
 *  - a deliberate Markdown file link (`[rapport.pdf](rapport.pdf)`) to a file that is not on the bot's computer;
 *  - a reply that announces work in progress ("je suis en train d'exporter…", "still running") while nothing runs: no
 *    tool in the turn, no background job, no background task.
 * Only Markdown links are checked against disk: inline code and prose paths often name example or deleted files.
 *
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/src/host/claims.js and ds-bot/src/host/links.js (fileLinks, fileTarget), Copyright 2026 Fei2411 and the DS Bot
 * contributors, Apache License 2.0; modified for Sklubot: TypeScript, French phrases added (and the Chinese ones kept),
 * existence checked on the bot's own computer through an injected function, home folder /root.
 */
import { posix } from "node:path";

const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;
const LINK = /(!?\[[^\]\n]*\]\()(<[^<>\n]*>|[^\s()<>]+)((?:\s+"[^"\n]*")?\))/g;
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const GLOB = /[*?[\]{}]/;
const LINE_COL = /:\d+(?::\d+)?$/;

/** The decoded local path a link destination names, or undefined for a web link, a query, an odd fragment. */
function fileTarget(destination: string): string | undefined {
  const d = destination.startsWith("<") ? destination.slice(1, -1) : destination;
  const hash = d.indexOf("#");
  const target = hash < 0 ? d : d.slice(0, hash);
  const fragment = hash < 0 ? "" : d.slice(hash);
  if (target === "" || target.includes("?") || (fragment !== "" && !/^#L[1-9]\d*(?:-L[1-9]\d*)?$/.test(fragment))) return undefined;
  let p: string;
  try { p = decodeURIComponent(target); } catch { return undefined; }
  if ([...p].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) || /^[\\/]{2}/.test(p) || (!ABSOLUTE.test(p) && SCHEME.test(p))) return undefined;
  return p;
}

/** The local paths a reply links to, in order, once each (folders and globs are not checked). */
export function fileRefs(text: string): string[] {
  if (typeof text !== "string" || !text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  text.split(CODE).forEach((part, i) => {
    if (i % 2 === 1) return;
    for (const m of part.matchAll(LINK)) {
      const raw = fileTarget(m[2])?.trim();
      if (!raw || raw === "~" || raw.endsWith("/") || raw.endsWith("\\") || GLOB.test(raw)) continue;
      const key = raw.replace(/\\/g, "/");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
    }
  });
  return out;
}

/** Where a linked path is on the bot's computer: ~ and relative paths are in its home (/root). */
export const onComputer = (raw: string, home = "/root") => posix.resolve(home, raw === "~" ? "." : raw.startsWith("~/") ? raw.slice(2) : raw);

/** The linked paths that are not there. `exists` answers for absolute paths on the bot's computer, in order. */
export async function missingFileRefs(text: string, exists: (paths: string[]) => Promise<boolean[]>): Promise<string[]> {
  const refs = fileRefs(text);
  if (!refs.length) return [];
  // A `file.ts:42` link also counts when the file without its line suffix is there.
  const asked = refs.flatMap((r) => (LINE_COL.test(r) ? [onComputer(r), onComputer(r.replace(LINE_COL, ""))] : [onComputer(r)]));
  const there = await exists(asked);
  const ok = new Map(asked.map((p, i) => [p, there[i]] as const));
  return refs.filter((r) => !ok.get(onComputer(r)) && !(LINE_COL.test(r) && ok.get(onComputer(r.replace(LINE_COL, "")))));
}

/**
 * Phrases that announce work in progress (DS-Bot's English and Chinese, plus French). In each sentence only what comes
 * after the last completion phrase counts: "j'exportais, c'est terminé" is done; "partie 1 finie, j'exporte encore la 2"
 * is not.
 */
const AFTER_DONE = /^[\s\S]*(?:已完成|已经完成|完成了|已导出|已生成|已保存|做好了|搞定|finished|completed|here (?:is|are)\b|(?<!(?:dès que|quand|une fois que|lorsque) )c['’]est (?:fait|terminé|fini|prêt)|(?<!(?:dès que|quand|une fois que|lorsque) (?:c['’]est |j['’]aurai ))(?:j['’]ai )?(?:terminé|fini)\b|voici\b|voilà\b)/i;
const IN_PROGRESS = new RegExp([
  "\\b(?:i(?:'m| am)|we(?:'re| are)|still|currently)\\s+(?:still\\s+)?(?:working on|working|running|exporting|generating|building|preparing|processing|checking|investigating|researching|drafting|writing|putting together)\\b",
  "\\b(?:will|going to|about to)\\s+(?:report|send|share|finish|follow up|come back)\\b",
  "\\b(?:in progress|on it now|working on it)\\b",
  "(?:正在|还在|仍在)(?:导出|生成|处理|整理|制作|编写|准备|检查|调查|运行|执行|做|写|搜索|分析)",
  "(?:稍后|待会|马上|一会儿|等下)(?:汇报|回复|发|给你|回来|完成)", "进行中", "处理中", "马上回来",
  "\\b(?:je suis|on est|nous sommes)\\s+(?:encore\\s+|toujours\\s+)?en train d[e'’]",
  "\\bj['’](?:exporte|analyse|prépare|génère|traite|vérifie|rédige|cherche)\\s+(?:encore|toujours|en ce moment)\\b",
  "\\b(?:c['’]est|toujours|encore)\\s+en cours\\b", "\\ben cours de (?:traitement|génération|préparation|rédaction|export)\\b",
  "\\bje (?:te |vous )?(?:reviens|recontacte|renvoie)\\s+(?:vers (?:toi|vous)\\s+)?(?:dès que|quand|bientôt|plus tard|dans)\\b",
].join("|"), "i");

/** Whether a reply announces work still going on (code blocks are not read). */
export function announcesWork(text: string): boolean {
  if (typeof text !== "string") return false;
  const prose = text.split(CODE).filter((_, i) => i % 2 === 0).join(" ").trim();
  if (!prose) return false;
  return prose.split(/[\r\n。！？!?；;]+/).some((sentence) => {
    const tail = sentence.replace(AFTER_DONE, "").trim();
    return tail !== "" && IN_PROGRESS.test(tail);
  });
}

export interface Claims { missingFiles?: string[]; inProgress?: true }

/**
 * The claim marks of one final reply, or undefined. `worked`: the turn used a tool; `running`: background jobs or tasks
 * still going for the bot when the turn ended; `calledPeer`: the reply handed work to a teammate (a bot is on it).
 */
export async function claimsFor(o: { text: string; worked?: boolean; running?: number; calledPeer?: boolean; exists: (paths: string[]) => Promise<boolean[]> }): Promise<Claims | undefined> {
  const out: Claims = {};
  const missing = await missingFileRefs(o.text, o.exists).catch(() => []);
  if (missing.length) out.missingFiles = missing;
  if (!o.worked && !(o.running ?? 0) && !o.calledPeer && announcesWork(o.text)) out.inProgress = true;
  return Object.keys(out).length ? out : undefined;
}
