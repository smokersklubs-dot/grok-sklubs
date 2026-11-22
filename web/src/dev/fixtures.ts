/**
 * Fake data for the dev gallery (web/src/dev/Gallery.tsx). Never shipped: the gallery is only loaded in development.
 * Every text comes in French and English (`L`), and `long` swaps in very long texts to check wrapping on a phone.
 */
import { viewCardFixtures } from "./viewFixtures";
import type { AnnouncementAdminItem, AnnouncementsAdmin, AnnouncementsState, AnnouncementView, Bot, Card, ConversationGrantInfo, Row, SentinelIncidentView, SentinelOverview, TodayReport } from "../types";
import { DEFAULT_MINUTES } from "../types";
import { failureCardFixtures, failureSummaryFixture } from "./incidentsFixtures"; import { turnCardFixtures, turnNoticeRows } from "./turnFixtures";

export interface FixtureOptions { lang: "fr" | "en"; long: boolean }

const MIN = 60_000;
const HOUR = 60 * MIN;
/** A fixed "now" per page load, so relative times read the same on every screenshot. */
export const NOW = Date.now();

export const GALLERY_BOT_ID = "bot_gallery";

function texts(o: FixtureOptions) {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const LONG = (s: string) => (o.long ? `${s} ${L("Avec un texte beaucoup plus long que prévu, pour vérifier qu'il passe à la ligne sans casser la carte ni déborder sur un écran de téléphone de 390 pixels de large.", "With a much longer text than expected, to check that it wraps without breaking the card or overflowing a 390-pixel-wide phone screen.")}` : s);
  return { L, LONG };
}

/** A bot as the store would hold it, with only the fields the gallery's components read. */
export function fakeBot(o: FixtureOptions, patch: Partial<Bot> = {}): Bot {
  return {
    id: GALLERY_BOT_ID, kind: "agent", name: "Juno", label: "", description: "", instructions: "",
    shape: "circle", color: "indigo", pause: null, access: null,
    ...patch,
  } as unknown as Bot;
}

type CardOf<T extends Card["type"]> = Extract<Card, { type: T }>;
/** A card's status field (`state` for a background task). */
type StatusOf<C> = C extends { status: infer S } ? S : C extends { state: infer S } ? S : never;
/** One card in one status: what the gallery lists under "Cartes". */
export interface CardFixture { type: Card["type"]; status: string; card: Card }

/** Settings → Permissions: what the owner allowed "for this conversation" (ConversationGrants.tsx). */
/** Réglages → Mémoire: a note's history (MemoryEdit.tsx), as GET /memories/:id/history answers. */
export function memoryHistoryFixture(o: FixtureOptions) {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const long = o.long ? L(" avec toute l'équipe commerciale, sauf pendant les vacances scolaires de la zone A", " with the whole sales team, except during the school holidays") : "";
  return [
    { at: NOW - 9 * 86400_000, action: "status", before: "active", after: "contested", by: "bot" },
    { at: NOW - 8 * 86400_000, action: "edited", before: L("Préfère les réunions le matn", "Prefers meetings in the mornin"), after: L(`Préfère les réunions le matin${long}`, `Prefers meetings in the morning${long}`), by: "owner" },
    { at: NOW - 8 * 86400_000, action: "status", before: "contested", after: "active", by: "owner" },
    { at: NOW - 2 * 86400_000, action: "deleted", before: null, after: null, by: "owner" },
    { at: NOW - 2 * 86400_000, action: "restored", before: null, after: null, by: "owner" },
  ];
}

export function conversationGrantFixtures(o: FixtureOptions): ConversationGrantInfo[] {
  const { L, LONG } = texts(o);
  const H = 3_600_000;
  return [
    { id: "cgr_gallery1", botId: GALLERY_BOT_ID, botName: "Juno", thread: 0, label: LONG("CRM: create contact"), place: "CRM: create_contact", grantedAt: Date.now() - 40 * 60_000, uses: 6, lastUsedAt: Date.now() - 5 * 60_000, expiresAt: Date.now() + 11.5 * H },
    { id: "cgr_gallery2", botId: GALLERY_BOT_ID, botName: "Max", thread: 12, label: L("Cliquer", "Clicking"), place: "click: compta.example.com", grantedAt: Date.now() - 11.4 * H, uses: 1, lastUsedAt: Date.now() - 11 * H, expiresAt: Date.now() + 0.6 * H },
    { id: "cgr_gallery3", botId: GALLERY_BOT_ID, botName: "Nora", thread: 0, label: L("Lancer une commande", "Running a command"), place: "shell_run", grantedAt: Date.now() - 2 * H, uses: 0, lastUsedAt: null, expiresAt: Date.now() + 10 * H },
  ];
}

