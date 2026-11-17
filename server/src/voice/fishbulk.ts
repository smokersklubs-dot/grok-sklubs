import type { FishBulkProposal, FishVoice } from "../shared.js";
import type { BotRecord } from "../store.js";
import { genderHint, hashId, type Gender } from "./autovoice.js";
import { fishVoices } from "./fish.js";

/**
 * "Give a Fish Audio voice to all my bots" (Settings → Voice): one distinct, popular voice of Fish Audio's public library
 * per bot, in the bot's language, proposed for the owner to listen to and confirm. Proposing only reads the library
 * (GET /model, free: no credit is spent); nothing is saved until the owner confirms, and a sample is only made when the
 * owner clicks "Listen" (the usual preview route). Never spends Fish Audio credits on its own.
 *
 * What is left out: voices that imitate a real person or a copyrighted character (titles, descriptions or tags that name
 * one, or look like a person's full name), and novelty voices (ASMR, screams, singing…). Preferred: everyday voices
 * tagged conversational, professional, narration, assistant, calm, friendly…
 */

/** Words that say a voice copies someone (a celebrity, a politician, a streamer) or a character (cartoon, game, film). */
const IMITATION = new RegExp([
  "celebrit", "célébrit", "famous", "célèbre", "celebre", "star\\b", "imitation", "imitat", "impression", "parod", "sosie", "lookalike", "soundalike",
  "president", "président", "politic", "politique", "minist", "macron", "trump", "obama", "biden", "putin", "poutine", "zemmour", "m[ée]lenchon", "le ?pen", "sarkozy", "hollande", "chirac", "de ?gaulle",
  "actor", "actress", "acteur", "actrice", "comedian", "humoriste", "singer", "chanteu", "rapper", "rappeu", "youtubeu?r", "streamer", "influenc", "tiktoker", "twitch", "podcasteur célèbre",
  "anime", "manga", "cartoon", "dessin anim", "personnage", "character", "jeu vid", "video ?game", "videogame", "gaming",
  "disney", "pixar", "dreamworks", "marvel", "dc comics", "star wars", "harry potter", "pok[ée]mon", "naruto", "one piece", "dragon ?ball", "goku", "vegeta", "mario", "luigi", "sonic", "zelda", "spongebob", "bob l'[ée]ponge", "simpson", "homer", "minecraft", "fortnite", "genshin", "batman", "joker", "spider", "darth", "vader", "yoda", "gollum", "shrek", "mickey", "donald", "garfield", "scooby", "peppa", "titeuf", "ast[ée]rix", "ob[ée]lix", "tintin", "kaamelott", "squeezie", "cyprien", "norman", "inoxtag", "amixem",
  "voix de\\b", "voice of\\b", "vf\\b", "doublage", "dubb", "official", "officiel", "meme", "m[èe]me\\b",
].join("|"), "i");
/** Novelty voices that make a poor everyday assistant. */
const NOVELTY = /\b(asmr|whisper|chuchot|robot|horror|horreur|scream|cri|sing|song|chant|kid|child|enfant|b[ée]b[ée]|baby|old|vieux|vieille|drunk|angry|col[èe]re|funny|dr[ôo]le|demon|d[ée]mon|monster|monstre|evil|sexy|moan)\b/i;
const PREFERRED = /(conversation|professional|professionnel|narrat|assistant|calm|calme|friendly|chaleur|warm|clear|clair|natural|naturel|neutral|neutre|podcast|customer|support|service|news|actualit|educat|[ée]ducat|corporate|entreprise|young adult|jeune adulte|middle)/i;
/** Common descriptive words: a title made only of these is not someone's name ("Jeune Femme", "Voix Calme"). */
const DESCRIPTIVE = /\b(voix|voice|femme|homme|female|male|woman|man|jeune|young|calme|calm|douce|doux|soft|deep|grave|narrat\w*|conversation\w*|professionnel\w*|professional|french|fran[çc]ais\w*|english|anglais\w*|assistant\w*|natural|naturel\w*|warm|chaleureu\w*|clear|clair\w*|podcast|news|neutral|neutre|standard|default|support|service|pro|studio|v\d+|\d+)\b/gi;

