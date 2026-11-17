/**
 * Fake data for the dev gallery (web/src/dev/Gallery.tsx). Never shipped: the gallery is only loaded in development.
 * Every text comes in French and English (`L`), and `long` swaps in very long texts to check wrapping on a phone.
 */
import type { Bot, Card, Row, SentinelIncidentView, SentinelOverview, TodayReport } from "../types";
import { DEFAULT_MINUTES } from "../types";

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
  }));
  add("apiconnector", ["pending", "approved", "dismissed"], (status) => ({
    type: "apiconnector", connectorId: `ac_${status}`, status, name: "OpenWeather", baseUrl: "https://api.openweathermap.org/data/2.5",
    host: "api.openweathermap.org", secret: "OPENWEATHER_KEY", secretSaved: status !== "pending",
    endpoints: [{ method: "GET", path: "/weather", description: L("Météo actuelle d'une ville", "Current weather for a city") }],
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
  add("goal", ["proposed", "active", "paused", "complete", "blocked", "limit", "stopped", "declined"], (status) => ({
    type: "goal", goalId: `gl_${status}`, status, rounds: 3, maxRounds: 10,
    objective: LONG(L("Trouver 20 prospects dans la restauration à Lyon", "Find 20 restaurant prospects in Lyon")),
    summary: L("12 prospects trouvés, je vérifie les adresses.", "12 prospects found, checking the addresses."),
    evidence: status === "complete" ? L("Tableau « prospects-lyon.csv », 20 lignes.", "Sheet “prospects-lyon.csv”, 20 rows.") : undefined,
    reason: status === "blocked" || status === "paused" ? L("Le site de l'annuaire demande une connexion.", "The directory site asks for a login.") : undefined,
  }));
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
    cost: { usd: empty ? 0 : 1.84, estimatedUsd: empty ? 0 : 0.12, inputTokens: 412_000, outputTokens: 38_000, turns: 23, subscriptionTokens: 0, byBot: empty ? [] : [{ botId: GALLERY_BOT_ID, botName: "Juno", usd: 1.5, tokens: 380_000 }, { botId: "bot_other", botName: "Atlas", usd: 0.46, tokens: 70_000 }] },
  };
}