export function cardFixtures(o: FixtureOptions): CardFixture[] {
  const { L, LONG } = texts(o);
  const list: CardFixture[] = [];
  const add = <T extends Card["type"]>(type: T, statuses: readonly StatusOf<CardOf<T>>[], make: (status: StatusOf<CardOf<T>>) => CardOf<T>) => {
    for (const status of statuses) list.push({ type, status: String(status), card: make(status) });
  };

  add("approval", ["pending", "allowed", "always", "denied", "expired"], (status) => ({
    type: "approval", approvalId: `ap_${status}`, status,
    title: LONG(L("Envoyer l'e-mail « Devis mars » à Claire", "Send the “March quote” email to Claire")),
    detail: L("À : claire@example.com\nObjet : Devis mars\n\nBonjour Claire, voici le devis…", "To: claire@example.com\nSubject: March quote\n\nHi Claire, here is the quote…"),
    tool: "gmail_send", source: "Gmail",
    why: L("Tu n'as pas demandé cet envoi mot pour mot.", "You did not ask for this exact send."),
    quote: L("prépare le devis pour Claire", "prepare the quote for Claire"),
    irreversible: true, irreversibleReason: L("Un e-mail envoyé ne peut pas être rappelé.", "A sent email cannot be recalled."),
    once: true, outcome: status === "allowed" ? "done" : undefined,
  }));
  add("approval", ["pending"], (status) => ({
    type: "approval", approvalId: "ap_reversible", status, title: L("Créer le dossier « Clients 2027 »", "Create the “Clients 2027” folder"),
    detail: "", tool: "drive_create_folder", source: "Google Drive",
  }));
  // « Autoriser pour cette conversation »: the card that offers it (three answers), and once answered that way.
  add("approval", ["pending", "allowed"], (status) => ({
    type: "approval", approvalId: `ap_conversation_${status}`, status, title: LONG(L("Autoriser Juno à utiliser CRM : create contact ?", "Allow Juno to use CRM: create contact?")),
    detail: L("name: Paul Martin\ncompany: Atelier Martin", "name: Paul Martin\ncompany: Atelier Martin"), tool: "CRM: create_contact", source: "CRM",
    why: L("Le bot n'a cité aucun de tes mots pour cette action.", "The bot did not cite any words of yours for this action."),
    conversation: true, ...(status === "allowed" ? { grantedFor: "conversation" as const, outcome: "done" as const } : {}),
  }));
  add("question", ["pending", "answered", "dismissed"], (status) => ({
    type: "question", status, question: LONG(L("Quel format préfères-tu pour le rapport ?", "Which format do you prefer for the report?")),
    options: [L("Un PDF d'une page", "A one-page PDF"), L("Un tableau", "A spreadsheet"), L("Un résumé dans la discussion", "A summary in the chat")],
    answer: status === "answered" ? L("Un tableau", "A spreadsheet") : undefined,
  }));
  add("connect", ["pending", "connected", "skipped"], (status) => ({
    type: "connect", status, name: "Notion", hint: L("Pour lire tes pages de projet", "To read your project pages"),
    reason: LONG(L("J'ai besoin de Notion pour retrouver le compte rendu de la réunion.", "I need Notion to find the meeting notes.")),
  }));
  add("takeover", ["pending", "done", "timeout", "cancelled"], (status) => ({
    type: "takeover", takeoverId: `to_${status}`, status, reason: "captcha",
    detail: L("Le site demande de cocher « Je ne suis pas un robot ».", "The site asks to tick “I'm not a robot”."), expiresAt: NOW + 9 * MIN,
  }));
  add("secret", ["pending", "saved", "dismissed"], (status) => ({
    type: "secret", status, name: "OPENWEATHER_KEY", host: "api.openweathermap.org", header: "Authorization", prefix: "Bearer",
    reason: L("Pour lire la météo de demain.", "To read tomorrow's weather."),
  }));
  add("uncertain", ["pending", "checking", "done", "retried", "dismissed"], (status) => ({
    type: "uncertain", executionId: `ex_${status}`, status, title: L("Paiement de la facture 2041", "Payment of invoice 2041"),
    detail: L("Le serveur s'est arrêté pendant l'envoi : on ne sait pas si c'est passé.", "The server stopped during the send: we don't know if it went through."),
  }));
  add("task", ["running", "waiting", "done", "failed", "stopped"], (state) => ({
    type: "task", taskId: `tk_${state}`, helperId: `hp_${state}`, state, steps: 7,
    title: LONG(L("Comparer trois offres d'hébergement", "Compare three hosting offers")),
    now: state === "running" ? L("Lit la page des tarifs", "Reading the pricing page") : undefined,
    result: state === "done" ? L("OVH reste le moins cher à 6,99 €/mois.", "OVH stays the cheapest at €6.99/month.") : undefined,
    question: state === "waiting" ? L("Je garde les offres sans engagement seulement ?", "Only keep offers without commitment?") : undefined,
  }) as CardOf<"task">);
  add("nudge", ["pending", "doing", "later", "never"], (status) => ({
    type: "nudge", nudgeId: `nu_${status}`, status, title: L("Relancer Marc pour la facture", "Remind Marc about the invoice"),
    body: L("La facture de Marc a 12 jours de retard. Je peux lui écrire un rappel poli.", "Marc's invoice is 12 days late. I can write him a polite reminder."),
  }));
  add("spend", ["pending", "continued", "raised", "stopped"], (status) => ({
    type: "spend", checkpointId: `sp_${status}`, status, scope: "task", spentUsd: 2.4, thresholdUsd: 2,
    title: L("Recherche de fournisseurs", "Supplier research"),
  }));
  add("cap", ["pending", "continued", "raised", "waiting"], (status) => ({
    type: "cap", stopId: `cs_${status}`, status, botName: "Juno", used: 5.1, resetAt: NOW + 7 * HOUR, timezone: "Europe/Paris",
    held: 2, skipped: 1, canRaise: true,
    cap: { key: "acct:day:usd", botId: null, period: "day", unit: "usd", limit: 5, mode: "unattended", warnPercent: 80, setBy: "self", updatedAt: NOW - 3 * 24 * HOUR },
  }));
  add("skill", ["pending", "saved", "dismissed"], (status) => ({
    type: "skill", status, outside: false, name: L("Préparer un devis", "Prepare a quote"),
    when: L("Quand on me demande un devis client", "When asked for a client quote"),
    steps: L("1. Retrouver le client\n2. Reprendre le dernier devis\n3. Mettre à jour les prix", "1. Find the client\n2. Reuse the last quote\n3. Update the prices"),
    // L131: earlier requests found in other conversations
    evidence: [
      { at: NOW - 3 * 24 * HOUR, where: "Juno", quote: L("Tu peux refaire le devis pour [client] avec les nouveaux prix ?", "Can you redo the quote for [client] with the new prices?") },
      { at: NOW - 17 * 24 * HOUR, where: "Léon", quote: L("Prépare un devis comme la dernière fois, même format, livraison comprise, et envoie-le moi avant de le partager", "Prepare a quote like last time, same format, delivery included, and show it to me before sharing it") },
    ],
  }));
  add("apiconnector", ["pending", "approved", "dismissed"], (status) => ({
    type: "apiconnector", connectorId: `ac_${status}`, status, name: "OpenWeather", baseUrl: "https://api.openweathermap.org/data/2.5",
    host: "api.openweathermap.org", secret: "OPENWEATHER_KEY", secretSaved: status !== "pending",
    endpoints: [{ method: "GET", path: "/weather", description: L("Météo actuelle d'une ville", "Current weather for a city") }],
  }));
  add("apiconnector", ["pending"], () => ({
    type: "apiconnector", connectorId: "ac_preset", status: "pending", name: "Instagram", baseUrl: "https://graph.instagram.com/v27.0", preset: "instagram",
    host: "graph.instagram.com", secret: "Instagram access token", secretSaved: false,
    endpoints: [{ method: "GET", path: "/{id}/media", description: "The account's posts" }, { method: "POST", path: "/{id}/media_publish", description: "Publish a prepared post (creation_id): asks the owner" }],
  }));
  add("memory", ["pending", "kept", "replaced"], (status) => ({
    type: "memory", memoryId: `me_${status}`, status, oldText: L("Préfère les réunions le matin", "Prefers morning meetings"),
    newText: L("Préfère les réunions l'après-midi", "Prefers afternoon meetings"), quote: L("plutôt l'après-midi maintenant", "afternoons now, please"),
  }));
  add("mail", ["delivered", "held", "released", "replied"], (status) => ({
    type: "mail", mailId: `ml_${status}`, status, from: "facturation@example.com", subject: LONG(L("Votre facture de novembre", "Your November invoice")),
    snippet: L("Bonjour, veuillez trouver ci-joint…", "Hello, please find attached…"), auth: { spf: "pass", dkim: status === "held" ? "fail" : "pass", dmarc: status === "held" ? "fail" : "pass" }, spam: status === "held" ? 6 : 0,
  }));
  add("disk", ["pending", "cleaned", "dismissed"], (status) => ({
    type: "disk", checkId: `dk_${status}`, status, usedPct: 93, totalBytes: 20e9, freeBytes: 1.4e9,
    items: [{ path: "/root/files/videos", bytes: 6.2e9 }, { path: "/root/.cache", bytes: 2.1e9 }, { path: "/root/downloads/archive.zip", bytes: 9e8 }],
    deleted: status === "cleaned" ? ["/root/.cache"] : undefined, freedBytes: status === "cleaned" ? 2.1e9 : undefined,
  }));
  add("pastedsecret", ["pending", "saved", "discarded", "expired"], (status) => ({
    type: "pastedsecret", pendingId: `ps_${status}`, status, kind: "key", hint: "sk-", length: 51, name: "OPENAI_KEY", host: "api.openai.com", expiresAt: NOW + 25 * MIN,
  }));
  add("files", ["available", "undone", "expired"], (status) => ({
    type: "files", snapId: `sn_${status}`, baseId: `sb_${status}`, status, more: 2,
    files: [
      { path: "files/rapport.md", change: "modified", added: 24, removed: 3, binary: false, oldSize: 2100, newSize: 3400 },
      { path: "files/graphique.png", change: "added", added: null, removed: null, binary: true, oldSize: null, newSize: 48000 },
      { path: "files/brouillon.txt", change: "deleted", added: 0, removed: 12, binary: false, oldSize: 600, newSize: null },
    ],
    restored: status === "undone" ? ["files/rapport.md"] : undefined,
  }));
  // « Coordinateur d'échecs »: one card per class shown, in each status (incidentsFixtures.ts).
  for (const card of failureCardFixtures(o)) list.push({ type: "failure", status: card.status, card });
  add("goal", ["proposed", "active", "paused", "complete", "blocked", "limit", "stopped", "declined"], (status) => ({
    type: "goal", goalId: `gl_${status}`, status, rounds: 3, maxRounds: 10,
    objective: LONG(L("Trouver 20 prospects dans la restauration à Lyon", "Find 20 restaurant prospects in Lyon")),
    summary: L("12 prospects trouvés, je vérifie les adresses.", "12 prospects found, checking the addresses."),
    evidence: status === "complete" ? L("Tableau « prospects-lyon.csv », 20 lignes.", "Sheet “prospects-lyon.csv”, 20 rows.") : undefined,
    reason: status === "blocked" || status === "paused" ? L("Le site de l'annuaire demande une connexion.", "The directory site asks for a login.") : undefined,
  }));
  // L89: a goal with success criteria, each with its evidence, waiting for the owner's « Valider ».
  list.push({ type: "goal", status: "review", card: {
    type: "goal", goalId: "gl_review", status: "blocked", rounds: 4, maxRounds: 10, review: true,
    objective: LONG(L("Mettre en ligne la page de réservation", "Put the booking page online")),
    summary: L("La page est en ligne et testée.", "The page is online and tested."), reason: L("attend ton accord", "waiting for your approval"),
    criteria: [
      { text: L("La page s'ouvre sur téléphone", "The page opens on a phone"), evidence: L("Capture à 390 px, aucun défilement de côté", "Screenshot at 390 px, no side scroll") },
      { text: L("Le formulaire envoie une demande", "The form sends a request"), evidence: L("Demande test reçue à 14 h 05", "Test request received at 2:05 PM") },
      { text: L("Les tests passent", "The tests pass"), evidence: "12/12" },
    ],
  } });
  list.push(...turnCardFixtures(o)); list.push(...viewCardFixtures(o)); // L79, L83, L139 (turnFixtures.ts); DS-Bot item 8 (viewFixtures.ts)
  return list;
}

