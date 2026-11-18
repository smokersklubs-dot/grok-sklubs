// Screenshots of the "Connexion ou inscription" screen, the first run's new steps, Settings → Credits (payment off and a
// a fake Paddle configured, user and Administration views) and Today's notifications banner, at 390 and 1440 px, light
// and dark → docs/screenshots/credits/.
//   npm run build -w web && node scripts/shots-credits.mjs        (ONLY=payment: only the "Paddle configured" shots)
// Starts its own server(s) on a temporary data folder, with a local fake SMTP server (nothing leaves the machine).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/screenshots/credits");
mkdirSync(OUT, { recursive: true });

const inbox = [];
const smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS", "AUTH"], logger: false, disableReverseLookup: true,
  onData(stream, _s, cb) { const ch = []; stream.on("data", (c) => ch.push(c)); stream.on("end", async () => { const p = await simpleParser(Buffer.concat(ch)); inbox.push(p.text ?? ""); cb(); }); } });
const smtpPort = await new Promise((r) => { const s = smtp.listen(0, "127.0.0.1", () => r(s.address().port)); });

async function server(port, extra) {
  const dataDir = mkdtempSync(join(tmpdir(), "sklubot-shots-"));
  const env = { ...process.env, PORT: String(port), PUBLIC_URL: `http://localhost:${port}`, DATA_DIR: dataDir, SESSION_SECRET: "shots-secret-shots-secret-shots-secret", NO_SCHEDULER: "1", COMPUTER: "browser",
    HOSTED_MODE: "1", OPEN_SIGNUP: "1", SIGNUP_PER_IP: "1000", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort), SMTP_TLS: "none", SMTP_FROM: "robot@sklubot.example", FREE_PLAN_COMPUTER: "personal", ...extra };
  for (const k of ["PADDLE_ENV", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_CLIENT_TOKEN", "PADDLE_PRODUCT_ID", "GOOGLE_LOGIN_CLIENT_ID", "GOOGLE_LOGIN_CLIENT_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) if (!(k in extra)) delete env[k];
  const child = spawn("npx", ["tsx", "src/index.ts"], { cwd: join(ROOT, "server"), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stderr.on("data", (d) => { if (/error/i.test(String(d))) process.stderr.write(d); });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  const base = `http://localhost:${port}`;
  const call = async (method, path, body, cookie = "") => {
    const r = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("sklubot_session=")) ?? "" };
  };
  const owner = await call("POST", "/auth/signup", { email: "owner@sklubot.example", password: "owner-password-1", name: "Owner", locale: "fr" });
  return { base, call, child, dataDir, ownerCookie: owner.cookie };
}

const browser = await chromium.launch();
const VARIANTS = [["390", { width: 390, height: 844 }, "light"], ["390", { width: 390, height: 844 }, "dark"], ["1440", { width: 1440, height: 900 }, "light"], ["1440", { width: 1440, height: 900 }, "dark"]];
async function page(srv, size, scheme, cookie) {
  const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, locale: "fr-FR", deviceScaleFactor: 1, permissions: ["notifications"] });
  if (cookie) { const [n, v] = cookie.split("="); await ctx.addCookies([{ name: n, value: v, url: srv.base }]); }
  // Headless Chromium answers "denied" for notifications: the shots show the step as a fresh browser does ("default").
  await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch { /* none */ } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  return { p, ctx };
}
const shot = async (p, name) => { await p.waitForTimeout(500); await p.screenshot({ path: join(OUT, `${name}.png`), fullPage: false }); };

// ── Payment off (production today), Google not configured ──
const ONLY_PAYMENT = process.env.ONLY === "payment";
const off = ONLY_PAYMENT ? null : await server(18931, {});
for (const [w, size, scheme] of ONLY_PAYMENT ? [] : VARIANTS) {
  const { p, ctx } = await page(off, size, scheme);
  await p.goto(`${off.base}/?auth=signup`);
  await p.waitForSelector(".auth-title");
  await shot(p, `signin-${w}-${scheme}`);
  await p.fill("input[type=email]", `visitor-${w}-${scheme}@example.org`);
  await p.click("button[type=submit]");
  await p.waitForSelector("input[type=password]");
  await shot(p, `signin-password-${w}-${scheme}`);
  await p.click("text=Recevoir un lien de connexion par e-mail");
  await p.waitForSelector(".auth-sent-icon");
  await shot(p, `signin-link-sent-${w}-${scheme}`);
  // The link: the last step for a new address (name + terms).
  for (let i = 0; i < 40 && !inbox.some((x) => x.includes(`email_link=`)); i++) await p.waitForTimeout(100);
  const text = inbox.pop() ?? "";
  const link = /(\/\?email_link=[^\s]+)/.exec(text)?.[1];
  await p.goto(`${off.base}${link}`);
  await p.waitForSelector(".hosted-terms");
  await shot(p, `signin-link-finish-${w}-${scheme}`);
  await p.fill("input[autocomplete=given-name]", "Camille");
  await p.check(".hosted-terms input");
  await p.click("button[type=submit]");
  // The first run: "Choisis comment tes bots travaillent", then "Active les notifications".
  await p.waitForSelector(".onb-way");
  await shot(p, `onboarding-how-${w}-${scheme}`);
  await p.click(".onb-way >> nth=2");
  await p.click(".onb-foot-right .btn-primary");
  await p.waitForSelector(".onb-push");
  await shot(p, `onboarding-notifications-${w}-${scheme}`);
  // Skip the rest: "Plus tard" → Today's banner.
  await p.click(".onb-foot .btn-ghost");
  await p.waitForTimeout(600);
  await p.keyboard.press("Control+,");
  await p.waitForTimeout(400);
  await p.click(".app-settings button:has-text('Crédits')").catch(() => undefined);
  await p.waitForSelector(".credit-ways").catch(() => undefined);
  await shot(p, `settings-credits-off-${w}-${scheme}`);
  await ctx.close();
}

