/** L184 on the phone: quote, link preview, pinned dashboard, metrics (lib/chatPlus.ts) and the bot theme (shared/botTheme.ts). */
import { appliedTheme, TOKEN_TO_PHONE, withBotTheme } from "../shared/botTheme";
import { firstLink, quoteOf, replyDraft } from "../shared/chatPlus";
import { dash, draftWithQuote, fetchPreview, forgetPreviews, metricTiles, quoteMessage, useQuote, usd, type Metrics } from "../src/lib/chatPlus";
import { en } from "../src/i18n/en";
import { fr, type Key } from "../src/i18n/fr";
import { translate } from "../src/i18n";
import { themes } from "../src/theme";

type Call = <T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<T>;
const recorder = (answer: unknown) => {
  const calls: string[] = [];
  const call: Call = async <T,>(m: string, p: string, b?: unknown) => { calls.push(`${m} ${p}${b === undefined ? "" : ` ${JSON.stringify(b)}`}`); return answer as T; };
  return { calls, call };
};

describe("quote (same Markdown quote as the web's « Répondre »)", () => {
  it("drops code and Markdown marks, keeps one line of at most 280 characters", () => {
    expect(quoteOf("## Titre\n**Gras** et `code`\n```js\nlet x = 1\n```\n> fin")).toBe("Titre Gras et code … fin");
    expect(quoteOf("a".repeat(400))).toHaveLength(280);
    expect(quoteOf("   ")).toBe("");
  });
  it("puts the quote above what was already typed", () => {
    expect(replyDraft("Le devis est prêt", "")).toBe("> Le devis est prêt\n\n");
    expect(replyDraft("ligne 1\nligne 2", "  et donc ?  ")).toBe("> ligne 1\n> ligne 2\n\net donc ?\n");
    expect(draftWithQuote("x", "y")).toBe(replyDraft("x", "y"));
  });
  it("hands one quote to that chat's composer, once", () => {
    useQuote.setState({ pending: {} });
    expect(quoteMessage("b1", "   ")).toBe(false);
    expect(quoteMessage("b1", "Voici **le plan**")).toBe(true);
    expect(useQuote.getState().take("b2")).toBeNull();
    expect(useQuote.getState().take("b1")).toBe("Voici le plan");
    expect(useQuote.getState().take("b1")).toBeNull();
  });
});

describe("link preview", () => {
  beforeEach(() => forgetPreviews());
  it("asks the server once per address, the address encoded", async () => {
    const { calls, call } = recorder({ preview: { url: "https://exemple.fr/a?b=1", host: "exemple.fr", title: "Titre", description: "", siteName: "Exemple" } });
    const url = firstLink("Regarde https://exemple.fr/a?b=1.")!;
    expect(url).toBe("https://exemple.fr/a?b=1");
    const a = await fetchPreview(call, url);
    const b = await fetchPreview(call, url);
    expect(a?.title).toBe("Titre");
    expect(b).toBe(a);
    expect(calls).toEqual(["GET /link-preview?url=https%3A%2F%2Fexemple.fr%2Fa%3Fb%3D1"]);
  });
  it("shows nothing when the server has no preview or fails", async () => {
    expect(await fetchPreview(recorder({ preview: null }).call, "https://a.fr/")).toBeNull();
    expect(await fetchPreview(recorder({ junk: 1 }).call, "https://b.fr/")).toBeNull();
    const failing: Call = async () => { throw new Error("429"); };
    expect(await fetchPreview(failing, "https://c.fr/")).toBeNull();
  });
  it("never previews an address inside code", () => {
    expect(firstLink("`https://interne.local/x`")).toBeNull();
  });
});

