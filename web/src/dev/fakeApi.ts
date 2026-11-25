/**
 * The dev gallery's stand-in for the server: `fetch("/api/…")` answers from the fixtures, so the real pages (Today,
 * Surveillance) render without a server. Buttons answer after a short delay (to show their busy state), or fail with
 * a sample error when the gallery's "fail" switch is on. Development only.
 */
import { landingData, sampleDownloads } from "./landingFixtures";
import { announcementsAdmin, announcementsState, conversationGrantFixtures, memoryHistoryFixture, sentinelOverview, todayReport, type FixtureOptions } from "./fixtures";
import { promptViewFixture, semanticFixture, summaryFixture } from "./GalleryMemory";
import { githubPreviewFixture, libraryFixture, scanReportFixture, versionsFixture } from "./skillsFixtures"; import { benchFixture, catalogFixture, skillHealthFixture, versionsListFixture } from "./skillHealthFixtures";
import { incidentsFixture } from "./incidentsFixtures"; import { rows23Get } from "./GalleryRows23";
import { commandFixture, fakeScreen } from "./commandFixtures";
import { teamMdExportFixture, teamMdPreviewFixture, teamMdReportFixture } from "./teamMdFixtures";
import { hookSignedFixture, hookTestFixture, reportsFixture } from "./trustFixtures";
import { relayGuardFixture } from "./relayGuardFixtures";
import { routineExtrasFixture, routinePreviewFixture, researchFixture, routineRunsFixture, usageDailyFixture } from "./routineFixtures";
import { botSecurityFixture, browserFixture, recipientsFixture, securitySettingsFixture, vaultAccessFixture } from "./securityFixtures";
import { careGet, careSend } from "./GalleryCare"; import { channelsFixture } from "./GalleryChannels"; import { comfort6Get } from "./GalleryComfort6"; import { comfort7Get, officeFixture } from "./GalleryComfort7"; import { comfort9Get } from "./GalleryComfort9"; import { comfort10Get } from "./GalleryComfort10"; import { inboxFixture } from "./turnFixtures"; import { extensionsGet } from "./GalleryExtensions";