let seq = 1000;
const row = (body: Row["body"], at: number): Row => ({ botId: GALLERY_BOT_ID, generation: 1, seq: ++seq, rev: 1, createdAt: at, body });

/** Server notices of every kind, as rows of a chat (RowItems renders them as in the real chat). */
export function noticeRows(o: FixtureOptions): Row[] {
  const { L, LONG } = texts(o);
  const at = NOW - 20 * MIN;
  return [
    row({ kind: "notice", tone: "info", text: LONG(L("Juno a repris le travail après la mise à jour.", "Juno resumed work after the update.")) }, at),
    row({ kind: "notice", tone: "warn", text: L("Juno s'est arrêté à sa limite d'étapes.", "Juno stopped at its step limit."), action: { kind: "continue", status: "pending" } }, at + 1),
    row({ kind: "notice", tone: "warn", text: L("Juno a continué.", "Juno continued."), action: { kind: "continue", status: "done" } }, at + 2),
    row({ kind: "notice", tone: "warn", text: L("Juno ne répond pas encore (2 min).", "Juno is not answering yet (2 min)."), action: { kind: "watch", watch: "silent", status: "pending", minutes: 2, next: "gpt-5-mini", engine: "claude-code" } }, at + 3),
    row({ kind: "notice", tone: "warn", text: L("Juno semble bloqué depuis 6 min.", "Juno seems stuck for 6 min."), action: { kind: "watch", watch: "stalled", status: "pending", minutes: 6 } }, at + 4),
    row({ kind: "notice", tone: "info", text: L("Tu attends encore un peu.", "You're waiting a bit longer."), action: { kind: "watch", watch: "silent", status: "waiting", minutes: 4 } }, at + 5),
    row({ kind: "notice", tone: "error", text: L("Plafond du jour atteint : 5,00 $ sur 5,00 $.", "Daily cap reached: $5.00 of $5.00."), action: { kind: "settings", section: "usage" } }, at + 6),
    row({ kind: "notice", tone: "error", text: L("La clé OpenAI ne fonctionne plus.", "The OpenAI key no longer works."), action: { kind: "settings", section: "keys" } }, at + 7),
    row({ kind: "notice", tone: "error", text: L("Le budget IA du mois est épuisé.", "This month's AI budget is used up."), action: { kind: "plan", reason: "budget", resetAt: NOW + 9 * 24 * HOUR } }, at + 8),
    row({ kind: "notice", tone: "error", text: L("Juno est en pause : ton message attend.", "Juno is paused: your message is waiting.") }, at + 9),
    // The subscription at its usage limit (server/src/agent/sublimit.ts): to the backup, waiting with the reminder, back.
    row({ kind: "notice", tone: "info", text: L("Ton abonnement Claude est à sa limite jusqu'à 18:40 : je passe par DeepSeek Chat.", "Your Claude subscription is at its limit until 18:40: I am using DeepSeek Chat.") }, at + 10),
    row({ kind: "notice", tone: "warn", text: LONG(L("Ton abonnement Claude est à sa limite jusqu'à 18:40. Je n'ai pas de modèle de secours : ton travail attend ici et je le reprends dès que l'abonnement revient.", "Your Claude subscription is at its limit until 18:40. I have no backup model, so your work waits here and I will pick it up as soon as the subscription is back.")), action: { kind: "sublimit", engine: "claude-code", until: NOW + 2 * HOUR, notify: true, status: "waiting" } }, at + 11),
    row({ kind: "notice", tone: "warn", text: L("Ton abonnement ChatGPT est à sa limite jusqu'à 21:05. Je n'ai pas de modèle de secours : ton travail attend ici et je le reprends dès que l'abonnement revient.", "Your ChatGPT subscription is at its limit until 21:05. I have no backup model, so your work waits here and I will pick it up as soon as the subscription is back."), action: { kind: "sublimit", engine: "codex", until: NOW + 4 * HOUR, notify: false, status: "waiting" } }, at + 12),
    row({ kind: "notice", tone: "warn", text: L("Ton abonnement Claude est à sa limite jusqu'à 14:10. Je n'ai pas de modèle de secours : ton travail attend ici et je le reprends dès que l'abonnement revient.", "Your Claude subscription is at its limit until 14:10. I have no backup model, so your work waits here and I will pick it up as soon as the subscription is back."), action: { kind: "sublimit", engine: "claude-code", until: NOW - HOUR, notify: true, status: "back" } }, at + 13),
    row({ kind: "notice", tone: "info", text: L("Ton abonnement Claude est de nouveau disponible. Je reprends ce qui attendait.", "Your Claude subscription is available again. I am picking up what was waiting.") }, at + 14),
    ...turnNoticeRows(o, row, at + 15), // L63, L72, L94, L97, L98 (turnFixtures.ts)
  ];
}

