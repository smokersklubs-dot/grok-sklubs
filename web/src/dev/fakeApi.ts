/**
 * The dev gallery's stand-in for the server: `fetch("/api/…")` answers from the fixtures, so the real pages (Today,
 * Surveillance) render without a server. Buttons answer after a short delay (to show their busy state), or fail with
 * a sample error when the gallery's "fail" switch is on. Development only.
 */
import { landingData, sampleDownloads } from "./landingFixtures";
import { announcementsAdmin, announcementsState, sentinelOverview, todayReport, type FixtureOptions } from "./fixtures";
import { githubPreviewFixture, libraryFixture, versionsFixture } from "./skillsFixtures";
import { incidentsFixture } from "./incidentsFixtures";
import { commandFixture, fakeScreen } from "./commandFixtures";

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
      await wait(600);
      return s.fail ? json(500, { error: s.lang === "fr" ? "Exemple d'erreur : le serveur n'a pas pu le faire." : "Sample error: the server could not do it." }) : json(200, {});
    }
    if (path === "/today") return json(200, todayReport(s, s.empty));
    // « Qui répond » in a group chat (GalleryRooms.tsx): the room's settings and its quick model.
    if (/^\/bots\/[^/]+\/routing$/.test(path)) return json(200, { routing: { discreet: false, askFirst: true }, model: s.empty ? null : "OpenRouter google/gemini-2.5-flash-lite" });
    // « Centre de commandement »: the team, and a drawn screen for the computers that are on.
    if (path === "/command") return json(200, commandFixture(s));
    if (/^\/bots\/[^/]+\/screen$/.test(path)) return new Response(fakeScreen(path.split("/")[2].replace(/^cmd_/, "")), { headers: { "content-type": "image/svg+xml" } });
    if (path === "/surveillance") return json(200, sentinelOverview(s, s.empty));
    if (path === "/announcements") return json(200, announcementsState(s, s.empty));
    if (path === "/announcements-admin") return json(200, announcementsAdmin(s, s.empty));
    if (path === "/public/landing") return json(200, landingData(s.empty));
    if (path === "/downloads") return json(200, sampleDownloads(s.empty));
    if (path === "/models") return json(200, { models: [] });
    if (path === "/skills-library") return json(200, libraryFixture(s));
    if (/^\/pages\/[^/]+\/versions$/.test(path)) return json(200, versionsFixture());
    // « Incidents » (Activité tab): the bot's failure log.
    if (/^\/bots\/[^/]+\/failures$/.test(path)) return json(200, { failures: incidentsFixture(s.empty) });
    // The chat page (GalleryChat.tsx): the call button asks for the bot's voice.
    if (/^\/bots\/[^/]+\/voice$/.test(path)) return json(200, { status: { mode: "browser" } });
    return json(200, {});
  };
}
