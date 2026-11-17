import type { BotVoiceChoice } from "../shared.js";
import type { BotRecord } from "../store.js";
import { KOKORO_AUTO } from "./kokoro.js";
import { availablePiperVoices, PIPER_VARIANTS } from "./piper.js";

/**
 * A distinct free voice for every bot, without any setting (the owner never has to pick one): each agent bot of an
 * account that has no voice of its own speaks with one of the bundled free voices: Kokoro's first, for their quality
 * (voice/kokoro.ts KOKORO_AUTO, when the server's Kokoro answers), then Piper's (voice/piper.ts). French has a single
 * Kokoro voice (ff_siwis): French bots get it, then the Piper French voices. If Kokoro stops answering, the bots are
 * given Piper voices again until it is back (the same way, so the same voices come back).
 *
 *  - Stable: derived from the bot's id (FNV-1a hash → a starting place in the pool), and bots are taken in the order
 *    they were made, so a new bot never changes the voice of an existing one.
 *  - Distinct: a voice already used by an earlier bot of the account (given automatically, or chosen) is skipped; once
 *    every voice of the pool is used, the same voices come back with another pace and expressiveness (PIPER_VARIANTS),
 *    so two bots still do not sound alike. (Deleting a bot can only move the voice of a later bot that had been pushed
 *    aside by it — the price of keeping nothing in the database.)
 *  - Gender: a hint from the bot's name (common first names), its label (« assistante », « directrice »…), or the name
 *    of the browser voice it had before; without a hint, the hash picks one, so an account gets a mix.
 *  - Language: the bot's own language, else the account's; Kokoro also speaks es, it, pt, hi, ja, zh. A language
 *    without any free voice uses the account's language, else French.
 */

export type Gender = "female" | "male";

const FEMALE = new Set(("ava alice anna emma lea léa chloe chloé manon sarah julie marie sophie laura clara ines inès jade louise lina zoe zoé zoë eva lola rose mia nina juliette margaux pauline charlotte lucie lucy olivia amelia isla grace ella emily jessica jennifer linda nora luna iris elena maya victoria valentine mathilde elise élise agathe anais anaïs celine céline nathalie isabelle claire helene hélène sandrine aurelie aurélie amelie amélie oceane océane lisa lena léna romane eloise éloïse alexa siri cortana sofia sara hanna hannah kate katie mary elizabeth jane lily chiara giulia maria carmen lucia beatrice béatrice agnes agnès julia morgane audrey estelle fanny gaelle gaëlle melanie mélanie noemie noémie salome salomé solene solène stephanie stéphanie valerie valérie virginie adele adèle apolline capucine constance diane emilie émilie florence gabrielle hortense jeanne josephine joséphine louna margot marine maelle maëlle ophelie ophélie perrine roxane suzanne sylvie yasmine amira fatima aicha aïcha samira leila leïla nadia denise audrey amandine anne annie brigitte caroline catherine cecile cécile christine delphine eleonore éléonore emmanuelle eve ève francoise françoise geraldine géraldine helena ingrid jacqueline jasmine jennie karine lea laetitia léonie leonie madeleine marion martine maud michele michèle monique muriel nicole odile patricia sabine severine séverine simone sonia tatiana vanessa veronique véronique yvonne alba alma ambre anaelle anaëlle bianca celia célia elsa jeanne lise mila nour olga paula rachel rebecca rita ruby stella tessa thea théa ursula vera zara").split(" "));
const MALE = new Set(("paul pierre hugo louis lucas leo léo gabriel arthur jules raphael raphaël adam nathan tom thomas theo théo noah ethan mathis enzo maxime alexandre antoine nicolas julien guillaume romain kevin jean jacques michel philippe olivier oliver david daniel marc eric éric sebastien sébastien laurent vincent victor martin simon benjamin samuel clement clément baptiste quentin matthieu mathieu florian adrien axel bastien cedric cédric damien fabien franck frank gael gaël henri henry jack james john george harry william charles oscar max felix félix sam ben bob alfred jarvis hal marcel rene rené robert roger xavier yann yves zack ahmed karim mehdi mohamed omar youssef rayan ilyes amine bilal hamza ibrahim malik nassim walid yanis ali carlos diego luca marco mario giovanni hans igor ivan kenji akira liam mason logan jacob ryan tyler dylan brandon kyle justin andrew anthony christopher joseph steven steve mike peter tony bruce clark alan albert edgar edouard édouard emile émile ernest gaston gustave lionel leon léon lucien marius octave pascal patrick regis régis serge thierry timothee timothée tristan ulysse valentin bernard alain andre andré bruno christian denis didier francis francois françois frederic frédéric gerard gérard gilles herve hervé jerome jérôme joel joël luc ludovic marcel mickael mickaël noel noël pascal raymond sylvain thibault thibaut william yannick aaron elias elie élie gaspard ismael ismaël kylian lenny loic loïc marin milo nolan timeo timéo").split(" "));
const FEMALE_LABEL = /\b(assistante|directrice|conseill[èe]re|r[ée]dactrice|commerciale|charg[ée]e|experte|avocate|vendeuse|h[ôo]tesse|ambassadrice|traductrice|organisatrice|coordinatrice|animatrice|formatrice|consultante|she|her|woman|femme|female|féminine|feminine)\b/i;
const MALE_LABEL = /\b(directeur|conseiller|r[ée]dacteur|vendeur|ambassadeur|traducteur|organisateur|coordinateur|animateur|formateur|he|him|man|homme|male|masculin|masculine)\b/i;

