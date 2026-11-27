import { JournalWhy } from "../components/JournalWhy";
import { MemoryFocusField } from "../components/MemoryFocus";
import { MemoryPlaces } from "../components/MemoryPlaces";
import { ReviewPlus } from "../components/PeerReviewPlus";
import { ReviewRulesField } from "../components/ReviewRules";
import { ResearchArchive, ReportWatch } from "../components/ResearchWatch";
import { ShortRepliesField } from "../components/ShortReplies";
import { fakeBot, NOW, type FixtureOptions } from "./fixtures";

/**
 * Gallery « lignes23 »: what the 23/11 rows added — « Retiens surtout » (L67), documents and site notes (L88),
 * « Réponses courtes » (L132), « Pourquoi ? » in the journal (L137), project review rules, several reviewers and
 * « faire corriger par l'auteur » (L77), « Veille », past reports and the Atom feed (L87). « Vide »: nothing saved yet.
 */
export function GalleryRows23({ o }: { o: FixtureOptions & { empty?: boolean } }) {
  const bot = fakeBot(o);
  const fr = o.lang === "fr";
  const candidates = [{ id: "b2", name: "Nova", provider: "openai", otherProvider: true }, { id: "b3", name: o.long ? "Relecteur avec un nom vraiment très long pour un téléphone" : "Max", provider: "anthropic", otherProvider: false }];
  return (
    <div className="gallery-page is-auto settings-pane">
      <MemoryFocusField bot={bot} />
      <MemoryPlaces bot={bot} />
      <ShortRepliesField bot={bot} />
      <div className="journal"><div className="journal-table"><JournalWhy id={1} /></div></div>
      <ReviewRulesField sectionId="sec_gallery" />
      <div className="peer-review"><ReviewPlus bot={bot.id} seq={7} fr={fr} changes={!o.empty} candidates={candidates} /></div>
      <section className="dock-reader research-panel">
        <ReportWatch base={`/bots/${bot.id}/research`} report="rep_1" fr={fr} />
        <ResearchArchive fr={fr} />
      </section>
    </div>
  );
}

const L = (o: FixtureOptions, fr: string, en: string) => (o.lang === "fr" ? fr : en);
const LONG = "https://exemple.fr/un/chemin/tres/long/sans/aucune/coupure/possible/pour/tester/le/debordement";

/** The fake server's answers for these screens (fakeApi.ts). */
export function rows23Get(path: string, o: FixtureOptions & { empty: boolean }): unknown {
  const e = o.empty;
  if (/^\/bots\/[^/]+\/memory-focus$/.test(path)) return { text: e ? "" : L(o, "Mes clients et leurs délais ; pas mes goûts culinaires.", "My clients and their deadlines; not my food tastes.") };
  if (path === "/docbase") return { docs: e ? [] : [{ id: "d1", name: o.long ? "Tarifs 2027 de la boutique, livraison comprise, pour la France, la Belgique et la Suisse" : L(o, "Tarifs 2027", "2027 prices"), chars: 12_480, createdAt: NOW - 86400_000 }] };
  if (path === "/site-notes") return { notes: e ? [] : [{ id: "s1", host: "impots.gouv.fr", text: o.long ? LONG : L(o, "La facture est sous Compte → Documents.", "The invoice is under Account → Documents."), botName: "Léo", createdAt: NOW - 3600_000 }] };
  if (/^\/bots\/[^/]+\/short-replies$/.test(path)) return { enabled: !e, maxSentences: 3, maxWords: 60, channels: ["telegram", "voice"] };
  if (/^\/journal\/\d+\/why$/.test(path)) return { entry: { decision: "words", quote: L(o, "Envoie le devis à Camille", "Send the quote to Camille"), reason: "", botName: "Léo" }, userWords: { text: o.long ? `${L(o, "Envoie le devis à Camille", "Send the quote to Camille")} ${LONG}` : L(o, "Envoie le devis à Camille, s'il te plaît.", "Send the quote to Camille, please."), at: NOW - 600_000 }, knew: e ? null : { at: NOW - 610_000, parts: [{ title: "Who the bot is", chars: 900 }, { title: "Rules from Léa", chars: 300 }, { title: "What you remember", chars: 420 }], notes: [L(o, "Camille est la cliente du devis 4521 (noted 2026-11-18)", "Camille is the client of quote 4521 (noted 2026-11-18)"), L(o, "Léa veut les devis en PDF", "Lea wants quotes as PDF")] } };
  if (/^\/sections\/[^/]+\/review-rules$/.test(path)) return { text: e ? "" : L(o, "Pas de console.log ; chaque nouvelle page a son test.", "No console.log; every new page has its test."), minReviewers: e ? 1 : 2 };
  if (/\/files\/review-panel$/.test(path)) return e ? { reviews: [], needed: 1, approvals: 0, verdict: "none" } : { reviews: [{ reviewer: "b2", name: "Nova", state: "ready", review: { verdict: "approved", reason: "" } }, { reviewer: "b3", name: "Max", state: "ready", review: { verdict: "changes", reason: "" } }], needed: 2, approvals: 1, verdict: "changes" };
  if (/\/research\/[^/]+\/watch$/.test(path)) return e ? { every: null, nextAt: null } : { every: "week", nextAt: NOW + 6 * 86400_000 };
  if (path === "/research/feed") return { enabled: !e };
  return undefined;
}