function incident(o: FixtureOptions, id: string, severity: SentinelIncidentView["severity"], state: SentinelIncidentView["state"], fr: [string, string, string], en: [string, string, string], extra: Partial<SentinelIncidentView> = {}): SentinelIncidentView {
  const [title, explanation, fix] = o.lang === "fr" ? fr : en;
  const { LONG } = texts(o);
  return {
    id, fingerprint: id, kind: "gallery", severity, state, title: LONG(title), explanation, fix,
    count: 14, peak: 6, seen: 3, firstAt: NOW - 5 * HOUR, lastAt: NOW - 8 * MIN, resolvedAt: state === "resolved" ? NOW - 2 * HOUR : null,
    ackedAt: state === "acknowledged" ? NOW - 30 * MIN : null, ackedBy: state === "acknowledged" ? "toi@example.com" : null,
    sparkline: Array.from({ length: 24 }, (_, i) => (i > 18 ? 6 - (i - 19) : i % 7 === 0 ? 1 : 0)),
    link: { kind: "settings", section: "connectors" }, account: null, ...extra,
  };
}

/** The Surveillance page's data. `empty`: nothing open, no history (the calm state). */
export function sentinelOverview(o: FixtureOptions, empty: boolean): SentinelOverview {
  const open = empty ? [] : [
    incident(o, "inc_crit", "critical", "open",
      ["Les routines échouent en série", "5 routines de Juno ont échoué depuis 9 h : la connexion Gmail est refusée.", "Reconnecte Gmail dans Réglages → Connexions, puis relance une routine pour vérifier."],
      ["Routines are failing in a row", "5 of Juno's routines failed since 9am: the Gmail connection is refused.", "Reconnect Gmail in Settings → Connections, then run a routine again to check."]),
    incident(o, "inc_warn", "warn", "ongoing",
      ["Le disque se remplit", "Le disque du serveur est plein à 86 %.", "Supprime les anciennes sauvegardes ou agrandis le disque."],
      ["The disk is filling up", "The server's disk is 86% full.", "Delete old backups or enlarge the disk."], { link: { kind: "health" } }),
    incident(o, "inc_ack", "warn", "acknowledged",
      ["Coût en hausse", "Les dépenses d'aujourd'hui sont trois fois plus hautes que d'habitude.", "Regarde la page Consommation pour voir quel bot dépense le plus."],
      ["Cost going up", "Today's spending is three times higher than usual.", "Look at the Usage page to see which bot spends the most."], { account: "client@example.com" }),
    incident(o, "inc_info", "info", "open",
      ["Une sauvegarde a pris du retard", "La dernière sauvegarde date de 30 heures.", "Lance une sauvegarde depuis Réglages → Sauvegarde."],
      ["A backup is late", "The last backup is 30 hours old.", "Run a backup from Settings → Backup."], { link: null }),
  ];
  const history = empty ? [] : [
    incident(o, "inc_old1", "critical", "resolved", ["Docker ne répondait plus", "", ""], ["Docker was not answering", "", ""]),
    incident(o, "inc_old2", "warn", "resolved", ["Trop d'échecs de connexion", "", ""], ["Too many failed logins", "", ""]),
  ];
  const counts = { info: 0, warn: 0, critical: 0 };
  for (const i of open) counts[i.severity]++;
  return {
    incidents: open, history, counts, everyMin: 10, nextScanAt: NOW + 7 * MIN,
    limits: empty ? [] : [
      { engine: "claude-code", until: NOW + 2 * HOUR, since: NOW - 3 * HOUR, source: "event", bots: 2, queued: 1, account: null },
      { engine: "codex", until: NOW + 50 * MIN, since: NOW - 10 * MIN, source: "default", bots: 1, queued: 0, account: "marie@example.com" },
    ],
    lastScan: { at: NOW - 3 * MIN, durationMs: 420, opened: open.length, resolved: 0, detectors: [
      { name: "routine_failures", ok: true, ms: 12 }, { name: "disk_low", ok: true, ms: 3 }, { name: "docker", ok: false, ms: 2000, error: "timeout" }, { name: "hosted_budget", ok: true, ms: 0, skipped: true },
    ] },
    health: { status: empty ? "ok" : "degraded", code: "ok", at: NOW - 3 * MIN, checks: [
      { name: "db", state: "ok", code: "ok" }, { name: "docker", state: empty ? "ok" : "degraded", code: empty ? "ok" : "slow" }, { name: "disk", state: empty ? "ok" : "degraded", code: empty ? "ok" : "low" },
      { name: "scheduler", state: "ok", code: "ok" }, { name: "backup", state: "off", code: "off" }, { name: "queue", state: "ok", code: "ok" },
    ] },
  };
}