const text = (v: FishVoice) => `${v.title} ${v.description} ${v.tags.join(" ")}`;

/** Whether a voice looks like it imitates a real person or a copyrighted character. */
export function isImitation(v: FishVoice): boolean {
  if (IMITATION.test(text(v))) return true;
  // "Firstname Lastname" (two or three capitalised words, nothing descriptive): most likely a real person's voice.
  const title = v.title.trim();
  if (/^\p{Lu}[\p{Ll}'’-]+(\s+\p{Lu}[\p{Ll}'’-]+){1,2}$/u.test(title) && title.replace(DESCRIPTIVE, " ").trim().split(/\s+/).filter(Boolean).length >= 2) return true;
  return false;
}

export function fishGender(v: FishVoice): Gender | null {
  const t = text(v);
  if (/\b(female|femme|woman|f[ée]minin\w*|feminine|girl|fille|her)\b/i.test(t)) return "female";
  if (/\b(male|homme|man|masculin\w*|masculine|boy|gar[çc]on)\b/i.test(t)) return "male";
  return null;
}

/** Higher is better: used a lot, liked, tagged for everyday talk; novelty voices last. */
export function fishScore(v: FishVoice): number {
  const t = `${v.title} ${v.tags.join(" ")}`;
  return Math.log10(v.uses + 1) + 0.5 * Math.log10(v.likes + 1) + (PREFERRED.test(t) ? 3 : 0) - (NOVELTY.test(t) ? 5 : 0);
}

/** The voices worth proposing from a library page, best first. */
export function fishCandidates(items: FishVoice[], lang: string): FishVoice[] {
  const seen = new Set<string>();
  return items
    .filter((v) => v.id && !seen.has(v.id) && seen.add(v.id))
    .filter((v) => v.state === "" || v.state === "trained")
    .filter((v) => !v.languages.length || v.languages.some((l) => l.toLowerCase().startsWith(lang)))
    .filter((v) => !isImitation(v) && !NOVELTY.test(`${v.title} ${v.tags.join(" ")}`))
    .sort((a, b) => fishScore(b) - fishScore(a) || (a.id < b.id ? -1 : 1));
}

/** Language a bot speaks for the library search: its own, else the account's (two letters). */
const langOf = (b: Pick<BotRecord, "voice">, locale: string) => ((b.voice?.lang && b.voice.lang !== "auto" ? b.voice.lang : locale).slice(0, 2).toLowerCase() || "fr");

/** One distinct voice per bot from the given candidates (per language), matching the bot's likely gender when it can. */
export function proposeFish(botList: Pick<BotRecord, "id" | "name" | "label" | "voice" | "createdAt">[], locale: string, pools: Map<string, FishVoice[]>): FishBulkProposal[] {
  const used = new Set<string>();
  const out: FishBulkProposal[] = [];
  const sorted = [...botList].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1));
  for (const b of sorted) {
    const pool = (pools.get(langOf(b, locale)) ?? []).filter((v) => !used.has(v.id));
    if (!pool.length) continue;
    const gender: Gender = genderHint(b) ?? ((hashId(b.id) >>> 7) & 1 ? "female" : "male");
    const pick = pool.find((v) => fishGender(v) === gender) ?? pool.find((v) => fishGender(v) === null) ?? pool[0];
    used.add(pick.id);
    out.push({ botId: b.id, botName: b.name, voice: pick });
  }
  return out;
}

/** Reads up to three pages of the library per language (popular first; free requests) and proposes. */
export async function fishBulkProposals(key: string, userId: string, botList: Pick<BotRecord, "id" | "name" | "label" | "voice" | "createdAt">[], locale: string): Promise<FishBulkProposal[]> {
  const pools = new Map<string, FishVoice[]>();
  for (const lang of new Set(botList.map((b) => langOf(b, locale)))) {
    const items: FishVoice[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await fishVoices(key, userId, { language: lang, page, sort: "task_count" });
      items.push(...r.items);
      if (!r.hasMore || fishCandidates(items, lang).length >= botList.length * 3) break;
    }
    pools.set(lang, fishCandidates(items, lang));
  }
  return proposeFish(botList, locale, pools);
}