export interface FakeApiState extends FixtureOptions { empty: boolean; fail: boolean }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installFakeApi(get: () => FakeApiState): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const s = get();
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice(4);
    // « Écouter »: a second of silence as the bot's voice (the player's states are set by the gallery, GalleryChat.tsx).
    if (method === "POST" && /^\/bots\/[^/]+\/rows\/\d+\/speak$/.test(path)) {
      const wav = new Uint8Array(44 + 16000); const v = new DataView(wav.buffer);
      [..."RIFF"].forEach((ch, i) => v.setUint8(i, ch.charCodeAt(0))); v.setUint32(4, 36 + 16000, true); [..."WAVEfmt "].forEach((ch, i) => v.setUint8(8 + i, ch.charCodeAt(0)));
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      [..."data"].forEach((ch, i) => v.setUint8(36 + i, ch.charCodeAt(0))); v.setUint32(40, 16000, true);
      return new Response(wav, { headers: { "content-type": "audio/wav", "x-speak-part": "0", "x-speak-parts": "1", "x-speak-voice": "Camille" } });
    }
    if (method !== "GET") {
      // The editor's check on « Annonces »: how many accounts it reaches.
      if (path === "/announcements-admin/preview" && !s.fail) { await wait(150); return json(200, { ok: true, recipients: 42, view: null }); }
      // « Bibliothèque de compétences »: the GitHub lookup answers with a sample repository.
      if (path === "/skills-library/github/preview" && !s.fail) { await wait(150); return json(200, { preview: githubPreviewFixture() }); }
      if (/^\/skills-library\/[^/]+\/add$/.test(path) && !s.fail) { await wait(150); return json(200, { report: { added: [{ botId: "b", botName: "jiren" }], already: [] } }); }
      // « Contrôle de sécurité des compétences »: the result of « Vérifier mes compétences ».
      // « Santé des compétences » (SkillHealth.tsx): the bench answers side by side; the rest answers with the report.
      if (/\/bench$/.test(path) && !s.fail) { await wait(300); return json(200, { result: benchFixture(s) }); }
      if (/^\/skills\/[^/]+\/meta$/.test(path) && !s.fail) { await wait(150); return json(200, { report: skillHealthFixture(s, s.empty) }); }
      if (path === "/skills/duplicates") return json(200, { similar: s.empty ? [] : [{ skillId: "x", name: s.lang === "fr" ? "Factures du mois" : "Monthly invoices", botName: "Compta", score: 0.82 }] });
      if (path === "/skills/scan" && !s.fail) { await wait(150); return json(200, { report: s.empty ? { scannedAt: Date.now(), skills: 6, clean: 6, entries: [] } : scanReportFixture(s) }); }
      // « Équipe Sklubot (.md) » (GalleryTeamMd.tsx): the review screen, the creation, the share window.
      // « Règles de sécurité » of a linked computer: saving answers with what was sent.
      if (method === "PUT" && /^\/relay\/devices\/[^/]+\/guard$/.test(path) && !s.fail) { await wait(150); return json(200, relayGuardFixture(s.empty, JSON.parse(String(init?.body ?? "{}")))); }
      // 22/11 comfort batch: Telegram voice notes written out, chat mute, a command's own Stop.
      if (/^\/bots\/[^/]+\/telegram\/voice-text$/.test(path) && !s.fail) { await wait(150); return json(200, { enabled: JSON.parse(String(init?.body ?? "{}")).enabled === true, provider: "whisper-cpp", cost: "local", maxSeconds: 120 }); }
      if (/^\/bots\/[^/]+\/mute$/.test(path) && !s.fail) { await wait(100); const m = JSON.parse(String(init?.body ?? "{}")).mute; return json(200, { muted: m !== "off", until: m === "8h" ? Date.now() + 8 * 3_600_000 : null }); }
      if (/^\/bots\/[^/]+\/messages$/.test(path) && method === "POST" && !s.fail) { await wait(100); const b = JSON.parse(String(init?.body ?? "{}")); return json(200, { row: { seq: 90_000 + Math.floor(Math.random() * 1000), botId: path.split("/")[2], generation: 1, thread: 0, createdAt: Date.now(), body: { kind: "message", role: "user", text: String(b.text ?? "") } } }); }
      // L162 « Canaux » (GalleryChannels.tsx): every change answers with the same view.
      if (/^\/bots\/[^/]+\/(channels|contacts)(\/|$)/.test(path) && !s.fail) { await wait(150); return json(200, channelsFixture(s, s.empty)); }
      if (/^\/bots\/[^/]+\/commands\/[^/]+\/stop$/.test(path) && !s.fail) { await wait(150); return json(200, { stopped: true }); }
      if (path === "/team-md/preview" && !s.fail) { await wait(150); return json(200, teamMdPreviewFixture(s)); }
      if (path === "/team-md/commit" && !s.fail) { await wait(150); return json(200, { report: teamMdReportFixture() }); }
      if (path === "/team-md/export" && !s.fail) { await wait(100); return json(200, teamMdExportFixture(s)); }
      // Webhooks (L20) and reported replies (L31), GalleryTrust.tsx: what the real server answers.
      if (/^\/routines\/[^/]+\/hook\/test$/.test(path) && !s.fail) { await wait(150); return json(200, hookTestFixture()); }
      if (/^\/routines\/[^/]+\/hook(\/secret)?$/.test(path) && !s.fail) { await wait(150); return json(200, { ...hookSignedFixture(s), ...(method === "DELETE" ? { signed: false, secretSetAt: null } : {}), ...(method === "POST" ? {} : { secret: undefined }) }); }
      // nod items 2, 8, 13 (GalleryRoutines.tsx): the preview of the next runs, saving, approving.
      if (/^\/bots\/[^/]+\/routines\/preview$/.test(path) && !s.fail) { await wait(100); return json(200, routinePreviewFixture(s)); }
      if (/^\/reports\/[^/]+\/done$/.test(path) && !s.fail) { await wait(150); return json(200, reportsFixture(s, s.empty)); }
      // L79 (GalleryLoopPlus.tsx): « Relire mon plan contre ma demande ».
      if (/^\/bots\/[^/]+\/rows\/\d+\/plan-review$/.test(path) && !s.fail) { await wait(300); const fr = s.lang === "fr"; return json(200, { review: { verdict: "gaps", missing: [fr ? (s.long ? "le formulaire de contact avec l'envoi d'une copie au client et la protection contre les robots" : "le formulaire de contact") : "the contact form"], extra: [fr ? "la page À propos" : "the About page"], note: "" } }); }
      if (!s.fail) { const care = careSend(method, path, typeof init?.body === "string" ? JSON.parse(init.body) : {}, s); if (care !== undefined) { await wait(150); return json(200, care); } } // L161 (GalleryCare.tsx)
      await wait(600);
      return s.fail ? json(500, { error: s.lang === "fr" ? "Exemple d'erreur : le serveur n'a pas pu le faire." : "Sample error: the server could not do it." }) : json(200, {});
    }
    { const care = careGet(path, s); if (care !== undefined) return json(200, care); } // L161 bot care (GalleryCare.tsx)
    { const w9 = comfort9Get(path, s); if (w9 !== undefined) return json(200, w9); } // wave 9 web rows (GalleryComfort9.tsx)
    { const w10 = comfort10Get(path, s); if (w10 !== undefined) return json(200, w10); } // wave 10 rows (GalleryComfort10.tsx)
    { const r23 = rows23Get(path, s); if (r23 !== undefined) return json(200, r23); } // 23/11 rows (GalleryRows23.tsx)
    { const w6 = comfort6Get(path, s); if (w6 !== undefined) return json(200, w6); } // wave 6 comfort (GalleryComfort6.tsx)
    { const x7 = extensionsGet(path, s); if (x7 !== undefined) return json(200, x7); } // wave 7 extensions (GalleryExtensions.tsx)
    { const w7 = path.endsWith("/files/office-preview") ? officeFixture(url.searchParams.get("path") ?? "", s) : comfort7Get(path, s); if (w7 !== undefined) return json(200, w7); } // wave 7 comfort (GalleryComfort7.tsx)
    if (path === "/today") return json(200, todayReport(s, s.empty));
    if (path === "/inbox") return json(200, inboxFixture(s)); // L139 « À toi »
    if (/^\/routines\/[^/]+\/extras$/.test(path)) return json(200, routineExtrasFixture(s, s.empty));
    if (/^\/routines\/[^/]+\/runs$/.test(path)) return json(200, routineRunsFixture(s, s.empty)); if (path === "/usage/daily") return json(200, usageDailyFixture(s.empty)); // L142
    if (/^\/bots\/[^/]+\/research$/.test(path)) return json(200, researchFixture(s, s.empty)); if (path === "/research/x-account") return json(200, { provider: null, personal: false }); // L156
    // Wave 6 (L54 / L86 / L183, RoutineOptions.tsx; L58, QueuedNotes.tsx).
    if (/^\/routines\/[^/]+\/options$/.test(path)) return json(200, s.empty ? { announce: "thread", condition: "", heavy: false } : { announce: "thread", condition: s.lang === "fr" ? "Seulement si un concurrent baisse ses prix" : "Only if a competitor cuts its prices", heavy: true });
    if (/^\/bots\/[^/]+\/notes$/.test(path)) return json(200, { notes: s.empty ? [] : [{ id: 1, thread: 0, text: s.lang === "fr" ? (s.long ? "Ajoute aussi les prix de livraison pour la Belgique, la Suisse et le Luxembourg, et vérifie les délais annoncés sur chaque site de chaque transporteur international." : "Ajoute aussi la Belgique") : "Add Belgium too" }, { id: 2, thread: 0, text: s.lang === "fr" ? "Et c'est quoi le délai moyen ?" : "And what is the average delay?" }] });
    // Loop and turns 23/11 (GalleryLoopPlus.tsx): L69 model modes, L96 who can ask whom.
    if (/^\/bots\/[^/]+\/model-mode$/.test(path)) return json(200, { mode: s.empty ? "balanced" : "auto", subscription: false, models: s.empty ? { balanced: "", fast: null, strongest: null, free: null } : { balanced: "anthropic:claude-sonnet-5-5", fast: s.long ? "up-openrouter-personnel:google/gemini-2.5-flash-lite-preview-with-a-very-long-name" : "anthropic:claude-haiku-5-5", strongest: "anthropic:claude-opus-5-5", free: null } });
    if (path === "/team/ask-policy") return json(200, { mode: s.empty ? "open" : "hierarchy" });
    if (path === "/team/helper-inherit") return json(200, { on: true });
    if (path === "/team/section-leads") return json(200, { leads: s.empty ? {} : { sec_sales: "bot_max", sec_support: "bot_sam" } });
    if (/^\/bots\/[^/]+\/routines\/live$/.test(path)) return json(200, { live: s.empty ? [] : [{ routineId: "rtn_gallery_nod", steps: 4, caption: s.lang === "fr" ? "Lit les nouvelles du secteur" : "Reading the industry news", activity: "browsing", since: Date.now() - 90_000, awaiting: null }] });
    if (/^\/bots\/[^/]+\/work-models$/.test(path)) return json(200, { routines: "", tasks: s.empty ? "" : "openrouter:google/gemini-2.5-flash", background: "" });
    // Réglages → Mémoire, « Modifier » then « Historique » (MemoryEdit.tsx): what changed in a note.
    if (/^\/memories\/[^/]+\/history$/.test(path)) return json(200, { history: s.empty ? [] : memoryHistoryFixture(s) });
    // Mémoire L71–L138 (GalleryMemory.tsx): « Voir le résumé », « Ce que reçoit ce bot », « Mémoire par le sens ».
    if (/^\/bots\/[^/]+\/summary$/.test(path)) return json(200, summaryFixture(s, s.empty));
    if (/^\/bots\/[^/]+\/prompt-view$/.test(path)) return json(200, promptViewFixture(s, s.empty));
    if (path === "/memory/semantic") return json(200, semanticFixture(s.empty));
    // « Qui répond » in a group chat (GalleryRooms.tsx): the room's settings and its quick model.
    if (/^\/bots\/[^/]+\/routing$/.test(path)) return json(200, { routing: { discreet: false, askFirst: true }, model: s.empty ? null : "OpenRouter google/gemini-2.5-flash-lite" });
    // « Centre de commandement »: the team, and a drawn screen for the computers that are on.
    if (path === "/command") return json(200, commandFixture(s));
    if (/^\/relay\/devices\/[^/]+\/guard$/.test(path)) return json(200, relayGuardFixture(s.empty));
    if (/^\/bots\/[^/]+\/telegram\/voice-text$/.test(path)) return json(200, { enabled: !s.empty, provider: "whisper-cpp", cost: "local", maxSeconds: 120 });
    if (/^\/bots\/[^/]+\/mute$/.test(path)) return json(200, { muted: false, until: null });
    if (/^\/bots\/[^/]+\/channels$/.test(path)) return json(200, channelsFixture(s, s.empty));
    if (/^\/bots\/[^/]+\/screen$/.test(path)) return new Response(fakeScreen(path.split("/")[2].replace(/^cmd_/, "")), { headers: { "content-type": "image/svg+xml" } });
    if (path === "/surveillance") return json(200, sentinelOverview(s, s.empty));
    if (path === "/reports") return json(200, reportsFixture(s, s.empty));
    if (path === "/announcements") return json(200, announcementsState(s, s.empty));
    if (path === "/announcements-admin") return json(200, announcementsAdmin(s, s.empty));
    if (path === "/public/landing") return json(200, landingData(s.empty));
    if (path === "/downloads") return json(200, sampleDownloads(s.empty));
    if (path === "/models") return json(200, { models: [] });
    // « Autoriser pour cette conversation »: the owner's active grants (Settings → Permissions).
    if (path === "/conversation-grants") return json(200, { grants: s.empty ? [] : conversationGrantFixtures(s) });
    // Lot 1 security (GallerySecurity.tsx).
    if (path === "/security/settings") return json(200, securitySettingsFixture(s.empty));
    if (path === "/security/browser") return json(200, browserFixture(s.empty));
    if (/^\/bots\/[^/]+\/security$/.test(path)) return json(200, botSecurityFixture(s, s.empty));
    if (/^\/bots\/[^/]+\/email\/recipients$/.test(path)) return json(200, recipientsFixture(s.empty));
    // Wave 6 (OpenAccess.tsx): network access, provider keys, outgoing webhooks.
    if (/^\/bots\/[^/]+\/network$/.test(path)) return json(200, { policy: s.empty ? { mode: "all", hosts: [] } : { mode: "list", hosts: ["wikipedia.org", "api.github.com"] }, blocked: s.empty ? [] : ["exemple-interdit.com"], max: 200 });
    if (/^\/bots\/[^/]+\/provider-keys$/.test(path)) return json(200, { choices: {}, providers: s.empty ? [] : [{ id: "up-demo", name: "DeepSeek", keys: [{ id: "main", name: "Clé principale", resting: false }, { id: "pk_1", name: "Travail", resting: true }] }] });
    if (/^\/api-providers\/[^/]+\/keys$/.test(path)) return json(200, { keys: [{ id: "main", name: "Clé principale", resting: false }, { id: "pk_1", name: "Travail", resting: true, lastError: "limit reached (429)" }] });
    if (/^\/bots\/[^/]+\/webhooks$/.test(path)) return json(200, { events: ["message.created", "task.finished", "approval.pending"], webhooks: s.empty ? [] : [{ id: "owh_1", url: "https://exemple.com/webhook", events: ["message.created", "task.finished"], active: true, createdAt: Date.now() - 86400_000, deliveries: [{ id: "d1", event: "message.created", status: "done", attempts: 1, lastStatus: 204, lastError: "", createdAt: Date.now() - 600_000, deliveredAt: Date.now() - 600_000 }, { id: "d2", event: "task.finished", status: "failed", attempts: 7, lastStatus: 500, lastError: "HTTP 500", createdAt: Date.now() - 7200_000, deliveredAt: null }] }] });
    if (/^\/vault\/[^/]+\/access$/.test(path)) return json(200, vaultAccessFixture(s.empty));
    if (path === "/skills-library") return json(200, libraryFixture(s));
    if (path === "/skills/health") return json(200, { report: skillHealthFixture(s, s.empty) });
    if (path === "/skills-catalog") return json(200, { catalog: catalogFixture(s, s.empty) });
    if (/^\/skills\/[^/]+\/versions$/.test(path)) return json(200, { versions: s.empty ? [] : versionsListFixture(s) });
    if (/^\/pages\/[^/]+\/versions$/.test(path)) return json(200, versionsFixture());
    // « Incidents » (Activité tab): the bot's failure log.
    if (/^\/bots\/[^/]+\/failures$/.test(path)) return json(200, { failures: incidentsFixture(s.empty) });
    // The chat page (GalleryChat.tsx): the call button asks for the bot's voice.
    if (/^\/bots\/[^/]+\/voice$/.test(path)) return json(200, { status: { mode: "browser" } });
    return json(200, {});
  };
}