/** The "Aujourd'hui" page's data. `empty`: a quiet day with nothing to do and nothing done. */
export function todayReport(o: FixtureOptions, empty: boolean): TodayReport {
  const { L, LONG } = texts(o);
  const start = new Date(NOW);
  start.setHours(0, 0, 0, 0);
  const s = start.getTime();
  const link = { kind: "bot" as const, botId: GALLERY_BOT_ID };
  return {
    date: start.toISOString().slice(0, 10), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, start: s, end: s + 24 * HOUR, today: true, generatedAt: NOW,
    limits: empty ? [] : [{ engine: "claude-code", until: NOW + 2 * HOUR, since: NOW - 3 * HOUR, source: "event", bots: 2, queued: 1 }],
    needs: empty ? [] : [
      { kind: "approval", botId: GALLERY_BOT_ID, botName: "Juno", title: LONG(L("Envoyer l'e-mail « Devis mars » à Claire", "Send the “March quote” email to Claire")), detail: "Gmail", at: NOW - 12 * MIN, link },
      { kind: "cap", botId: GALLERY_BOT_ID, botName: "Juno", title: L("Plafond du jour atteint", "Daily cap reached"), detail: "5,00 $", at: NOW - 40 * MIN, link },
      { kind: "paused", botId: "bot_other", botName: "Atlas", title: L("En pause", "Paused"), detail: "", count: 3, at: NOW - 2 * HOUR, link: { kind: "bot", botId: "bot_other" } },
      { kind: "incident", botId: null, botName: "", title: L("Les routines échouent en série", "Routines are failing in a row"), detail: "", at: NOW - 3 * HOUR, link: { kind: "surveillance", incidentId: "inc_crit" } },
      { kind: "failure", botId: GALLERY_BOT_ID, botName: "Juno", title: L("Le compte doit être reconnecté", "The account needs signing in again"), detail: "Invalid API key · Please run /login", at: NOW - 3 * MIN, link },
    ],
    done: empty ? [] : [
      { botId: GALLERY_BOT_ID, botName: "Juno", shared: false, minutes: 50, items: [
        { kind: "emailSent", at: NOW - HOUR, title: L("Relance envoyée à Marc", "Reminder sent to Marc"), detail: "", count: 1, counted: 1, minutes: 5, link },
        { kind: "research", at: NOW - 2 * HOUR, title: L("Comparatif hébergeurs", "Hosting comparison"), detail: L("14 pages lues", "14 pages read"), count: 14, counted: 1, minutes: 30, link: null },
        { kind: "fileEdit", at: NOW - 3 * HOUR, title: "rapport.md", detail: "", count: 3, counted: 3, minutes: 15, link: null },
      ] },
      { botId: "bot_other", botName: "Atlas", shared: true, minutes: 15, items: [
        { kind: "routine", at: NOW - 4 * HOUR, title: L("Résumé du matin", "Morning summary"), detail: "", count: 1, counted: 1, minutes: 15, link: null },
      ] },
    ],
    minutes: { total: empty ? 0 : 65, table: { ...DEFAULT_MINUTES }, counts: empty ? {} : { emailSent: 1, research: 1, fileEdit: 3, routine: 1 }, overridden: [] },
    failures: failureSummaryFixture(empty),
    cost: { usd: empty ? 0 : 1.84, estimatedUsd: empty ? 0 : 0.12, inputTokens: 412_000, outputTokens: 38_000, turns: 23, subscriptionTokens: 0, byBot: empty ? [] : [{ botId: GALLERY_BOT_ID, botName: "Juno", usd: 1.5, tokens: 380_000 }, { botId: "bot_other", botName: "Atlas", usd: 0.46, tokens: 70_000 }] },
  };
}