describe("pinned dashboard (same routes as the web app)", () => {
  const pin = { id: "pin/1", botId: "b 1", botName: "Léa", title: "Ventes", seq: 4, updatedAt: 1, card: null };
  it("pins, lists, moves and unpins with the server's routes, keeping only well-formed pins", async () => {
    const { calls, call } = recorder({ pins: [pin, { id: 3 }, null] });
    await dash.pin(call, "b 1", 4);
    expect(await dash.list(call)).toEqual([pin]);
    expect(await dash.move(call, "pin/1", -1)).toEqual([pin]);
    expect(await dash.unpin(call, "pin/1")).toEqual([pin]);
    expect(calls).toEqual(["POST /bots/b%201/cards/4/pin", "GET /dashboard/pins", 'POST /dashboard/pins/pin%2F1/move {"dir":-1}', "DELETE /dashboard/pins/pin%2F1"]);
    expect(await dash.list(recorder({}).call)).toEqual([]);
  });
});

describe("metrics", () => {
  const m: Metrics = { bots: 3, rooms: 1, connectors: 2, messages: { user: 10, assistant: 12 }, messages24h: 5, tokens: { input: 1000, output: 500, cached: 0 }, costUsd: 1.234, costUsd30d: 0.5, tokens24h: 200, approvalsPending: 1, routineRuns: { ok: 7, failed: 2, other: 1 } };
  it("gives the seven tiles of the web panel, in French", () => {
    const t = (k: Key, v?: Record<string, string | number>) => translate("fr", k, v);
    const tiles = metricTiles(m, String, t);
    expect(tiles.map((x) => x[0])).toEqual(["metrics.bots", "metrics.messages", "metrics.tokens", "metrics.cost", "metrics.routines", "metrics.waiting", "metrics.apps"]);
    expect(tiles[1]).toEqual(["metrics.messages", "22", "5 en 24 h"]);
    expect(tiles[3]).toEqual(["metrics.cost", "1.23 $", "0.50 $ sur 30 jours"]);
    expect(tiles[4][2]).toBe("7 faits · 2 en échec");
    expect(usd(Number.NaN)).toBe("0.00 $");
  });
});

describe("bot theme on the phone", () => {
  const view = { applied: { light: { "--bg": "#FAF7F0", "--ink": "#1f3a5f", "--ink-fg": "#ffffff", "--danger": "#000000", "--text": "red", "--accent": "#123456" }, dark: { "--bg": "#101418" } } };
  it("lays the checked colours over the phone's own, the bubble following the ink", () => {
    const a = appliedTheme(view)!;
    const c = withBotTheme(themes.light, a.light);
    expect(c.bg).toBe("#faf7f0");
    expect(c.ink).toBe("#1f3a5f");
    expect(c.userBubble).toBe("#1f3a5f");
    expect(c.userBubbleFg).toBe("#ffffff");
    expect(c.text).toBe(themes.light.text); // "red" is not a #rrggbb colour
    expect(c.danger).toBe(themes.light.danger); // status colours keep their meaning
    expect(themes.light.bg).toBe("#f4f2ee"); // the base is not changed
    expect(withBotTheme(themes.dark, a.dark).bg).toBe("#101418");
  });
  it("only maps tokens to colours the phone has", () => {
    const names = new Set(Object.keys(themes.light));
    for (const list of Object.values(TOKEN_TO_PHONE)) for (const n of list) expect(names.has(n)).toBe(true);
    expect(Object.keys(TOKEN_TO_PHONE)).not.toContain("--danger");
  });
  it("no theme, or a malformed one: the phone's own colours", () => {
    expect(appliedTheme({ applied: null })).toBeNull();
    expect(appliedTheme({ applied: { light: "x" } })).toBeNull();
    expect(appliedTheme(null)).toBeNull();
    expect(withBotTheme(themes.light, null)).toBe(themes.light);
  });
});

test("every new text exists in French and English", () => {
  const keys = (Object.keys(fr) as Key[]).filter((k) => /^(quote|dash|metrics)\.|^settings\.botTheme/.test(k));
  expect(keys.length).toBe(28);
  for (const k of keys) { expect(en[k]).toBeTruthy(); expect(en[k]).not.toBe(""); }
});
