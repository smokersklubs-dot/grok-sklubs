/**
 * Gallery « confort9 » (section=confort9): wave 9 web rows on the real components, with the fake API (comfort9Get).
 *   (no view)       a published page with « Commenter la page » (L140; the comment layer runs in the sandboxed sample),
 *                   « Fichiers modifiés » with a remark per file (L140), a background task card with its time and cost (L142)
 *   view=annotate   « Annoter » an image: pins, pen, notes (L140)
 *   view=show       « Montrer » over the bot's screen (L140)
 *   view=step       a step in full (L142)
 *   view=selfcheck  « Vérifier ce bot » running (L153)
 *   view=side       two chats side by side (L146; 1 100 px and wider)
 *   view=settings   Settings navigation with « Mode simple » on (L145)
 */
import { useEffect, useRef } from "react";
import { useStore } from "../store";
import type { Bot, Card, Live, Row } from "../types";
import { PagePreview, setPagePreviewSource } from "../components/PagePreview";
import { FilesCardView } from "../components/SecretsFilesProviders";
import { TaskCardView } from "../components/RulesAndNudges";
import { ImageAnnotate } from "../components/ImageAnnotate";
import { ShowOnScreen } from "../components/ShowOnScreen";
import { StepDetailButton } from "../components/StepDetail";
import { BotSelfCheck } from "../components/BotSelfCheck";
import { ChatView } from "../components/ChatView";
import { Sidebar } from "../components/Sidebar";
import { SideChat } from "../components/SideChat";
import { SettingsNavigation } from "../components/SettingsNavigation";
import { withCommentLayer } from "../../../server/src/clientshared/pagecomment";
import samplePageHtml from "./sample-page.html?raw";
import { chatRows, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";
import { chatBot } from "./GalleryChat";
import { fakeScreen } from "./commandFixtures";

const fr = (o: FixtureOptions) => o.lang === "fr";
const SIDE_ID = "bot_gallery_side";
const pageBlob = URL.createObjectURL(new Blob([withCommentLayer(samplePageHtml)], { type: "text/html" }));
const screenUrl = URL.createObjectURL(fakeScreen("jiren"));
const IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f4efe6"/><rect x="80" y="70" width="1040" height="120" rx="16" fill="#2b4c7e"/><text x="120" y="148" font-size="56" font-family="sans-serif" fill="#fff">Thés Lumière</text><rect x="80" y="240" width="500" height="460" rx="16" fill="#fff"/><circle cx="330" cy="420" r="120" fill="#7fb069"/><rect x="640" y="240" width="480" height="60" rx="10" fill="#e6b655"/><rect x="640" y="330" width="420" height="30" rx="8" fill="#ccc"/><rect x="640" y="380" width="380" height="30" rx="8" fill="#ccc"/><rect x="640" y="600" width="240" height="80" rx="40" fill="#c0392b"/><text x="690" y="652" font-size="34" font-family="sans-serif" fill="#fff">Acheter</text></svg>`)}`;

export function GalleryComfort9({ o }: { o: FixtureOptions }) {
  const p = new URLSearchParams(location.search);
  const view = p.get("view");
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPagePreviewSource((url, comment) => (comment ? pageBlob : url));
    const main = chatBot(o);
    const side: Bot = { ...main, id: SIDE_ID, primary: false, name: o.long ? "Veille concurrentielle et salons professionnels" : "Veille", label: fr(o) ? "recherche" : "research", color: "moss" } as Bot;
    const rows = chatRows(o);
    const sideRows: Row[] = rows.slice(0, 6).map((r) => ({ ...r, botId: SIDE_ID }) as Row);
    const idle: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    useStore.setState({
      bots: { [main.id]: main, [side.id]: side }, selectedId: main.id, view: "chat", detailsOpen: false, boot: "ready",
      threads: {
        [main.id]: { generation: 1, rows, loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null },
        [side.id]: { generation: 1, rows: sideRows, loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null },
      },
      live: { [main.id]: idle, [side.id]: { ...idle, running: true, startedAt: NOW - 60_000, activity: { kind: "browsing", detail: "", since: NOW - 5000 } } }, openThread: null,
    } as never);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bot = useStore((s) => s.bots[GALLERY_BOT_ID]);
  if (!bot) return null;
  const pane = (children: React.ReactNode) => <div className="gallery-page is-auto" style={{ maxWidth: 760, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
  if (view === "annotate") return <ImageAnnotate botId={bot.id} src={IMAGE} name={fr(o) ? "maquette-accueil.png" : "home-mockup.png"} onClose={() => undefined} />;
  if (view === "show") return (
    <div className="viewer" style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#0b0d12" }}>
      <div className="viewer-stage" ref={stage}>
        <img src={screenUrl} alt="" />
        <ShowOnScreen botId={bot.id} botName={bot.name} stage={stage} onClose={() => undefined} />
      </div>
    </div>
  );
  if (view === "step") return pane(<ul className="steps"><li className="step"><span className="step-label">{fr(o) ? "Lire la page des tarifs" : "Read the pricing page"}<StepDetailButton botId={bot.id} seq={42} generation={1} /></span></li></ul>);
  if (view === "selfcheck") return <BotSelfCheck bot={bot} onClose={() => undefined} />;
  if (view === "settings") return <div className="app-settings" style={{ position: "static" }}><SettingsNavigation section="general" /></div>;
  if (view === "side") return <div className="shell gallery-app has-side"><Sidebar /><ChatView /><SideChat botId={SIDE_ID} /></div>;
  const files = { type: "files", snapId: "sn_g", baseId: "sb_g", status: "available", more: 0, files: [
    { path: o.long ? "site/pages/tarifs-et-abonnements-pour-les-professionnels/index.html" : "site/index.html", change: "modified", added: 12, removed: 3, binary: false, oldSize: 2100, newSize: 2600 },
    { path: "site/logo.png", change: "added", added: null, removed: null, binary: true, oldSize: null, newSize: 48000 },
  ] } as unknown as Extract<Card, { type: "files" }>;
  const task = { type: "task", taskId: "bgt_gallery", helperId: "bot_helper", title: o.long ? (fr(o) ? "Comparer les prix de vingt concurrents en ligne et en boutique" : "Compare twenty competitors' prices online and in shops") : (fr(o) ? "Comparer les prix" : "Compare prices"), state: "running", steps: 7 } as unknown as Extract<Card, { type: "task" }>;
  return pane(<>
    <PagePreview text={`[${fr(o) ? "Ventes de novembre" : "November sales"}](${location.origin}/p/galleryDemoPageToken0001)`} botId={bot.id} />
    <FilesCardView card={files} botId={bot.id} seq={7} />
    <TaskCardView card={task} botId={bot.id} />
  </>);
}

/** What the fake API answers for the wave 9 routes (fakeApi.ts). */
export function comfort9Get(path: string, o: FixtureOptions & { empty: boolean }): unknown | undefined {
  const F = fr(o);
  if (/^\/bots\/[^/]+\/bgtasks\/[^/]+\/cost$/.test(path)) return { taskId: "bgt_gallery", costUsd: 0.042, estimatedUsd: o.long ? 0.011 : 0, turns: 5, inputTokens: 12000, outputTokens: 2400, startedAt: NOW - 260_000, endedAt: null, durationMs: 260_000 };
  if (/^\/bots\/[^/]+\/steps\/\d+$/.test(path)) return {
    seq: 42, tool: "web_fetch", label: F ? "Lire la page des tarifs" : "Read the pricing page", status: "done",
    args: { url: o.long ? "https://www.exemple-de-boutique-de-the.fr/collections/thes-verts-et-infusions-bio?page=2&tri=prix-croissant" : "https://exemple.fr/tarifs", tags: true },
    summary: F ? "Page lue (3 200 mots)" : "Page read (3,200 words)", startedAt: NOW - 90_000, endedAt: NOW - 86_500, durationMs: 3500,
    result: { text: (F ? "# Tarifs\n\n- Thé vert : 8,50 €\n- Thé noir : 7,90 €\n- Coffret découverte : 24 €\n" : "# Prices\n\n- Green tea: €8.50\n- Black tea: €7.90\n- Gift box: €24\n").repeat(o.long ? 30 : 1), truncated: o.long, isError: false, images: 0 },
    journal: { decision: "words", reason: F ? "Tu as demandé de lire cette page." : "You asked to read this page.", quote: F ? "lis la page des tarifs" : "read the pricing page", costUsd: 0.004, status: "done" },
  };
  if (/^\/bots\/[^/]+\/selfcheck$/.test(path)) return o.empty ? { file: "missing", page: false, journal: [] } : { file: "match", page: true, journal: [
    { id: 3, at: NOW, tool: "file_read", label: F ? "Relire sklubot-verification.txt" : "Read back sklubot-verification.txt", status: "done", decision: "free" },
    { id: 2, at: NOW, tool: "file_save", label: F ? "Enregistrer sklubot-verification.txt" : "Save sklubot-verification.txt", status: "done", decision: "words" },
    { id: 1, at: NOW, tool: "web_fetch", label: F ? "Lire la page" : "Read the page", status: "done", decision: "free" },
  ] };
  return undefined;
}