/** « Annonces »: what a reader sees (Today's cards, the bell, the maintenance band). `empty`: nothing up. */
export function announcementsState(o: FixtureOptions, empty: boolean): AnnouncementsState {
  const { L, LONG } = texts(o);
  const items: AnnouncementView[] = empty ? [] : [
    { id: "ann_imp", kind: "important", title: L("Nouvelles conditions d'utilisation le 1er décembre", "New terms of use on December 1"), body: LONG(L("Les conditions changent pour les comptes de test : relis-les avant la fin du mois.\nDétails : https://sklubot.example/cgu.", "The terms change for test accounts: read them again before the end of the month.\nDetails: https://sklubot.example/terms.")), link: { url: "https://sklubot.example/cgu", label: L("Lire les conditions", "Read the terms") }, startsAt: NOW - 2 * HOUR, endsAt: null, siteBanner: false, unread: true },
    { id: "ann_maint", kind: "maintenance", title: L("Maintenance ce soir de 22 h à 23 h", "Maintenance tonight from 10 to 11 pm"), body: L("Les bots seront en pause pendant une heure ; rien n'est perdu, ils reprennent ensuite.", "Bots will pause for an hour; nothing is lost, they resume afterwards."), link: null, startsAt: NOW - 30 * MIN, endsAt: NOW + 6 * HOUR, siteBanner: true, unread: true },
    { id: "ann_new", kind: "new", title: L("Nouveau : les voix gratuites pour tous les bots", "New: free voices for every bot"), body: L("Chaque bot a maintenant sa propre voix. Change-la dans Réglages → Voix.", "Every bot now has its own voice. Change it in Settings → Voice."), link: null, startsAt: NOW - 26 * HOUR, endsAt: null, siteBanner: false, unread: false },
    { id: "ann_info", kind: "info", title: L("Merci aux testeurs !", "Thanks to the testers!"), body: L("Vos retours de la semaine sont dans le journal des changements.", "Your feedback of the week is in the changelog."), link: null, startsAt: NOW - 3 * 24 * HOUR, endsAt: null, siteBanner: false, unread: false },
  ];
  return { items, unread: items.filter((i) => i.unread).length, site: items.find((i) => i.siteBanner) ?? null, canAuthor: true, emailOptIn: true };
}