const words = (s: string) => s.toLowerCase().split(/[^a-zà-ÿ-]+/).filter(Boolean);

/** The gender a bot most likely has, from what the owner wrote about it; null when nothing says. */
export function genderHint(bot: Pick<BotRecord, "name" | "label" | "voice">): Gender | null {
  const browserVoice = bot.voice?.name ?? "";
  if (/\b(female|femme|woman)\b/i.test(browserVoice)) return "female";
  if (/\b(male|homme|man)\b/i.test(browserVoice)) return "male";
  for (const w of words(bot.name)) { if (FEMALE.has(w)) return "female"; if (MALE.has(w)) return "male"; }
  if (FEMALE_LABEL.test(bot.label ?? "")) return "female";
  if (MALE_LABEL.test(bot.label ?? "")) return "male";
  // The browser voice it used before ("Amélie", "Microsoft Denise", "Thomas"): keep the same kind of voice.
  for (const w of words(browserVoice)) { if (FEMALE.has(w)) return "female"; if (MALE.has(w)) return "male"; }
  return null;
}

/** FNV-1a, 32 bits: a stable number from a bot id (same id → same number, on every server). */
export function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The bot's language (two letters): its own, else the account's. */
export const voiceLang = (bot: Pick<BotRecord, "voice">, locale: string): string => (bot.voice?.lang && bot.voice.lang !== "auto" ? bot.voice.lang : locale).slice(0, 2).toLowerCase() || "fr";

/** A free voice that can be given automatically. `id`: a Piper voice id, or a Kokoro voice id. */
export interface FreeVoice { provider: "piper" | "kokoro"; id: string; name: string; gender: Gender; language: string; licence: string }
export interface AutoVoice { voice: FreeVoice; variant: number; gender: Gender; hinted: boolean }

export interface AssignInput {
  /** The account's bots (agents only are given a voice), any order: sorted here by creation, then id. */
  bots: Pick<BotRecord, "id" | "kind" | "name" | "label" | "voice" | "createdAt">[];
  locale: string;
  /** The bot's own voice, when it has one that works (it then needs no automatic voice). */
  own: (botId: string) => BotVoiceChoice | null;
  /** The models the Piper server has (null: unknown, the whole catalogue; an empty set: no Piper). */
  models: Set<string> | null;
  /** Kokoro: false = not running; null = running, voices not listed yet (all of KOKORO_AUTO); else the voices it has. */
  kokoro?: Set<string> | null | false;
}

