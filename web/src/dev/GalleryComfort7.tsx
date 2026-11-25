/**
 * Gallery « confort7 » (section=confort7): wave 7 comfort on the real components, with the fake API (comfort7Get).
 *   (no view)      the app shell: the bell in the sidebar, the chat with a pinned message, a deleted one, the model chip
 *                  and the context gauge above the composer
 *   view=welcome   a new bot's empty chat: one question, 3 choices, 4 starters fitted to its role (L145)
 *   view=convs     « Conversations » of the bot: filters, folders, pinned, automatic (L146)
 *   view=trash     a bot's danger zone with « Voir ce qui sera supprimé » open, and Settings → Team → Corbeille (L144)
 *   view=office    Excel (two sheets), Word, PowerPoint and a CSV in the file viewer (L148)
 *   view=connect  « Connecter des applis »: the catalog, before anything is added (connect-flow.test.mjs)
 *   view=pages     a page's exports, « Comparer », the « rien de perdu » card and the design journal (L157); bell=1 opens the bell (L151)
 */
import { useEffect } from "react";
import { useStore } from "../store";
import type { Bot, Live, PageLossCard, Row } from "../types";
import { ChatView } from "../components/ChatView";
import { Sidebar } from "../components/Sidebar";
import { ConversationsModal } from "../components/Conversations";
import { BotDangerZone, BotTrash } from "../components/BotLifecycle";
import { BotStyleField } from "../components/BotStyle";
import { HistoryRetention } from "../components/HistoryRetention";
import { OfficeView, SheetTable } from "../components/OfficeView";
import { PageDiffButton, PageExports } from "../components/PageExtras"; import { DesignJournal, PageLossCardView } from "../components/PageKeep"; import { ConnectorsModal } from "../components/Modals";
import { chatRows, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";
import { chatBot } from "./GalleryChat";

const fr = (o: FixtureOptions) => o.lang === "fr";

export function GalleryComfort7({ o }: { o: FixtureOptions }) {
  const p = new URLSearchParams(location.search);
  const view = p.get("view");
  useEffect(() => {
    const main = chatBot(o);
    const welcome: Bot = { ...main, id: GALLERY_BOT_ID, primary: false, name: o.long ? "Comptabilité et factures fournisseurs" : "Max", label: fr(o) ? "comptable, factures et devis" : "accountant, invoices and quotes", color: "moss" } as Bot;
    const bot = view === "welcome" ? welcome : main;
    const base = view === "welcome" ? [] : chatRows(o);
    const msgs = base.filter((r) => r.body.kind === "message" && r.body.text.trim()).map((r) => r.seq);
    const rows: Row[] = base.map((r) => (r.body.kind !== "message" ? r : r.seq === msgs[1] ? { ...r, body: { ...r.body, pinned: true } } : r.seq === msgs[2] ? { ...r, body: { kind: "message", role: r.body.role, text: "", deleted: true } } : r) as Row);
    const idle: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    useStore.setState({
      bots: { [bot.id]: bot }, selectedId: bot.id, view: "chat", detailsOpen: false, boot: "ready", mobileNav: p.get("nav") === "1",
      threads: { [bot.id]: { generation: 1, rows, loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null } },
      live: { [bot.id]: idle }, openThread: null,
    } as never);
    if (p.get("bell") === "1") setTimeout(() => document.querySelector<HTMLButtonElement>(".notify-bell")?.click(), 400);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bot = useStore((s) => s.bots[GALLERY_BOT_ID]);
  const ready = useStore((s) => s.selectedId === GALLERY_BOT_ID && !!s.threads[GALLERY_BOT_ID]);
  if (!ready || !bot) return null;
  const pane = (children: React.ReactNode) => <div className="app-settings-content settings-pane" style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>{children}</div>;
  if (view === "connect") return <ConnectorsModal onClose={() => undefined} />; // « doit marcher »: Connecter des applis (scripts/connect-flow.test.mjs)
  if (view === "convs") return <ConversationsModal bot={bot} onClose={() => undefined} />;
  if (view === "trash") return pane(<><BotStyleField bot={bot} /><BotDangerZone bot={{ ...bot, primary: false }} isRoom={false} onDeleted={() => undefined} /><BotTrash /><HistoryRetention /></>);
  if (view === "office") return pane(<>
    <h3 className="pane-heading">Ventes.xlsx</h3><OfficeView botId={bot.id} path="Ventes.xlsm" name="Ventes.xlsm" />
    <h3 className="pane-heading">Rapport.docx</h3><OfficeView botId={bot.id} path="Rapport.docx" name="Rapport.docx" />
    <h3 className="pane-heading">Présentation.pptx</h3><OfficeView botId={bot.id} path="Presentation.pptx" name="Presentation.pptx" />
    <h3 className="pane-heading">clients.csv</h3><SheetTable label="clients.csv" rows={[["Nom", "Ville", "Montant"], ...Array.from({ length: o.long ? 40 : 8 }, (_, i) => [`Client ${i + 1}${o.long && i === 2 ? " avec un nom vraiment très long pour tester" : ""}`, i % 2 ? "Lyon" : "Paris", `${(i + 1) * 120},00 €`])]} />
  </>);
  if (view === "pages") return pane(<>
    <h3 className="pane-heading">{fr(o) ? "Ma page de tarifs" : "My pricing page"}</h3>
    <PageExports token="tok_gallery" title="Tarifs" />
    <div className="page-exports"><PageDiffButton token="tok_gallery" from={2} n={2} /></div>
    <PageLossCardView card={pageLoss(o, "pending")} botId={bot.id} seq={41} />
    <PageLossCardView card={pageLoss(o, "restored")} botId={bot.id} seq={42} />
    <DesignJournal />
  </>);
  return (
    <div className="shell gallery-app">
      <Sidebar />
      <ChatView />
    </div>
  );
}

/** L157 « rien de perdu »: the card after a page was redone (pending, or answered). */
function pageLoss(o: FixtureOptions, status: PageLossCard["status"]): PageLossCard {
  const F = fr(o);
  const lost: PageLossCard["lost"] = [
    { kind: "section", text: F ? "Horaires d'ouverture" : "Opening hours" },
    { kind: "section", text: "section « horaires »" },
    { kind: "image", text: F ? "Le four à bois" : "The wood oven", detail: "four.jpg" },
    { kind: "link", text: F ? "Commander en ligne" : "Order online", detail: o.long ? "https://boulangerie-martin.example.com/commander/en-ligne?retrait=magasin&creneau=matin" : "https://example.com/commander" },
    { kind: "text", text: o.long ? (F ? "Ouvert du mardi au dimanche, de 7 heures à 19 heures 30, sans interruption, et le lundi matin pendant les vacances scolaires." : "Open Tuesday to Sunday, 7 am to 7:30 pm, non-stop, and Monday mornings during school holidays.") : (F ? "Ouvert du mardi au dimanche, de 7 h à 19 h 30." : "Open Tuesday to Sunday, 7 am to 7:30 pm.") },
    { kind: "file", text: "css/horaires.css" },
    ...(o.long ? [{ kind: "text" as const, text: F ? "Nos pains sont faits sur place chaque matin avec des farines de la région." : "Our bread is baked here every morning with local flour." }, { kind: "link" as const, text: "Instagram", detail: "https://instagram.com/boulangerie" }] : []),
  ];
  return { type: "pageloss", token: "tok_gallery", title: o.long ? (F ? "Boulangerie Martin — tarifs, horaires et commandes" : "Martin bakery — prices, hours and orders") : "Boulangerie", previousVersion: 2, lost, total: lost.length + (o.long ? 3 : 0), status };
}

/** What the fake API answers for the wave 7 routes (fakeApi.ts). */
export function comfort7Get(path: string, o: FixtureOptions & { empty: boolean }): unknown | undefined {
  const F = fr(o);
  const L = o.long;
  if (/^\/bots\/[^/]+\/conversations$/.test(path)) return {
    folders: o.empty ? [] : [F ? "Clients" : "Customers", L ? (F ? "Dossiers administratifs de l'année" : "This year's paperwork") : "Admin"],
    conversations: o.empty ? [{ generation: 1, title: "", autoTitle: true, pinned: false, folder: "", model: "", automatic: false, messages: 0, startedAt: NOW, lastAt: NOW, current: true }] : [
      { generation: 6, title: F ? "Devis pour Camille" : "Quote for Camille", autoTitle: true, pinned: false, folder: "", model: "", automatic: false, messages: 14, startedAt: NOW - 3_600_000, lastAt: NOW - 60_000, current: true },
      { generation: 2, title: L ? (F ? "Préparer toutes les relances des factures impayées de plus de trente jours" : "Prepare every reminder for invoices unpaid for more than thirty days") : (F ? "Relances factures" : "Invoice reminders"), autoTitle: false, pinned: true, folder: F ? "Clients" : "Customers", model: "", automatic: false, messages: 32, startedAt: NOW - 9 * 86_400_000, lastAt: NOW - 8 * 86_400_000, current: false },
      { generation: 5, title: F ? "Point du matin" : "Morning brief", autoTitle: true, pinned: false, folder: "", model: "", automatic: true, messages: 2, startedAt: NOW - 86_400_000, lastAt: NOW - 86_400_000, current: false },
      { generation: 3, title: F ? "Comparer les assurances" : "Compare insurers", autoTitle: true, pinned: false, folder: "Admin", model: "", automatic: false, messages: 9, startedAt: NOW - 20 * 86_400_000, lastAt: NOW - 19 * 86_400_000, current: false },
    ],
  };
  if (/^\/bots\/[^/]+\/deletion-preview$/.test(path)) return { conversations: 6, messages: 214, memories: 18, skills: 3, routines: 2, tasks: 1, rules: 0, files: true, computer: true, helpers: 0, days: 30, restorable: [] };
  if (path === "/bot-trash") return { items: o.empty ? [] : [
    { id: "trash_1", botId: "b1", name: L ? "Assistant de veille concurrentielle et des salons professionnels" : "Veille", kind: "agent", deletedAt: NOW - 2 * 86_400_000, expiresAt: NOW + 28 * 86_400_000, counts: { conversations: 4, messages: 120, memories: 12, skills: 1, routines: 1, tasks: 0, rules: 0, files: true, computer: true } },
    { id: "trash_2", botId: "b2", name: "Mails", kind: "agent", deletedAt: NOW - 20 * 86_400_000, expiresAt: NOW + 10 * 86_400_000, counts: { conversations: 1, messages: 9, memories: 0, skills: 0, routines: 0, tasks: 0, rules: 0, files: true, computer: true } },
  ] };
  if (/^\/bots\/[^/]+\/style$/.test(path)) return { style: "challenge", styles: ["simple", "normal", "challenge"] };
  if (path === "/history-retention") return { days: 90, choices: [0, 30, 90, 365] };
  if (path.startsWith("/bell")) return { unread: o.empty ? 0 : 2, items: o.empty ? [] : [
    { id: 3, kind: "reply", title: "jiren", body: F ? "Le devis est prêt, je te l'ai mis dans tes fichiers." : "The quote is ready, it is in your files.", botId: GALLERY_BOT_ID, sent: true, reason: "", at: NOW - 120_000, read: false },
    { id: 2, kind: "reply", title: "jiren", body: L ? (F ? "J'ai fini de comparer les trois offres d'assurance habitation avec les garanties, les franchises et les avis clients récents." : "I finished comparing the three home insurance offers with cover, excess and recent reviews.") : (F ? "C'est fait." : "Done."), botId: GALLERY_BOT_ID, sent: false, reason: "atDesk", at: NOW - 600_000, read: false },
    { id: 1, kind: "routine", title: F ? "jiren · Point du matin" : "jiren · Morning brief", body: F ? "3 rendez-vous aujourd'hui." : "3 meetings today.", botId: null, sent: false, reason: "quiet", at: NOW - 8 * 3_600_000, read: true },
  ] };
  if (path.endsWith("/files/office-preview")) return undefined; // answered with the query (officeFixture)
  if (/^\/pages\/[^/]+\/diff$/.test(path)) return { html: { added: 2, removed: 1, truncated: false, lines: [
    { op: "fold", text: "", count: 12 }, { op: "same", text: "<section id=\"tarifs\">", a: 13, b: 13 }, { op: "del", text: "  <p class=\"prix\">29 € par mois</p>", a: 14 }, { op: "add", text: "  <p class=\"prix\">24 € par mois</p>", b: 14 }, { op: "add", text: L ? "  <p class=\"note\">Offre de lancement valable jusqu'à la fin du mois prochain pour les nouveaux clients uniquement</p>" : "  <p class=\"note\">Offre de lancement</p>", b: 15 }, { op: "same", text: "</section>", a: 15, b: 16 }, { op: "fold", text: "", count: 30 },
  ] }, files: [{ name: "style.css", added: 1, removed: 0, truncated: false, lines: [{ op: "fold", text: "", count: 4 }, { op: "add", text: ".note { color: #b45309; }", b: 5 }] }] };
  if (path === "/connectors") return { connectors: [] };
  if (path === "/connectors/catalog") return { oauthRedirectUri: "https://bots.example.com/api/connectors/oauth/callback", apps: [
    { id: "notion", name: "Notion", category: F ? "Notes" : "Notes", description: F ? "Tes pages et bases Notion" : "Your Notion pages and databases", url: "https://mcp.notion.com/mcp", auth: "oauth", oauthClient: "dynamic", tokenHelp: "" },
    { id: "linear", name: "Linear", category: F ? "Projets" : "Projects", description: F ? "Tickets et projets" : "Issues and projects", url: "https://mcp.linear.app/mcp", auth: "token", tokenHelp: F ? "Crée une clé dans Linear → Réglages → API." : "Create a key in Linear → Settings → API." },
    { id: "docs", name: "Docs publiques", category: F ? "Lecture" : "Reading", description: F ? "Documentation en lecture seule" : "Read-only documentation", url: "https://docs.example.com/mcp", auth: "none", tokenHelp: "" },
  ] };
  if (path === "/design-journal") return { decisions: o.empty ? [] : [
    { id: "dj_1", topic: "colors", decision: F ? "Titres en bleu nuit #1e3a5f, fond crème #faf7f0" : "Titles in navy #1e3a5f, cream background #faf7f0", why: F ? "le client aime le calme" : "the client likes calm", by: "bot", createdAt: NOW - 86_400_000 },
    { id: "dj_2", topic: "fonts", decision: o.long ? (F ? "Titres en Fraunces 600, texte courant en Inter 16 px avec une hauteur de ligne de 1,6 pour la lecture sur téléphone" : "Titles in Fraunces 600, body text in Inter 16 px with 1.6 line height for phone reading") : (F ? "Titres en Fraunces, texte en Inter" : "Titles in Fraunces, text in Inter"), why: "", by: "user", createdAt: NOW - 2 * 86_400_000 },
    { id: "dj_3", topic: "layout", decision: F ? "Une seule colonne sur téléphone, boutons pleine largeur" : "One column on phones, full-width buttons", why: "", by: "bot", createdAt: NOW - 3 * 86_400_000 },
  ] };
  if (path === "/models") return { models: [{ ref: "codex:default", provider: "Codex", model: "default", kind: "subscription" }, { ref: "anthropic:claude-sonnet", provider: "Anthropic", model: "claude-sonnet", kind: "api" }], defaultRef: "codex:default" };
  return undefined;
}

export function officeFixture(file: string, o: FixtureOptions) {
  const F = fr(o);
  if (/\.xls/.test(file)) return { kind: "xlsx", macros: true, sheets: [
    { name: F ? "Ventes 2026" : "Sales 2026", totalRows: 6, truncated: false, rows: [[F ? "Mois" : "Month", F ? "Produit" : "Product", F ? "Quantité" : "Qty", F ? "Total" : "Total"], ["Janvier", "Thé vert", "120", "1 440"], ["Février", o.long ? "Coffret découverte de thés du monde entier, édition limitée" : "Coffret", "45", "2 025"], [], ["Mars", "Thé noir", "98", "1 078"], ["", "", "Total", "4 543"]] },
    { name: F ? "Notes" : "Notes", totalRows: 1, truncated: false, rows: [["Vérifié par Camille"]] },
  ] };
  if (/\.doc/.test(file)) return { kind: "docx", macros: false, blocks: [
    { type: "heading", level: 1, text: F ? "Rapport trimestriel" : "Quarterly report" },
    { type: "paragraph", text: F ? "Les ventes progressent de 12 % sur le trimestre, portées par les coffrets." : "Sales grew 12% this quarter, driven by gift boxes." },
    { type: "heading", level: 2, text: F ? "Chiffres clés" : "Key figures" },
    { type: "table", rows: [[F ? "Indicateur" : "Metric", "T1", "T2"], [F ? "Chiffre d'affaires" : "Revenue", "38 000 €", "42 600 €"], [F ? "Clients" : "Customers", "312", "355"]] },
  ] };
  return { kind: "pptx", macros: false, slides: [
    { n: 1, title: F ? "Lancement des coffrets" : "Gift box launch", lines: [F ? "Novembre 2026" : "November 2026"] },
    { n: 2, title: F ? "Pourquoi maintenant" : "Why now", lines: [F ? "Les fêtes approchent" : "Holidays are coming", F ? "Stock prêt" : "Stock ready"] },
  ] };
}