/** The page « Annonces » (owner / operators). `empty`: nothing written yet. */
export function announcementsAdmin(o: FixtureOptions, empty: boolean): AnnouncementsAdmin {
  const { L } = texts(o);
  const reader = announcementsState(o, empty).items;
  const base = { emails: [] as string[], createdAt: NOW - 3 * HOUR, updatedAt: NOW - 2 * HOUR, authorName: "Alex", dismissed: 0, sent: { push: 0, email: 0, skipped: 0 } };
  const items: AnnouncementAdminItem[] = empty ? [] : [
    { ...base, ...pick(reader[0]), audience: { type: "everyone" }, audienceLabel: "", push: true, email: true, status: "live", recipients: 42, dismissed: 17, sent: { push: 31, email: 38, skipped: 4 } },
    { ...base, ...pick(reader[1]), audience: { type: "plan", planId: "free" }, audienceLabel: L("Gratuit", "Free"), push: true, email: false, status: "live", recipients: 28, dismissed: 3, sent: { push: 22, email: 0, skipped: 6 } },
    { ...base, id: "ann_sched", kind: "new", title: L("Bientôt : l'application Android", "Coming: the Android app"), body: L("Disponible lundi pour les testeurs.", "Available on Monday for testers."), link: { url: "https://sklubot.example/android", label: L("Voir", "See") }, startsAt: NOW + 3 * 24 * HOUR, endsAt: NOW + 10 * 24 * HOUR, siteBanner: false, audience: { type: "workspace", workspaceId: "ws_beta" }, audienceLabel: L("Bêta-testeurs", "Beta testers"), push: true, email: false, status: "scheduled", recipients: 9 },
    { ...base, id: "ann_acc", kind: "info", title: L("Ton accès avancé est prêt", "Your advanced access is ready"), body: "", link: null, startsAt: NOW - 5 * 24 * HOUR, endsAt: NOW - 24 * HOUR, siteBanner: false, audience: { type: "accounts", userIds: ["u1", "u2", "u3"] }, emails: ["camille@exemple.fr", "sam@exemple.fr", "lou@exemple.fr"], audienceLabel: "", push: false, email: false, status: "ended", recipients: 3, dismissed: 2 },
  ];
  return {
    items, plans: [{ id: "free", name: L("Gratuit", "Free") }, { id: "included", name: L("Tout inclus", "All included") }],
    workspaces: [{ id: "ws_beta", name: L("Bêta-testeurs", "Beta testers"), members: 9 }], mailConfigured: true,
    log: empty ? [] : [
      { at: NOW - 2 * HOUR, actorName: "Alex", action: "edit", title: items[0].title },
      { at: NOW - 3 * HOUR, actorName: "Alex", action: "create", title: items[0].title },
      { at: NOW - 24 * HOUR, actorName: "Sam", action: "archive", title: L("Ancienne maintenance", "Old maintenance") },
    ],
  };
}
const pick = (v: AnnouncementView) => ({ id: v.id, kind: v.kind, title: v.title, body: v.body, link: v.link, startsAt: v.startsAt, endsAt: v.endsAt, siteBanner: v.siteBanner });

/**
 * A whole conversation for the gallery's « chat » page (the real chat view, phone or desktop): what broke on an iPhone —
 * long replies with a long link, a code block and a table, the raw warning of a subscription tool, several « Stopped. »
 * notices in a row, a finished turn's steps, a progress line, empty rows (skipped) and a thread.
 */
