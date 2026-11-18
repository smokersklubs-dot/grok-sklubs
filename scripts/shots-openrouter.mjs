// Screenshots of « Mes comptes IA »: the onboarding step, Settings → Mes comptes IA (OpenRouter, ChatGPT, Claude), the
// OpenRouter key saved and its model picker, Settings → Models with the OpenRouter tile, and the « Connecter mon compte
// ChatGPT » flow, at 390 and 1440 px, light and dark → docs/screenshots/openrouter/.
//   npm run build -w web && node scripts/shots-openrouter.mjs
// Starts its own server (hosted mode) on a temporary data folder with a local fake OpenRouter (nothing leaves the
// machine). This server has no Linux computers, so the ChatGPT flow's three answers are faked in the browser only
// (Playwright page.route): its screen stays empty in the shots.
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/screenshots/openrouter");
mkdirSync(OUT, { recursive: true });

const KEY = "sk-or-v1-screenshots-0123456789abcdef";
const m = (id, name, created, ctx, prompt, completion, images = false) => ({ id, name, created, context_length: ctx, architecture: { input_modalities: images ? ["text", "image"] : ["text"] }, pricing: { prompt, completion }, supported_parameters: ["tools", "tool_choice"], endpoints: ["/api/v1/chat/completions"] });
const CATALOG = { data: [
  m("deepseek/deepseek-v4.1-flash", "DeepSeek: V4.1 Flash", 50, 1_000_000, "0.0000003", "0.0000012"),
  m("google/gemini-3.8-flash", "Google: Gemini 3.8 Flash", 49, 2_000_000, "0.0000001", "0.0000004", true),
  m("mistralai/mistral-small-2603", "Mistral: Mistral Small 2603", 48, 128_000, "0.0000001", "0.0000003"),
  m("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5", 47, 1_000_000, "0.000003", "0.000015", true),
  m("qwen/qwen3.8-flash", "Qwen: Qwen3.8 Flash", 46, 1_000_000, "0.00000005", "0.0000004"),
  m("meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick", 45, 1_000_000, "0.00000015", "0.0000006", true),
  m("openai/gpt-6.2-astra", "OpenAI: GPT-6.2 Astra", 44, 1_050_000, "0.000004", "0.00002", true),
  m("x-ai/grok-5-fast", "xAI: Grok 5 Fast", 43, 2_000_000, "0.0000002", "0.0000005"),
  m("z-ai/glm-5.3", "Z.ai: GLM 5.3", 42, 200_000, "0.0000006", "0.0000022"),
  m("moonshotai/kimi-k3", "MoonshotAI: Kimi K3", 41, 256_000, "0.0000006", "0.0000025"),
  m("inclusionai/ling-3.2-flash:free", "inclusionAI: Ling 3.2 Flash (free)", 40, 128_000, "0", "0"),
] };
const fake = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url?.startsWith("/api/v1/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(CATALOG));
    if (req.headers.authorization !== `Bearer ${KEY}`) return void res.writeHead(401).end("{}");
    if (req.url === "/api/v1/key") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: { limit_remaining: 9.42, usage: 0.58 } }));
    res.writeHead(404).end("{}");
  });
});
const fakePort = await new Promise((r) => { fake.listen(0, "127.0.0.1", () => r(fake.address().port)); });

const port = 18941;
const dataDir = mkdtempSync(join(tmpdir(), "sklubot-shots-or-"));
const env = { ...process.env, PORT: String(port), PUBLIC_URL: `http://localhost:${port}`, DATA_DIR: dataDir, SESSION_SECRET: "shots-secret-shots-secret-shots-secret", NO_SCHEDULER: "1", COMPUTER: "browser",
  HOSTED_MODE: "1", OPEN_SIGNUP: "1", SIGNUP_PER_IP: "1000", EMAIL_VERIFICATION: "0", FREE_PLAN_COMPUTER: "personal", ALLOW_PRIVATE_FETCH: "1", OPENROUTER_BASE_URL: `http://127.0.0.1:${fakePort}/api/v1` };
for (const k of ["PADDLE_ENV", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_CLIENT_TOKEN", "PADDLE_PRODUCT_ID", "GOOGLE_LOGIN_CLIENT_ID", "GOOGLE_LOGIN_CLIENT_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete env[k];
const child = spawn("npx", ["tsx", "src/index.ts"], { cwd: join(ROOT, "server"), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
child.stderr.on("data", (d) => { if (/error/i.test(String(d))) process.stderr.write(d); });
const base = `http://localhost:${port}`;
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const call = async (method, path, body, cookie = "") => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("sklubot_session=")) ?? "" };
};
await call("POST", "/auth/signup", { email: "owner@sklubot.example", password: "owner-password-1", name: "Owner", locale: "fr" });

const browser = await chromium.launch();
const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } fake.close(); };
process.on("uncaughtException", (e) => { console.error(e); stop(); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); stop(); process.exit(1); });
const VARIANTS = [["390", { width: 390, height: 844 }, "light"], ["390", { width: 390, height: 844 }, "dark"], ["1440", { width: 1440, height: 900 }, "light"], ["1440", { width: 1440, height: 900 }, "dark"]];
const shot = async (p, name, full = false) => { await p.waitForTimeout(500); await p.screenshot({ path: join(OUT, `${name}.png`), fullPage: full }); };
const openSettings = async (p, label) => {
  if (!(await p.$(".app-settings"))) { await p.keyboard.press("Control+,"); await p.waitForTimeout(400); }
  await p.click(`.app-settings-nav button:has-text('${label}')`);
  await p.waitForTimeout(700);
};

