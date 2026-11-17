/**
 * The dev gallery's stand-in for the server: `fetch("/api/…")` answers from the fixtures, so the real pages (Today,
 * Surveillance) render without a server. Buttons answer after a short delay (to show their busy state), or fail with
 * a sample error when the gallery's "fail" switch is on. Development only.
 */
import { sentinelOverview, todayReport, type FixtureOptions } from "./fixtures";

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
    if (method !== "GET") {
      await wait(600);
      return s.fail ? json(500, { error: s.lang === "fr" ? "Exemple d'erreur : le serveur n'a pas pu le faire." : "Sample error: the server could not do it." }) : json(200, {});
    }
    if (path === "/today") return json(200, todayReport(s, s.empty));
    if (path === "/surveillance") return json(200, sentinelOverview(s, s.empty));
    if (path === "/models") return json(200, { models: [] });
    return json(200, {});
  };
}
