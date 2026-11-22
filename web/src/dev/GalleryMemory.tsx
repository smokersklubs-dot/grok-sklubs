import { NoLearnRow, PromptInspector, SemanticRow, SummaryView } from "../components/MemoryInsight";
import type { ConversationSummary, PromptView, SemanticSetting } from "../types";
import { fakeBot, NOW, type FixtureOptions } from "./fixtures";

/** Gallery « memoire »: « Voir le résumé », « Ne rien retenir », « Ce que reçoit ce bot », « Mémoire par le sens » (L71–L138). */
export function GalleryMemory({ o }: { o: FixtureOptions & { empty?: boolean } }) {
  const bot = fakeBot(o);
  return (
    <div className="gallery-page is-auto settings-pane">
      <SummaryView bot={bot} tick={1} defaultOpen />
      <NoLearnRow bot={bot} initial={false} />
      <PromptInspector bot={bot} tick={1} />
      <SemanticRow />
    </div>
  );
}

const L = (o: FixtureOptions, fr: string, en: string) => (o.lang === "fr" ? fr : en);
const LONG = "Une consigne très longue qui ne doit jamais déborder de l'écran sur un téléphone de 390 pixels de large, même sans espace : https://exemple.fr/un/chemin/tres/long/sans/aucune/coupure/possible/pour/tester";

export function summaryFixture(o: FixtureOptions, empty: boolean): { summary: ConversationSummary | null } {
  if (empty) return { summary: null };
  const sections = [["Who the user is", L(o, "Léa, gérante d'une boutique de vélos à Nantes.", "Léa runs a bike shop in Nantes.")], ["Goals, preferences and standing instructions", L(o, "Réponses courtes, tutoiement.", "Short answers.")],
    ["Decisions made", L(o, "Devis 4521 accepté le 2026-11-18.", "Quote 4521 accepted on 2026-11-18.")], ["Facts, names, numbers, links and ids", o.long ? LONG : "Camille — 06 12 34 56 78"],
    ["What was done and how it turned out", L(o, "J'ai envoyé le devis par e-mail.", "I emailed the quote.")], ["Still open or promised", L(o, "Relancer Camille vendredi.", "Follow up with Camille on Friday.")]];
  return { summary: { at: NOW - 3600_000, before: 184, after: 9, flushed: true, summary: sections.map(([h, b]) => `## ${h}\n${b}`).join("\n") } };
}

export function promptViewFixture(o: FixtureOptions, empty: boolean): PromptView {
  const part = (title: string, text: string, kind: "fixed" | "turn") => ({ title, text: title === "Who the bot is" ? text : `## ${title}\n${text}`, chars: text.length + title.length, tokens: Math.ceil((text.length + title.length) / 4), kind });
  const parts = [
    part("Who the bot is", L(o, "You are Léo, one of the AI teammates working for Léa.", "You are Leo, one of the AI teammates working for Lea."), "fixed"),
    part("How you work", "- Save lasting facts and preferences with memory_save.\n- Look things up with memory_search before asking the user to repeat themselves.", "fixed"),
    part("About the user (shared profile, known to every bot on the team)", "- Name: Léa\n- Timezone: Europe/Paris", "fixed"),
    part(o.long ? `Standing instructions from Léa — ${LONG}` : "Standing instructions from Léa", o.long ? LONG : "Réponses courtes.", "fixed"),
    ...(empty ? [] : [part("What you remember", "- Préfère les réunions le matin (noted 2026-11-12)\n- Le devis 4521 est accepté (noted 2026-11-18)", "turn")]),
  ];
  const memTokens = empty ? 0 : 31;
  return { parts, totalChars: parts.reduce((n, p) => n + p.chars, 0), totalTokens: parts.reduce((n, p) => n + p.tokens, 0),
    memory: { total: empty ? 0 : 212, shown: empty ? 0 : 37, hidden: empty ? 0 : 175, chars: memTokens * 4, tokens: memTokens, lines: [] },
    context: { chars: 120_000, tokens: 30_000, compactAt: 300_000, percent: 40 }, profileShared: true, noLearn: false };
}

export const semanticFixture = (empty: boolean): SemanticSetting => (empty ? { enabled: false, provider: null, model: null } : { enabled: false, provider: "OpenAI", model: "text-embedding-3-small" });