// ── A fake Paddle configured (sandbox values of the documented shapes; checkout itself is not called), Google configured ──
const on = await server(18932, { PADDLE_ENV: "sandbox", PADDLE_API_KEY: "pdl_sdbx_apikey_screenshotsonly", PADDLE_WEBHOOK_SECRET: "pdl_ntfset_screenshots_only", PADDLE_CLIENT_TOKEN: "test_screenshots_only", PADDLE_PRODUCT_ID: "pro_01screenshotsonly000000000", GOOGLE_LOGIN_CLIENT_ID: "shots.apps.googleusercontent.com", GOOGLE_LOGIN_CLIENT_SECRET: "shots-secret", EMAIL_VERIFICATION: "0" });
const cust = await on.call("POST", "/auth/signup", { email: "camille@example.org", password: "camille-password-1", name: "Camille", locale: "fr", acceptTerms: true });
await on.call("POST", "/onboarding/skip", {}, cust.cookie);
await on.call("PUT", "/account/push-prompt", { status: "later" }, cust.cookie);
const db = new DatabaseSync(join(on.dataDir, "sklubot.db"));
const uid = db.prepare("SELECT id FROM users WHERE email = 'camille@example.org'").get()?.id;
await on.call("POST", `/admin/customers/${uid}/credit`, { amountEur: 10, lasting: true, note: "Bienvenue" }, on.ownerCookie);
db.prepare("INSERT INTO credit_topups (id, user_id, month, amount_eur, note, by_id, at, kind, source, external_ref) VALUES ('top_shot', ?, ?, 20, 'pack-2000', 'paddle', ?, 'prepaid', 'paddle', 'txn_01screenshotsonly000000000')").run(uid, new Date().toISOString().slice(0, 7), Date.now() - 2 * 86_400_000);
db.prepare("INSERT INTO credit_topups (id, user_id, month, amount_eur, note, by_id, at, kind, source, external_ref) VALUES ('top_shot_refund', ?, ?, -5, 'refund txn_01screenshotsonly000000000', 'paddle', ?, 'prepaid', 'paddle', 'adj_01screenshotsonly000000000')").run(uid, new Date().toISOString().slice(0, 7), Date.now() - 86_400_000);
for (const [w, size, scheme] of VARIANTS) {
  if (!ONLY_PAYMENT) {
  const g = await page(on, size, scheme);
  await g.p.goto(`${on.base}/?auth=login`);
  await g.p.waitForSelector(".google-btn");
  await shot(g.p, `signin-google-${w}-${scheme}`);
  await g.ctx.close();
  }
  const { p, ctx } = await page(on, size, scheme, cust.cookie);
  await p.goto(`${on.base}/`);
  await p.waitForTimeout(1200);
  if (size.width < 700) await p.click("button[aria-label='Ouvrir le menu']").catch(() => undefined);
  await p.click(".sidebar >> text=Aujourd’hui").catch(() => p.click("text=Aujourd’hui").catch(() => undefined));
  await p.waitForSelector(".push-banner").catch(() => undefined);
  await shot(p, `today-notifications-banner-${w}-${scheme}`);
  await p.keyboard.press("Control+,");
  await p.waitForTimeout(400);
  await p.click(".app-settings button:has-text('Crédits')").catch(() => undefined);
  await p.waitForSelector(".credit-ways").catch(() => undefined);
  await shot(p, `settings-credits-paddle-${w}-${scheme}`);
  await ctx.close();
  // The owner's Administration → Settings → Credits: provider, mode, connected.
  const a = await page(on, size, scheme, on.ownerCookie);
  await a.p.goto(`${on.base}/`);
  await a.p.waitForTimeout(1200);
  await a.p.keyboard.press("Control+,");
  await a.p.waitForTimeout(400);
  await a.p.click(".app-settings button:has-text('Administration')").catch(() => undefined);
  await a.p.waitForTimeout(800);
  await a.p.click(".seg-tab:has-text('Réglages')").catch(() => undefined);
  await a.p.waitForTimeout(500);
  await a.p.evaluate(() => { const h = [...document.querySelectorAll("h3.pane-heading")].find((x) => x.textContent?.trim() === "Crédits"); h?.scrollIntoView({ block: "start" }); });
  await shot(a.p, `admin-credits-paddle-${w}-${scheme}`);
  await a.ctx.close();
}
// The landing page's pricing section (hosted mode).
for (const [w, size, scheme] of ONLY_PAYMENT ? [] : VARIANTS.filter(([, , s]) => s === "light")) {
  const { p, ctx } = await page(on, size, scheme);
  await p.goto(`${on.base}/`);
  await p.waitForSelector("#pricing");
  await p.evaluate(() => { document.querySelectorAll(".lp-reveal").forEach((e) => e.classList.add("lp-in")); document.getElementById("pricing")?.scrollIntoView(); });
  await shot(p, `landing-pricing-${w}-${scheme}`);
  await ctx.close();
}
await browser.close();
for (const c of [off?.child, on.child].filter(Boolean)) { try { process.kill(-c.pid, "SIGTERM"); } catch { /* gone */ } }
smtp.close();
console.log(`screenshots → ${OUT}`);
process.exit(0);
