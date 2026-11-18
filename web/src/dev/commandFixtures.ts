/**
 * Fake data for « Centre de commandement » in the dev gallery (Gallery.tsx, section=command): a team of eight bots in two
 * sections plus one shared through a workspace, in every state, with missions, results, computers, consumption and the
 * links between them; the store's matching bots and live states; a fake computer screen. Never shipped.
 */
import { DEFAULT_CHARACTER, type Bot, type Character, type CommandCard, type CommandLink, type CommandView, type Live } from "../types";
import { NOW, type FixtureOptions } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
const look = (p: Partial<Character>): Character => ({ ...DEFAULT_CHARACTER, ...p });
const idle: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };

export function commandFixture(o: FixtureOptions & { empty: boolean }): CommandView {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const LONG = (s: string) => (o.long ? `${s} ${L("avec un intitulé beaucoup plus long que prévu pour vérifier qu'il passe à la ligne proprement", "with a much longer title than expected to check that it wraps cleanly")}` : s);
  const sections = [{ id: "sec_growth", name: L("Croissance", "Growth"), paused: false }, { id: "sec_ops", name: L("Opérations", "Operations"), paused: false }];
  const base = (p: Partial<CommandCard> & Pick<CommandCard, "botId" | "name">): CommandCard => ({
    label: "", shape: "pebble", color: "indigo", primary: false, character: look({}), sectionId: null, shared: null, state: "idle", live: idle, pause: null,
    mission: null, missions: 0, awaiting: 0, incidents: 0, incidentsWaiting: 0, lastResult: null, usage: { usd: 0, tokens: 0 },
    computer: { power: "asleep", shared: false, name: "" }, can: { pause: true, stop: true, chat: true, computer: true, incidents: true }, lastActivityAt: NOW - HOUR, ...p,
  });
  const cards: CommandCard[] = o.empty ? [] : [
    base({
      botId: "cmd_juno", name: "Juno", label: L("Cheffe d'orchestre", "Lead"), primary: true, shape: "mochi", color: "ember", character: look({ accessory: "headset", cheeks: true }), sectionId: "sec_growth",
      state: "working", live: { running: true, activity: { kind: "browsing", detail: "", since: NOW - 40_000 }, awaiting: null, startedAt: NOW - 4 * MIN, queued: 0, caption: L("Compare les offres de trois fournisseurs", "Comparing three suppliers' offers") },
      mission: { kind: "goal", title: LONG(L("Trouver trois fournisseurs d'emballages moins chers", "Find three cheaper packaging suppliers")), since: NOW - 2 * HOUR, link: { kind: "bot", botId: "cmd_juno" } }, missions: 2,
      lastResult: { kind: "bgTask", title: L("Relevé des prix d'octobre", "October price survey"), detail: "", at: NOW - 35 * MIN, link: { kind: "bot", botId: "cmd_juno" } },
      usage: { usd: 1.84, tokens: 412_000 }, computer: { power: "on", shared: false, name: "" }, lastActivityAt: NOW - 20_000,
    }),
    base({
      botId: "cmd_atlas", name: "Atlas", label: L("Analyste SEO", "SEO analyst"), shape: "bear", color: "teal", character: look({ eyes: "round", accessory: "cap" }), sectionId: "sec_growth",
      state: "waiting", live: { ...idle, awaiting: { reason: L("Attend ton accord pour publier l'article « Guide des tailles »", "Waiting for your OK to publish the “Size guide” article"), since: NOW - 6 * MIN } }, awaiting: 1,
      mission: { kind: "task", title: L("Article de blog : guide des tailles", "Blog post: size guide"), since: NOW - 3 * HOUR, link: { kind: "bot", botId: "cmd_atlas" } }, missions: 1,
      lastResult: { kind: "goal", title: L("Audit des 40 pages produits", "Audit of the 40 product pages"), detail: "", at: NOW - 3 * HOUR, link: { kind: "bot", botId: "cmd_atlas" } },
      usage: { usd: 0.62, tokens: 158_000 }, computer: { power: "on", shared: false, name: "" }, lastActivityAt: NOW - 6 * MIN,
    }),
    base({
      botId: "cmd_nova", name: "Nova", label: L("Réseaux sociaux", "Social media"), shape: "cloud", color: "plum", character: look({ type: "muse" }), sectionId: "sec_growth",
      state: "working", live: { running: true, activity: { kind: "messaging", detail: "Juno", since: NOW - 15_000 }, awaiting: null, startedAt: NOW - MIN, queued: 0 },
      mission: { kind: "bgTask", title: L("Calendrier des posts de décembre", "December post calendar"), since: NOW - 50 * MIN, link: { kind: "bot", botId: "cmd_nova" } }, missions: 1,
      lastResult: { kind: "task", title: L("12 visuels pour Instagram", "12 visuals for Instagram"), detail: "", at: NOW - 5 * HOUR, link: { kind: "bot", botId: "cmd_nova" } },
      usage: { usd: 0.37, tokens: 96_000 }, computer: { power: "asleep", shared: false, name: "" }, lastActivityAt: NOW - 15_000,
    }),
    base({
      botId: "cmd_orbit", name: "Orbit", label: L("Support client", "Customer support"), shape: "egg", color: "sky", character: look({ eyes: "oval", accessory: "antenna" }), sectionId: "sec_ops",
      state: "error", incidents: 2, incidentsWaiting: 1,
      mission: { kind: "job", title: L("Import des tickets Zendesk", "Zendesk ticket import"), since: NOW - 25 * MIN, link: { kind: "bot", botId: "cmd_orbit" } }, missions: 1,
      lastResult: { kind: "task", title: L("Réponses aux 18 tickets du matin", "Replies to the 18 morning tickets"), detail: "", at: NOW - 2 * HOUR, link: { kind: "bot", botId: "cmd_orbit" } },
      usage: { usd: 0.21, tokens: 64_000 }, computer: { power: "on", shared: false, name: "" }, lastActivityAt: NOW - 9 * MIN,
    }),
    base({
      botId: "cmd_pixel", name: "Pixel", label: L("Comptabilité", "Bookkeeping"), shape: "squircle", color: "moss", character: look({ type: "dots" }), sectionId: "sec_ops",
      state: "paused", pause: { by: "bot", self: true, sectionId: null, since: NOW - 2 * HOUR, queued: 3 },
      lastResult: { kind: "goal", title: L("Rapprochement bancaire de novembre", "November bank reconciliation"), detail: "", at: NOW - 26 * HOUR, link: { kind: "bot", botId: "cmd_pixel" } },
      usage: { usd: 0, tokens: 0 }, computer: { power: "asleep", shared: true, name: L("Poste partagé", "Shared desk") }, lastActivityAt: NOW - 2 * HOUR,
    }),
    base({
      botId: "cmd_sage", name: "Sage", label: L("Veille juridique", "Legal watch"), shape: "ghost", color: "slate", character: look({ eyes: "sleepy" }), sectionId: "sec_ops",
      state: "idle", lastResult: { kind: "bgTask", title: L("Résumé des nouvelles CGV", "Summary of the new terms"), detail: "", at: NOW - 4 * HOUR, link: { kind: "bot", botId: "cmd_sage" } },
      usage: { usd: 0.05, tokens: 12_000 }, computer: { power: "absent", shared: false, name: "" }, lastActivityAt: NOW - 4 * HOUR,
    }),
    base({
      botId: "cmd_rio", name: "Rio", label: L("Assistant perso", "Personal assistant"), shape: "bean", color: "amber", character: look({ accessory: "sprout" }),
      state: "idle", usage: { usd: 0, tokens: 0 }, computer: { power: "asleep", shared: false, name: "" }, lastActivityAt: NOW - 30 * HOUR,
    }),
    base({
      botId: "cmd_mira", name: "Mira", label: "", shape: "cat", color: "rose", character: look({ accessory: "bow" }),
      shared: { workspaceName: "Studio Lune", ownerName: "Camille", role: "member" }, state: "working",
      live: { running: true, activity: { kind: "writing", since: NOW - 10_000 }, awaiting: null, startedAt: NOW - 2 * MIN, queued: 0 },
      mission: { kind: "goal", title: L("Plan de lancement du printemps", "Spring launch plan"), since: NOW - 5 * HOUR, link: { kind: "bot", botId: "cmd_mira" } }, missions: 1,
      incidents: null, incidentsWaiting: null, usage: null, computer: null, can: { pause: false, stop: false, chat: true, computer: false, incidents: false }, lastActivityAt: NOW - 10_000,
    }),
  ];
  const ex = (fromId: string, toId: string, text: string, ago: number, seq: number) => ({ at: NOW - ago, fromId, toId, text, botId: toId, seq, thread: 0 });
  const links: CommandLink[] = o.empty ? [] : [
    { id: "l1", kind: "message", from: "cmd_nova", to: "cmd_juno", count: 4, lastAt: NOW - 20_000, roomId: null, roomName: "", exchange: [
      ex("cmd_nova", "cmd_juno", L("Tu peux me donner les trois messages clés de la campagne ?", "Can you give me the campaign's three key messages?"), 20_000, 41),
      ex("cmd_nova", "cmd_juno", L("J'ai fini le calendrier, je te l'envoie pour relecture.", "The calendar is done, sending it to you for review."), 40 * MIN, 37),
    ] },
    { id: "l2", kind: "handoff", from: "cmd_orbit", to: "cmd_atlas", count: 1, lastAt: NOW - 70 * MIN, roomId: null, roomName: "", exchange: [
      ex("cmd_orbit", "cmd_atlas", L("Orbit n'a pas pu finir ce travail (le service d'IA ne répond pas) et te le confie. La demande : répondre à la cliente sur le délai de livraison.", "Orbit could not finish this work (the AI service is not answering) and hands it to you. The request: answer the customer about the delivery time."), 70 * MIN, 12),
    ] },
    { id: "l3", kind: "room", from: "cmd_atlas", to: "cmd_juno", count: 6, lastAt: NOW - 3 * MIN, roomId: "room_war", roomName: L("Lancement", "Launch"), exchange: [
      { ...ex("cmd_juno", "cmd_atlas", L("Je prends la partie budget.", "I take the budget part."), 3 * MIN, 88), botId: "room_war" },
      { ...ex("cmd_atlas", "cmd_juno", L("Je m'occupe des mots-clés et du calendrier éditorial.", "I handle the keywords and the editorial calendar."), 5 * MIN, 87), botId: "room_war" },
    ] },
    { id: "l4", kind: "message", from: "cmd_pixel", to: "cmd_orbit", count: 2, lastAt: NOW - 5 * HOUR, roomId: null, roomName: "", exchange: [
      ex("cmd_pixel", "cmd_orbit", L("Les remboursements du mois sont validés, tu peux prévenir les clients.", "This month's refunds are approved, you can tell the customers."), 5 * HOUR, 22),
    ] },
  ];
  const usd = cards.reduce((a, c) => a + (c.usage?.usd ?? 0), 0);
  const tokens = cards.reduce((a, c) => a + (c.usage?.tokens ?? 0), 0);
  return {
    generatedAt: NOW, windowMs: 24 * HOUR, sections: o.empty ? [] : sections, cards, links, pausedAll: false,
    kpis: {
      working: cards.filter((c) => c.state === "working").length, waiting: cards.reduce((a, c) => a + c.awaiting, 0), incidents: cards.reduce((a, c) => a + (c.incidents ?? 0), 0),
      paused: cards.filter((c) => c.state === "paused").length, usage: { usd: Math.round(usd * 100) / 100, tokens, eur: null }, eurPerUsd: null, display: "usd",
      computersOn: cards.filter((c) => c.computer?.power === "on").length, computersMax: o.empty ? 0 : 6,
    },
  };
}