/** Piper models too noisy to be given automatically (still selectable by hand). */
export const LOW_QUALITY_MODELS = new Set(["fr_FR-mls-medium"]);

/** The free voices on offer: Kokoro's (best first) then Piper's. */
export function freeVoices(models: Set<string> | null, kokoro: Set<string> | null | false = false): FreeVoice[] {
  const k: FreeVoice[] = kokoro === false ? [] : KOKORO_AUTO.filter((v) => !kokoro || kokoro.has(v.id)).map((v) => ({ provider: "kokoro", id: v.id, name: v.name, gender: v.gender, language: v.language, licence: "Apache-2.0" }));
  // Only the clean studio voices are given automatically: fr_FR-mls-medium is trained on amateur audiobook recordings
  // (Multilingual LibriSpeech) and sounds noisy; its speakers stay available by hand in Settings → Voice.
  const p: FreeVoice[] = availablePiperVoices(models).filter((v) => !LOW_QUALITY_MODELS.has(v.model)).map((v) => ({ provider: "piper", id: v.id, name: v.name, gender: v.gender, language: v.language, licence: v.licence }));
  return [...k, ...p];
}

/** Every bot of the account → its automatic voice (bots with a working voice of their own are not in the map). */
export function assignVoices(input: AssignInput): Map<string, AutoVoice> {
  const out = new Map<string, AutoVoice>();
  const voices = freeVoices(input.models, input.kokoro === undefined ? false : input.kokoro);
  if (!voices.length) return out;
  const agents = input.bots.filter((b) => b.kind === "agent").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = new Set<string>();
  const key = (v: { provider: string; id: string }, variant: number) => `${v.provider}:${v.id}|${variant}`;
  // Voices chosen by hand count as used first, whoever chose them.
  for (const b of agents) { const o = input.own(b.id); if (o?.provider === "piper" || o?.provider === "kokoro") taken.add(key({ provider: o.provider, id: o.voiceId }, 0)); }
  const fallbackLang = voices.some((v) => v.language === input.locale.slice(0, 2)) ? input.locale.slice(0, 2) : "fr";
  for (const b of agents) {
    if (input.own(b.id)) continue;
    const h = hashId(b.id);
    const want = voiceLang(b, input.locale);
    const lang = voices.some((v) => v.language === want) ? want : fallbackLang;
    const hint = genderHint(b);
    const gender: Gender = hint ?? ((h >>> 7) & 1 ? "female" : "male");
    const inLang = voices.filter((v) => v.language === lang);
    const langPool = inLang.length ? inLang : voices;
    // In order: Kokoro's voices best first, then Piper's from a place given by the hash (so accounts differ).
    const ordered = (list: FreeVoice[]) => {
      const k = list.filter((v) => v.provider === "kokoro");
      const p = list.filter((v) => v.provider === "piper");
      return [...k, ...p.map((_, i) => p[(h + i) % p.length])];
    };
    const same = ordered(langPool.filter((v) => v.gender === gender));
    const other = ordered(langPool.filter((v) => v.gender !== gender));
    // Without a hint (or when the language has no voice of that gender), the other gender's voices come next.
    const tiers = !same.length ? [other] : hint ? [same] : [same, other];
    let picked: AutoVoice | null = null;
    for (const candidates of tiers) {
      for (let variant = 0; !picked && variant < PIPER_VARIANTS.length; variant++) {
        const v = candidates.find((c) => !taken.has(key(c, variant)));
        if (v) { picked = { voice: v, variant, gender: v.gender, hinted: !!hint }; taken.add(key(v, variant)); }
      }
      if (picked) break;
    }
    // More bots than voices × variants (hundreds): the hash alone, distinct enough no more.
    const first = (same.length ? same : other)[0];
    out.set(b.id, picked ?? { voice: first, variant: h % PIPER_VARIANTS.length, gender: first.gender, hinted: !!hint });
  }
  return out;
}