let n = 0;
for (const [w, size, scheme] of VARIANTS) {
  const email = `camille-${++n}@example.org`;
  const cust = await call("POST", "/auth/signup", { email, password: "camille-password-1", name: "Camille", locale: "fr", acceptTerms: true });
  const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, locale: "fr-FR", deviceScaleFactor: 1 });
  const [cn, cv] = cust.cookie.split("=");
  await ctx.addCookies([{ name: cn, value: cv, url: base }]);
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  // 1. The first run: « Choisis comment tes bots travaillent ».
  await p.goto(`${base}/`);
  await p.waitForSelector(".onb .ai-account");
  await shot(p, `onboarding-ai-accounts-${w}-${scheme}`);
  await p.click(".onb-foot .btn-ghost");
  await call("PUT", "/account/push-prompt", { status: "later" }, cust.cookie);
  await p.waitForTimeout(500);
  // 2. Settings → Mes comptes IA.
  await openSettings(p, "Mes comptes IA");
  await p.waitForSelector(".ai-account");
  await shot(p, `settings-ai-accounts-${w}-${scheme}`);
  // 3. Settings → Models: the OpenRouter tile (shown until the account has its OpenRouter).
  await openSettings(p, "Modèles");
  await p.evaluate(() => [...document.querySelectorAll("h3.pane-heading")].find((h) => /Fournisseurs d'API/.test(h.textContent ?? ""))?.scrollIntoView({ block: "start" }));
  await shot(p, `settings-models-openrouter-tile-${w}-${scheme}`);
  await p.click("button:has-text('Ajouter OpenRouter')");
  await p.waitForSelector(".provider-or .ai-account");
  await p.evaluate(() => document.querySelector(".provider-or")?.scrollIntoView({ block: "start" }));
  await shot(p, `settings-models-openrouter-open-${w}-${scheme}`);
  await p.keyboard.press("Escape").catch(() => undefined);
  await p.waitForTimeout(300);
  await openSettings(p, "Mes comptes IA");
  // 4. The OpenRouter key saved, tested, and the model picker.
  await p.fill(".ai-account input[type=password]", KEY);
  await p.click(".ai-account button[type=submit]");
  await p.waitForSelector(".ai-account.is-connected");
  await p.click(".ai-account.is-connected button:has-text('Tester')");
  await p.waitForSelector(".ai-account .provider-check.is-ok");
  await p.evaluate(() => document.querySelector(".ai-account.is-connected")?.scrollIntoView({ block: "start" }));
  await shot(p, `openrouter-connected-${w}-${scheme}`);
  await p.click(".ai-account button:has-text('Choisir les modèles')");
  await p.waitForSelector(".or-model");
  await p.fill(".or-search input", "");
  await p.evaluate(() => document.querySelector(".or-picker")?.scrollIntoView({ block: "start" }));
  await shot(p, `openrouter-picker-${w}-${scheme}`);
  await p.fill(".or-search input", "flash");
  await shot(p, `openrouter-picker-search-${w}-${scheme}`);
  // 5. « Connecter mon compte ChatGPT »: this server has no Linux computers, so the flow's answers are faked here.
  let signed = false;
  await p.route("**/api/connect-subscription", (r) => r.fulfill({ json: { allowed: true, why: null, whyText: null, bots: [{ id: "b1", name: "Juno", primary: true }], mainBotId: "b1" } }));
  await p.route("**/api/connect-subscription/start", (r) => r.fulfill({ json: { botId: "b1", engine: "codex", defaultRef: "codex:default" } }));
  await p.route("**/api/connect-subscription/status*", (r) => r.fulfill({ json: { signedIn: signed, account: signed ? "camille@example.org" : null } }));
  await p.route("**/api/bots/b1/desktop/control", (r) => r.fulfill({ json: { ok: true } }));
  await p.keyboard.press("Escape").catch(() => undefined);
  await p.waitForTimeout(300);
  await openSettings(p, "Mes comptes IA");
  await p.click("button:has-text('Connecter mon compte ChatGPT')");
  await p.waitForSelector(".ai-flow");
  await shot(p, `connect-chatgpt-start-${w}-${scheme}`);
  await p.click(".ai-flow button:has-text('Ouvrir la page de connexion')");
  await p.waitForSelector(".ai-flow-screen");
  await shot(p, `connect-chatgpt-screen-${w}-${scheme}`);
  signed = true;
  await p.click(".ai-flow button:has-text('Vérifier')");
  await p.waitForSelector(".ai-flow-done");
  await shot(p, `connect-chatgpt-done-${w}-${scheme}`);
  await ctx.close();
}
await browser.close();
try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
fake.close();
console.log(`screenshots → ${OUT}`);
process.exit(0);
