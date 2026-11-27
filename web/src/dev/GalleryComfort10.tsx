/**
 * Gallery « confort10 » (section=confort10): wave 10 rows on the real components, with the fake API (comfort10Get).
 *   (no view)      « pas à pas » cards: the setup list (L145) and a Docteur fix (L153); the engine warm-up lines (L145);
 *                  « Ce qui reste à installer » in the main bot's empty chat (L145)
 *   view=plan      a plan for the work board, waiting and put on the board (L163)
 *   view=roles     the board's roles with « Proposer un bot » on a role nobody holds (L163)
 *   view=grid      the 2×2 chat grid (L146; 1 400 px and wider — narrower, the main chat only)
 *   view=layouts   « Dispositions » saved on this device (L146)
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Bot, Live, Row } from "../types";
import type { StepGuideCard, EngineWarmup } from "../../../server/src/guidetypes";
import type { BoardPlanCard } from "../../../server/src/boardplantypes";
import type { BoardRole } from "../../../server/src/workboardtypes";
import { StepGuideCardView, SetupGuideOffer } from "../components/StepGuide";
import { EngineWarmupView } from "../components/EngineWarmup";
import { BoardPlanCardView } from "../components/BoardPlan";
import { BoardRolesPanel } from "../components/BoardRoles";
import { ChatLayoutsDialog } from "../components/ChatLayouts";
import { ChatView } from "../components/ChatView";
import { Sidebar } from "../components/Sidebar";
import { SideChat, useSideBots } from "../components/SideChat";
import { LAYOUTS_KEY } from "../lib/chatlayouts";
import { layoutClass, useSideChat } from "../lib/sidechat";
import { chatRows, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";
import { chatBot } from "./GalleryChat";

const fr = (o: FixtureOptions) => o.lang === "fr";
const SIDE = ["bot_g10_a", "bot_g10_b", "bot_g10_c"];

function setupCard(o: FixtureOptions): StepGuideCard {
  const F = fr(o);
  return {
    type: "stepguide", guideId: "setup", title: F ? "Ce qui reste à installer" : "What remains to set up", ready: 2, status: "pending",
    intro: F ? "Finissons l'installation ensemble. Chaque étape a un bouton « Vérifier » qui confirme que ça a marché. Rien ici n'est payant, et les clés ou mots de passe se tapent dans Réglages, jamais dans cette discussion." : "Let's finish setting up, together. Each step has a « Vérifier » button that confirms it worked. Nothing here costs money, and keys or passwords are typed in Settings, never in this chat.",
    steps: [
      { id: "s1", title: F ? "Vérifier que le modèle répond" : "Check that the model answers", detail: F ? "« Vérifier » envoie un tout petit message d'essai au modèle de ton bot principal (ou regarde le préchauffage de son moteur)." : "« Vérifier » sends a tiny test message to your main bot's model (or looks at its engine's warm-up).", check: "model.answers", state: "ok", hint: F ? "Le modèle a répondu." : "The model answered.", checkedAt: NOW },
      { id: "s2", title: F ? "Préparer les ordinateurs des bots" : "Prepare the bots' computers", detail: F ? "Sur la machine qui fait tourner Sklubot, dans le dossier de Sklubot, tape cette commande une fois (c'est gratuit ; ça prend quelques minutes)." : "On the machine that runs Sklubot, in the Sklubot folder, type this command once (it is free; it takes a few minutes).", command: "npm run computer:build", check: "computer.ready", state: "notyet", hint: o.long ? (F ? "Les ordinateurs des bots ne sont pas prêts : the desktop image \"sklubot-desktop-avec-un-nom-tres-long-pour-voir\" has not been built yet." : "The bots' computers are not ready: the desktop image \"sklubot-desktop-with-a-very-long-name-to-see\" has not been built yet.") : (F ? "Les ordinateurs des bots ne sont pas prêts : Docker is not installed or not running." : "The bots' computers are not ready: Docker is not installed or not running.") },
      { id: "s3", title: F ? "Activer la double vérification" : "Turn on two-factor sign-in", detail: F ? "Dans Réglages → Compte : scanne le code avec une appli d'authentification sur ton téléphone, puis tape les 6 chiffres qu'elle affiche." : "In Settings → Account: scan the code with an authenticator app on your phone, then type the 6 digits it shows.", check: "two_factor.on", open: "account", state: "todo" },
    ],
  };
}
function doctorCard(o: FixtureOptions, status: StepGuideCard["status"]): StepGuideCard {
  const F = fr(o);
  const done = status === "done";
  return {
    type: "stepguide", guideId: "doctor:account.two_factor", doctorKey: "doctor.twoFactor", title: F ? "Réparer pas à pas" : "Fix it step by step", status,
    intro: F ? "Suis les étapes dans l'ordre ; « Vérifier » te dit quand c'est réparé." : "Follow the steps in order; « Vérifier » tells you when it is fixed.",
    steps: [
      { id: "s1", title: F ? "Installer une appli d'authentification" : "Install an authenticator app", detail: F ? "Sur ton téléphone : n'importe quelle appli d'authentification marche. C'est gratuit." : "On your phone: any authenticator app works. It is free.", check: "self", state: "ok" },
      { id: "s2", title: F ? "Activer la double vérification" : "Turn on two-factor sign-in", detail: F ? "Dans Réglages → Compte : scanne le code, puis tape les 6 chiffres." : "In Settings → Account: scan the code, then type the 6 digits.", check: "two_factor.on", open: "account", state: done ? "ok" : "todo", ...(done ? { hint: F ? "La double vérification est activée." : "Two-factor sign-in is on." } : {}) },
    ],
  };
}
function planCard(o: FixtureOptions, status: BoardPlanCard["status"]): BoardPlanCard {
  const F = fr(o);
  const L = o.long;
  return {
    type: "boardplan", planId: "bpl_g", status, title: L ? (F ? "Refonte complète du site vitrine de la boulangerie avec commandes en ligne" : "Full redesign of the bakery's website with online orders") : (F ? "Site vitrine" : "Website"),
    why: F ? "Mettre le site en ligne avant les fêtes, relu et documenté." : "Get the site online before the holidays, reviewed and documented.",
    missingRoles: ["review"],
    tasks: [
      { title: F ? "Écrire la page d'accueil" : "Write the home page", description: L ? (F ? "Titre, horaires, carte des pains, formulaire de commande avec retrait en boutique, version téléphone d'abord." : "Title, hours, bread menu, order form with in-shop pickup, phone first.") : "", kind: "code", botId: "bot_c", botName: L ? "Codeuse-des-pages-très-longues" : "Codeuse", priority: 2, after: [] },
      { title: F ? "Relire la page" : "Review the page", description: "", kind: "review", botId: null, botName: "", priority: 3, after: [0] },
      { title: F ? "Écrire le mode d'emploi" : "Write the how-to", description: "", kind: "docs", botId: "bot_d", botName: "Doc", priority: 4, after: [1] },
    ],
    ...(status === "created" ? { taskIds: ["bt_1", "bt_2", ""], launched: false, proposedRoles: ["review"] } : {}),
  };
}
const warm = (state: EngineWarmup["state"], o: FixtureOptions): EngineWarmup => ({ botId: GALLERY_BOT_ID, engine: "codex", state, ms: state === "ready" ? 3200 : null, at: NOW, reason: state === "failed" ? (o.long ? (fr(o) ? "L'ordinateur du bot n'a pas pu démarrer : the computers are all busy right now and the waiting line is longer than usual" : "The bot's computer could not start: the computers are all busy right now and the waiting line is longer than usual") : (fr(o) ? "Le moteur n'est pas installé sur l'ordinateur de ce bot." : "The engine is not installed on this bot's computer.")) : null });

export function GalleryComfort10({ o }: { o: FixtureOptions }) {
  const view = new URLSearchParams(location.search).get("view");
  // Seeded before the first render: the dialog reads this device's layouts when it opens.
  useState(() => {
    if (view === "layouts") {
      try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify([
        { id: "lay_1", name: fr(o) ? "Matin" : "Morning", main: GALLERY_BOT_ID, side: [SIDE[0], SIDE[1]], savedAt: NOW },
        { id: "lay_2", name: o.long ? (fr(o) ? "Revue de fin de semaine avec toute l'équipe" : "End-of-week review with the whole team") : (fr(o) ? "Soir" : "Evening"), main: SIDE[2], side: [GALLERY_BOT_ID, "bot_deleted"], savedAt: NOW },
      ])); } catch { /* the gallery shows the empty list */ }
      useSideChat.getState().set([SIDE[0]]);
    }
    return true;
  });
  useEffect(() => {
    const main = chatBot(o);
    const names = fr(o) ? ["Veille", "Compta", "Relecteur"] : ["Research", "Books", "Reviewer"];
    const colors = ["moss", "amber", "rose"];
    const extra: Bot[] = SIDE.map((id, i) => ({ ...main, id, primary: false, name: o.long && i === 0 ? "Veille concurrentielle et salons professionnels" : names[i], color: colors[i], model: "gpw:gpw-1" }) as Bot);
    const rows = chatRows(o);
    const idle: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    const thread = (r: Row[]) => ({ generation: 1, rows: r, loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null });
    useStore.setState({
      bots: Object.fromEntries([main, ...extra].map((b) => [b.id, b])), selectedId: main.id, view: "chat", detailsOpen: false, boot: "ready", openThread: null,
      threads: Object.fromEntries([[main.id, thread(rows)], ...extra.map((b, i) => [b.id, thread(rows.slice(0, 4 + i).map((r) => ({ ...r, botId: b.id }) as Row))])]),
      live: Object.fromEntries([[main.id, idle], ...extra.map((b, i) => [b.id, i === 0 ? { ...idle, running: true, startedAt: NOW - 60_000, activity: { kind: "browsing", detail: "", since: NOW - 5000 } } : idle])]),
    } as never);
    if (view === "grid") useSideChat.getState().set(SIDE);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bot = useStore((s) => s.bots[GALLERY_BOT_ID]);
  if (!bot) return null;
  const pane = (children: React.ReactNode) => <div className="gallery-page is-auto" style={{ maxWidth: 760, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
  if (view === "grid") return <GridView />;
  if (view === "layouts") return <div className="shell gallery-app"><ChatLayoutsDialog onClose={() => undefined} /></div>;
  if (view === "plan") return pane(<>
    <BoardPlanCardView card={planCard(o, "pending")} botId={bot.id} seq={51} />
    <BoardPlanCardView card={planCard(o, "created")} botId={bot.id} seq={52} />
  </>);
  if (view === "roles") {
    const roles: BoardRole[] = [{ role: "lead", botId: null, model: "", pinned: false }, { role: "code", botId: "bot_g10_a", model: "", pinned: false }, { role: "review", botId: null, model: "", pinned: false }, { role: "research", botId: null, model: "", pinned: false }, { role: "docs", botId: null, model: "", pinned: false }, { role: "chore", botId: null, model: "", pinned: false }];
    return pane(<div className="wb-modal-gallery"><BoardRolesPanel roles={roles} sets={[]} bots={Object.values(useStore.getState().bots)} act={() => undefined} /></div>);
  }
  return pane(<>
    <SetupGuideOffer bot={bot} />
    <StepGuideCardView card={setupCard(o)} botId={bot.id} seq={41} />
    <StepGuideCardView card={doctorCard(o, "pending")} botId={bot.id} seq={42} />
    <StepGuideCardView card={doctorCard(o, "done")} botId={bot.id} seq={43} />
    <div className="composer-wrap" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {(["warming", "ready", "cold", "failed"] as const).map((s) => <EngineWarmupView key={s} w={warm(s, o)} onWarm={() => undefined} now={NOW} />)}
    </div>
  </>);
}

/** What the fake API answers for the wave 10 routes (fakeApi.ts). */
export function comfort10Get(path: string, o: FixtureOptions & { empty: boolean }): unknown | undefined {
  // Only in this section: the other chat galleries keep their layout as their own tests expect it.
  if (/^\/bots\/[^/]+\/engine-warmup$/.test(path) && new URLSearchParams(location.search).get("section") === "confort10") return { warmup: { ...warm(o.empty ? "cold" : "ready", o), at: Date.now() } };
  return undefined;
}

/** As App.tsx lays it out: the grid from 1 400 px, one chat beside from 1 100 px, the main chat alone below. */
function GridView() {
  const shown = useSideBots();
  return <div className={`shell gallery-app ${layoutClass(shown.length)}`}><Sidebar /><ChatView />{shown.map((id) => <SideChat key={id} botId={id} />)}</div>;
}