export function chatRows(o: FixtureOptions): Row[] {
  const { L } = texts(o);
  const at = NOW - 3 * HOUR;
  const url = "https://www.example.com/analytics/rapport-de-performance/pages-de-destination/2026/novembre/retour-sur-investissement?utm_source=sklubot&utm_medium=chat&utm_campaign=roi-des-pages-longues&ref=comparatif-mensuel-detaille";
  const user = (text: string, t: number) => row({ kind: "message", role: "user", text }, t);
  const bot = (text: string, t: number, extra: Partial<Extract<Row["body"], { kind: "message" }>> = {}) => row({ kind: "message", role: "assistant", text, ...extra }, t);
  const step = (label: string, t: number) => row({ kind: "step", callId: `c${t}`, tool: "web_search", label, status: "done", args: {}, summary: L("3 résultats", "3 results") }, t);
  const stopped = (t: number) => row({ kind: "notice", tone: "info", text: L("Arrêté.", "Stopped.") }, t);
  const list: Row[] = [
    user(L("Salut, tu peux regarder le ROI de mes pages ? La fin était coupée la dernière fois.", "Hi, can you look at the ROI of my pages? The end was cut off last time."), at),
    step(L("Recherche sur le web", "Web search"), at + 5_000),
    step(L("Lecture de la page des statistiques", "Reading the analytics page"), at + 9_000),
    // The raw warning a subscription tool printed (shown as is by older servers): it must wrap, not overflow.
    row({ kind: "notice", tone: "warn", text: "Exceeded skills context budget. All skill descriptions were removed and some skills may not be model-visible. Reduce the number of installed skills or disable unused skills in ~/.codex/config.toml." }, at + 10_000),
    bot(L(
      `Tu parles du retour sur investissement de tes pages ? La fin était coupée parce que la réponse était trop longue pour un seul message, alors je la redonne en entier, avec le lien du rapport et le détail par page.\n\nLe rapport complet : ${url}\n\n| Page | Visites | Conversions | Coût | ROI |\n|---|---:|---:|---:|---:|\n| /accueil-et-presentation-generale | 12 480 | 312 | 1 250 € | 148 % |\n| /tarifs | 8 902 | 401 | 980 € | 212 % |\n| /blog/comment-choisir-son-hebergement-web-en-2026 | 5 117 | 64 | 420 € | 37 % |\n\nPour recalculer toi-même :\n\n\`\`\`js\nconst roi = (gain, cout) => ((gain - cout) / cout) * 100; // ROI en pourcentage, arrondi à l'unité la plus proche pour le tableau ci-dessus\nconsole.log(roi(3100, 1250).toFixed(0) + " %");\n\`\`\`\n\nLe mot le plus long du rapport : \`identifiant_de_suivi_de_campagne_publicitaire_pour_les_pages_de_destination_longues\`.`,
      `Are you talking about the return on investment of your pages? The end was cut off because the answer was too long for one message, so here it is in full, with the report link and the detail per page.\n\nThe full report: ${url}\n\n| Page | Visits | Conversions | Cost | ROI |\n|---|---:|---:|---:|---:|\n| /home-and-general-presentation | 12,480 | 312 | €1,250 | 148% |\n| /pricing | 8,902 | 401 | €980 | 212% |\n| /blog/how-to-choose-web-hosting-in-2026 | 5,117 | 64 | €420 | 37% |\n\nTo compute it yourself:\n\n\`\`\`js\nconst roi = (gain, cost) => ((gain - cost) / cost) * 100; // ROI as a percentage, rounded to the nearest unit for the table above\nconsole.log(roi(3100, 1250).toFixed(0) + "%");\n\`\`\`\n\nThe longest word of the report: \`campaign_tracking_identifier_for_the_long_landing_pages_of_the_monthly_comparison\`.`,
    ), at + 60_000),
    stopped(at + 61_000),
    // Empty rows a turn can leave (a message with no words): never shown, never a gap.
    bot("", at + 62_000),
    bot("   ", at + 62_500),
    user(L("Merci ! Et pour la page tarifs ?", "Thanks! And for the pricing page?"), at + 120_000),
    row({ kind: "event", event: "progress", text: L("Je compare avec le mois dernier, encore une minute…", "Comparing with last month, one more minute…") }, at + 125_000),
    bot(L("La page tarifs est la plus rentable : 212 %. Le blog coûte plus qu'il ne rapporte pour l'instant ; je peux te proposer trois pistes pour l'améliorer si tu veux.", "The pricing page is the most profitable: 212%. The blog costs more than it brings in for now; I can suggest three ways to improve it if you like."), at + 150_000, { replies: { count: 2, lastAt: at + 200_000 } }),
    stopped(at + 151_000),
    user(L("Oui vas-y", "Yes go ahead"), at + 180_000),
    step(L("Lecture du blog", "Reading the blog"), at + 185_000),
    bot(L("1. Ajouter un appel à l'action en fin d'article.\n2. Relier chaque article à la page tarifs.\n3. Réécrire les titres des cinq articles les plus lus.", "1. Add a call to action at the end of each post.\n2. Link each post to the pricing page.\n3. Rewrite the titles of the five most read posts."), at + 240_000),
    stopped(at + 241_000),
    stopped(at + 242_000),
    // A page the bot published: the chat shows its preview card (PagePreview.tsx), here with the gallery's sample page.
    bot(L(`J'ai mis le suivi des ventes dans une page : [Ventes de novembre](${location.origin}/p/galleryDemoPageToken0001)`, `I put the sales tracking in a page: [November sales](${location.origin}/p/galleryDemoPageToken0001)`), at + 300_000),
  ];
  const parent = list.find((r) => r.body.kind === "message" && r.body.replies)!;
  list.push(
    { ...user(L("Tu peux détailler la piste 2 ?", "Can you detail idea 2?"), at + 190_000), thread: parent.seq },
    { ...bot(L(`Oui : un lien en fin d'article vers ${url}`, `Yes: a link at the end of each post to ${url}`), at + 200_000), thread: parent.seq },
  );
  return list;
}