/** The store's side: the same bots (for their actions) and their live states (for the mascots' moods). */
export function commandStoreState(v: CommandView): { bots: Record<string, Bot>; live: Record<string, Live> } {
  const bots: Record<string, Bot> = {};
  const live: Record<string, Live> = {};
  for (const c of v.cards) {
    bots[c.botId] = { id: c.botId, kind: "agent", name: c.name, label: c.label, description: "", instructions: "", shape: c.shape, color: c.color, primary: c.primary, character: c.character, pause: c.pause, access: c.shared ? { workspaceId: "ws", workspaceName: c.shared.workspaceName, ownerName: c.shared.ownerName, role: c.shared.role, canTalk: true, canManage: false, canApprove: false } : undefined, sectionId: c.sectionId, unread: 0, memberIds: [], disabledTools: [], generation: 1, lastActivityAt: c.lastActivityAt } as unknown as Bot;
    live[c.botId] = c.live;
  }
  return { bots, live };
}

/** A computer screen for the cards' thumbnails: a browser window with a page of products (SVG, no network). */
export function fakeScreen(name: string): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
<rect width="320" height="200" fill="#2b2f36"/><rect x="10" y="10" width="300" height="182" rx="6" fill="#f6f4ef"/>
<rect x="10" y="10" width="300" height="20" rx="6" fill="#dcd7cd"/><circle cx="22" cy="20" r="3.5" fill="#e0675c"/><circle cx="33" cy="20" r="3.5" fill="#e6b64c"/><circle cx="44" cy="20" r="3.5" fill="#62b26b"/>
<rect x="60" y="15" width="180" height="10" rx="5" fill="#f6f4ef"/>
<rect x="22" y="40" width="${name.length * 14 + 40}" height="12" rx="3" fill="#23262b"/>
${[0, 1, 2].map((i) => `<rect x="${22 + i * 96}" y="62" width="84" height="64" rx="6" fill="${["#f2c9b8", "#c9e3d6", "#cad8ef"][i]}"/><rect x="${22 + i * 96}" y="132" width="70" height="7" rx="3" fill="#8b8f96"/><rect x="${22 + i * 96}" y="144" width="40" height="7" rx="3" fill="#b23f1b"/>`).join("")}
<rect x="22" y="164" width="276" height="6" rx="3" fill="#dcd7cd"/><rect x="22" y="176" width="180" height="6" rx="3" fill="#dcd7cd"/></svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}
