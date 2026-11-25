/**
 * Gallery « soin » (section=soin): L161 bot care on the real components, with the fake API (careGet / careSend).
 *   (no view)    a bot's settings: photo, shared role, identity documents with a personality, set aside, and
 *                « Ce que ce bot peut lire et écrire » open
 *   view=team    Settings → Team: instructions for every bot, shared roles, shortcuts to revisit, missing capabilities
 *   view=chat    the app shell: bots with a photo in the list and the chat, a « capacité manquante » card
 *   empty=1      nothing set yet (no photo, no document, empty lists)
 */
import { useEffect } from "react";
import { useStore } from "../store";
import type { Bot, Live, Row } from "../types";
import { ChatView } from "../components/ChatView";
import { Sidebar } from "../components/Sidebar";
import { BotCareFields } from "../components/BotCare";
import { TeamCare } from "../components/TeamCare";
import { loadBotPhotos } from "../components/BotPhoto";
import { chatRows, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";
import { chatBot } from "./GalleryChat";

const fr = (o: FixtureOptions) => o.lang === "fr";
const DAY = 86_400_000;

/** A picture drawn here (an abstract landscape, no face): what the server would serve as a bot's photo. */
const picture = (a: string, b: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="44" cy="20" r="8" fill="#ffe7a3"/><path d="M0 50 L18 32 L30 44 L42 30 L64 52 L64 64 L0 64 Z" fill="#2f4a3a"/></svg>`)}`;

export function GalleryCare({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const p = new URLSearchParams(location.search);
  const view = p.get("view");
  useEffect(() => {
    const main = chatBot(o);
    const other: Bot = { ...main, id: "bot_care_max", primary: false, name: o.long ? "Comptabilité et factures fournisseurs" : "Max", label: fr(o) ? "comptable" : "accountant", color: "moss" } as Bot;
    const base = chatRows(o).slice(0, 4);
    const last = base[base.length - 1];
    const notice: Row = { botId: main.id, generation: 1, seq: (last?.seq ?? 0) + 1, rev: 1, createdAt: NOW, body: { kind: "notice", tone: "info", text: fr(o) ? "Capacité manquante notée pour toi : lire mon agenda Google. Rien n'a été installé. Tu la retrouves dans Réglages → Équipe." : "Missing capability noted for you: read my Google Agenda. Nothing was installed. You will find it in Settings → Team.", action: { kind: "settings", section: "team" } } } as Row;
    const idle: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    useStore.setState({
      bots: { [main.id]: main, [other.id]: other }, selectedId: main.id, view: "chat", detailsOpen: false, boot: "ready", mobileNav: p.get("nav") === "1",
      threads: { [main.id]: { generation: 1, rows: [...base, notice], loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null } },
      live: { [main.id]: idle, [other.id]: idle }, openThread: null,
    } as never);
    loadBotPhotos(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bot = useStore((s) => s.bots[GALLERY_BOT_ID]);
  if (!bot) return null;
  const pane = (children: React.ReactNode) => <div className="app-settings-content settings-pane" style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>{children}</div>;
  if (view === "team") return pane(<TeamCare />);
  if (view === "chat") return <div className="shell gallery-app"><Sidebar /><ChatView /></div>;
  return pane(<BotCareFields bot={{ ...bot, primary: false }} reachOpen />);
}

/** What the fake API answers for the L161 GET routes (fakeApi.ts). */
export function careGet(path: string, o: FixtureOptions & { empty: boolean }): unknown | undefined {
  const F = fr(o), L = o.long, E = o.empty;
  if (path === "/bot-photos") return { photos: E ? {} : { [GALLERY_BOT_ID]: picture("#7fb3e6", "#d8ecff"), bot_care_max: picture("#f0b27a", "#fde3c8") } };
  if (path === "/shared-roles") return { roles: roles(F, L) };
  if (/^\/bots\/[^/]+\/shared-role$/.test(path)) return { roleId: E ? null : "relecteur" };
  if (/^\/bots\/[^/]+\/identity$/.test(path)) return { docs: E ? [] : docs(F, L), personalities: personalities(F) };
  if (/^\/bots\/[^/]+\/aside$/.test(path)) return { aside: !E, asideAt: E ? null : Date.now() - 2 * DAY, lastUse: Date.now() - 16 * DAY, never: false, eligible: true, days: 14 };
  if (/^\/bots\/[^/]+\/read-write$/.test(path)) return reach(L);
  if (path === "/global-instructions") return { text: E ? "" : F ? "Réponds toujours en français et tutoie-moi. Donne les prix TTC." : "Always answer in English. Show prices with VAT.", updatedAt: Date.now(), max: 4000 };
  if (path === "/bot-shortcuts") return { items: E ? [] : shortcuts(F, L) };
  if (path === "/capability-gaps") return { items: E ? [] : gaps(F, L) };
  return undefined;
}

/** What the fake API answers when something changes on those routes. */
export function careSend(method: string, path: string, body: Record<string, unknown>, o: FixtureOptions): unknown | undefined {
  const F = fr(o), L = o.long;
  if (/^\/bots\/[^/]+\/identity(\/.*)?$/.test(path)) {
    const list = docs(F, L);
    if (path.endsWith("/personality")) { const p = personalities(F).find((x) => x.id === body.personality); return { docs: [{ ...list[0], title: `${F ? "Caractère : " : "Character: "}${p?.name ?? ""}`, body: p?.text ?? "", personality: String(body.personality) }, ...list.slice(1)] }; }
    return { docs: method === "DELETE" ? list.slice(1) : list };
  }
  if (/^\/bots\/[^/]+\/aside$/.test(path)) return { aside: false, asideAt: null, lastUse: Date.now() - 16 * DAY, never: body.never === true, eligible: true, days: 14 };
  if (/^\/bots\/[^/]+\/photo$/.test(path)) return method === "DELETE" ? { removed: true } : { url: picture("#9ad1b0", "#e4f6ea") };
  if (path === "/global-instructions") return { text: String(body.text ?? ""), updatedAt: Date.now(), max: 4000 };
  if (/^\/bot-shortcuts\//.test(path)) return { items: shortcuts(F, L).slice(1) };
  if (/^\/capability-gaps\//.test(path)) return { items: gaps(F, L).slice(1) };
  if (/^\/bots\/[^/]+\/shared-role$/.test(path)) return { roleId: body.roleId ?? null };
  return undefined;
}

const personalities = (F: boolean) => [
  ["chaleureux", F ? "Chaleureux" : "Warm"], ["direct", F ? "Direct et bref" : "Direct and brief"], ["rigoureux", F ? "Rigoureux" : "Thorough"],
  ["creatif", F ? "Créatif" : "Creative"], ["pedagogue", F ? "Pédagogue" : "Teacher"], ["calme", F ? "Calme et posé" : "Calm"],
].map(([id, name]) => ({ id, name, text: F ? `Texte de la personnalité « ${name} ».` : `The « ${name} » personality.` }));

const docs = (F: boolean, L: boolean) => [
  { id: "idoc_1", title: F ? "Caractère : Direct et bref" : "Character: Direct and brief", body: F ? "Tu vas droit au but : la réponse d'abord, en peu de mots, sans formule de politesse inutile." : "You get to the point: the answer first, in few words.", personality: "direct", updatedAt: Date.now() },
  { id: "idoc_2", title: L ? (F ? "Charte de la maison pour tous les courriers envoyés aux clients et fournisseurs" : "House charter for every letter sent to customers and suppliers") : F ? "Charte" : "Charter", body: F ? `Toujours signer « L'équipe Sklubs ». Jamais d'anglicismes.${L ? " Les montants s'écrivent avec une espace avant le symbole euro, par exemple 1 250,00 €, et les dates en toutes lettres : le 3 décembre 2026." : ""}` : "Always sign « The Sklubs team ».", personality: "", updatedAt: Date.now() },
];

const roles = (F: boolean, L: boolean) => [
  { id: "relecteur", name: F ? "Relecteur" : "Reviewer", text: F ? "Tu relis le travail avant qu'il parte : fautes, chiffres, noms, dates, ton. Relis aussi les liens." : "You review the work before it goes out. Check the links too.", builtin: true, modified: true, bots: [{ id: "b1", name: "jiren" }, { id: "b2", name: L ? "Comptabilité et factures fournisseurs" : "Max" }] },
  { id: "chercheur", name: F ? "Chercheur" : "Researcher", text: F ? "Tu cherches des informations fiables et tu croises au moins deux sources." : "You look for reliable information.", builtin: true, modified: false, bots: [] },
  { id: "role_x", name: L ? (F ? "Veilleur des prix des concurrents sur toutes les places de marché" : "Watcher of competitors' prices on every marketplace") : F ? "Veilleur" : "Watcher", text: F ? "Surveille les prix chaque lundi." : "Watch prices every Monday.", builtin: false, modified: false, bots: [] },
];

const shortcuts = (F: boolean, L: boolean) => [
  { id: "sc_1", botId: "b1", botName: "jiren", what: F ? "Liste partielle des fournisseurs (les 3 premiers)" : "Partial supplier list (first 3)", leavesOut: F ? "Les fournisseurs étrangers" : "Foreign suppliers", revisit: "2026-11-01", revisitAt: Date.now() - DAY, due: true, noRevisit: false, createdAt: Date.now() - 20 * DAY },
  { id: "sc_2", botId: "b2", botName: L ? "Comptabilité et factures fournisseurs" : "Max", what: L ? (F ? "Taux de TVA estimé à 20 % pour toutes les lignes, y compris les livres et la restauration, en attendant la réponse du comptable" : "VAT estimated at 20% for every line until the accountant answers") : F ? "TVA estimée à 20 %" : "VAT estimated at 20%", leavesOut: "", revisit: "", revisitAt: null, due: false, noRevisit: true, createdAt: Date.now() - 3 * DAY },
  { id: "sc_3", botId: "b1", botName: "jiren", what: F ? "J'ai pris les 50 premiers prospects" : "I took the first 50 prospects", leavesOut: F ? "Les 400 suivants" : "The next 400", revisit: F ? "dans 2 semaines" : "in 2 weeks", revisitAt: Date.now() + 14 * DAY, due: false, noRevisit: false, createdAt: Date.now() - DAY },
];

const gaps = (F: boolean, L: boolean) => [
  { id: "gap_1", botId: "b1", botName: "jiren", what: F ? "Lire mon agenda Google" : "Read my Google Agenda", why: F ? "Tu m'as demandé tes rendez-vous de demain" : "You asked for tomorrow's meetings", tried: F ? "Aucun outil d'agenda" : "No calendar tool", times: 3, createdAt: Date.now() - 5 * DAY, lastAt: Date.now() - DAY },
  { id: "gap_2", botId: "b2", botName: L ? "Comptabilité et factures fournisseurs" : "Max", what: L ? (F ? "Envoyer des factures depuis le logiciel de comptabilité du cabinet, avec le numéro de client" : "Send invoices from the firm's accounting software") : F ? "Envoyer des SMS" : "Send text messages", why: "", tried: "", times: 1, createdAt: Date.now() - 2 * DAY, lastAt: Date.now() - 2 * DAY },
];

const reach = (L: boolean) => ({
  autonomy: "balanced",
  families: [
    { group: "general", reads: ["docs_read", "guide_search", "tool_search"], acts: ["ask_user", "capability_gap", "plan_propose", "shortcut_note"], asks: ["rule_propose", "self_update"] },
    { group: "web", reads: ["research_reports_search", "scholar_search", "web_fetch"], acts: ["deep_research_start"], asks: [] },
    { group: "files", reads: ["doc_live_list", "doc_live_read"], acts: ["doc_live_edit", "file_save", "file_send"], asks: ["file_public_link"] },
    { group: "memory", reads: ["memory_search", "skill_read"], acts: ["memory_save", "skill_save"], asks: [] },
    { group: "apps", reads: ["agent_list"], acts: ["api_get", "bot_email_read"], asks: ["api_send", "bot_email_send"] },
    ...(L ? [{ group: "mycomputer", reads: [], acts: ["my_computers"], asks: ["my_click", "my_command", "my_file_read", "my_file_write", "my_files", "my_key", "my_open", "my_screen", "my_type", "my_ui_tree", "my_windows"] }] : []),
  ],
  off: ["shell"],
  apps: [{ name: "Notion", status: "ready", reads: 6, writes: 3 }, ...(L ? [{ name: "Google Drive de l'entreprise (dossier partagé)", status: "ready", reads: 4, writes: 2 }] : [])],
});
