import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

// L44 « Nouvel appareil »: the contract's acceptance checks (e-mail through a local fake SMTP server, push kept in the bell).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-newdevice-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.ALLOW_PRIVATE_FETCH = "1";
for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "OPEN_SIGNUP", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const inbox: { to: string[]; subject: string; text: string }[] = [];
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ["STARTTLS", "AUTH"], logger: false, disableReverseLookup: true,
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", async () => { const p = await simpleParser(Buffer.concat(chunks)); inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), subject: p.subject ?? "", text: p.text ?? "" }); cb(); });
  },
});
const smtpPort: number = await new Promise((r) => { const s = smtp.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)); });
after(() => new Promise<void>((r) => smtp.close(() => r())));
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort), SMTP_TLS: "none", SMTP_FROM: "sklubot@example.test" });

const { api, site } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users, sha256 } = await import("../src/store.js");
const { deviceFamily, familyText, ALERTS_PER_HOUR } = await import("../src/newdevice.js");

const ORIGIN = "https://bots.example.test";
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const cookieOf = (set: string[], name: string) => set.map((s) => s.split(";")[0]).find((s) => s.startsWith(`${name}=`));
async function call(method: string, url: string, o: { body?: unknown; cookie?: string; ua?: string; origin?: string } = {}) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: o.cookie ?? "", origin: o.origin ?? ORIGIN, host: "bots.example.test", "user-agent": o.ua ?? CHROME_WIN }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const set = res.headers.getSetCookie();
  return { status: res.status, json: (await res.json().catch(() => null)) as any, session: cookieOf(set, "sklubot_session"), device: cookieOf(set, "sklubot_device") };
}
const login = (o: { cookie?: string; ua?: string } = {}) => call("POST", "/auth/login", { body: { email: "lea@example.com", password: "motdepasse1" }, ...o });
const waitMail = async (n: number) => { for (let i = 0; i < 100 && inbox.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };
const alerts = () => q.all<{ id: string; notified: number; denied_at: number | null; session_hash: string }>("SELECT * FROM sign_in_alerts ORDER BY at");

const signup = await call("POST", "/auth/signup", { body: { email: "lea@example.com", name: "Léa", password: "motdepasse1", locale: "fr" } });
assert.equal(signup.status, 200);
const lea = users.byEmail("lea@example.com")!;
const homeDevice = signup.device!;

test("device family is coarse (browser + system only)", () => {
  assert.equal(deviceFamily(CHROME_WIN), "Chrome|Windows");
  assert.equal(deviceFamily(SAFARI_IOS), "Safari|iOS");
  assert.equal(deviceFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"), "Safari|macOS");
  assert.equal(deviceFamily("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0"), "Firefox|Linux");
  assert.equal(deviceFamily("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge|Windows");
  assert.equal(deviceFamily(undefined), "|");
  assert.equal(familyText("fr", "Chrome|Windows"), "Chrome sur Windows");
  assert.equal(familyText("en", "|"), "an unknown browser on an unknown system");
});

test("the sign-up only remembers its device (random, httpOnly cookie); signing in again from it says nothing", async () => {
  assert.match(homeDevice, /^sklubot_device=[A-Za-z0-9_-]{43}$/);
  const row = q.get<{ device_hash: string; family: string }>("SELECT * FROM known_devices WHERE user_id = ?", lea.id)!;
  assert.equal(row.device_hash, sha256(`device:${homeDevice.split("=")[1]}`), "only a hash is kept");
  assert.equal(row.family, "Chrome|Windows");
  const again = await login({ cookie: homeDevice });
  assert.equal(again.status, 200);
  assert.equal(alerts().length, 0);
  assert.equal(inbox.length, 0);
});

test("a new device: e-mail and notification with time, browser/system, how, and a « Ce n'est pas moi » link", async () => {
  const phone = await login({ ua: SAFARI_IOS });
  assert.equal(phone.status, 200);
  assert.ok(phone.device && phone.device !== homeDevice);
  assert.equal(alerts().length, 1);
  await waitMail(1);
  assert.equal(inbox.length, 1);
  const mail = inbox[0]!;
  assert.deepEqual(mail.to, ["lea@example.com"]);
  assert.match(mail.subject, /Nouvelle connexion : Safari sur iOS/);
  assert.match(mail.text, /Quand : .+\(UTC\)/);
  assert.match(mail.text, /Navigateur et système : Safari sur iOS/);
  assert.match(mail.text, /Comment : mot de passe/);
  assert.match(mail.text, /https:\/\/bots\.example\.test\/securite\/pas-moi\?t=[A-Za-z0-9_-]{43}/);
  assert.doesNotMatch(mail.text, /\d+\.\d+\.\d+\.\d+/, "no IP address, no place");
  const bell = q.all<{ kind: string; title: string }>("SELECT kind, title FROM notify_log WHERE user_id = ?", lea.id);
  assert.ok(bell.some((b) => b.kind === "security" && /Safari sur iOS/.test(b.title)), "kept in the bell (no push device here)");
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE 'Signed in from a new device%'", lea.id));
  // The same phone again: known now.
  await login({ cookie: phone.device!, ua: SAFARI_IOS });
  assert.equal(alerts().length, 1);
});

test("« Ce n'est pas moi » from the e-mail: the page only shows a button; the button ends that session and forgets the device", async () => {
  const token = /pas-moi\?t=([A-Za-z0-9_-]+)/.exec(inbox[0]!.text)![1]!;
  const phoneSession = alerts()[0]!.session_hash;
  assert.ok(q.get("SELECT 1 FROM sessions WHERE token_hash = ?", phoneSession));
  const pageRes = await site.request(`/securite/pas-moi?t=${token}`);
  const html = await pageRes.text();
  assert.equal(pageRes.status, 200);
  assert.match(html, /C&#39;est bien toi/);
  assert.match(html, /<form method="post" action="\/api\/auth\/not-me">/);
  assert.ok(q.get("SELECT 1 FROM sessions WHERE token_hash = ?", phoneSession), "opening the link changes nothing");
  // From another site: refused.
  const cross = await api.request("/auth/not-me", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", host: "bots.example.test" }, body: `t=${token}` });
  assert.equal(cross.status, 403);
  const res = await api.request("/auth/not-me", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, host: "bots.example.test" }, body: `t=${token}` });
  const done = await res.text();
  assert.equal(res.status, 200);
  assert.match(done, /cette connexion est fermée/);
  assert.match(done, /change/i);
  assert.equal(q.get("SELECT 1 FROM sessions WHERE token_hash = ?", phoneSession), undefined, "that session is gone");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM known_devices WHERE user_id = ?", lea.id)!.n, 1, "the phone is forgotten");
  assert.ok(alerts()[0]!.denied_at);
  // Once only.
  const again = await api.request("/auth/not-me", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test" }, body: JSON.stringify({ t: token }) });
  assert.equal(again.status, 410);
  assert.equal((await site.request(`/securite/pas-moi?t=${token}`)).status, 410);
});

test("in the app: the list of new-device sign-ins, and « Ce n'est pas moi » for one of them (not this device)", async () => {
  const home = await login({ cookie: homeDevice });
  const laptop = await login({ ua: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0" });
  const list = await call("GET", "/account/sign-ins", { cookie: home.session });
  assert.equal(list.status, 200);
  const item = list.json.signIns[0];
  assert.deepEqual([item.family, item.via, item.active, item.current], ["Firefox sur Linux", "mot de passe", true, false]);
  // Someone else cannot see or end them.
  const fromLaptop = await call("POST", `/account/sign-ins/${item.id}/not-me`, { cookie: laptop.session });
  assert.equal(fromLaptop.status, 409, "the device you are using now");
  const done = await call("POST", `/account/sign-ins/${item.id}/not-me`, { cookie: home.session });
  assert.equal(done.status, 200);
  assert.equal(done.json.changePassword, true);
  assert.equal((await call("GET", "/me", { cookie: laptop.session })).json.user, null, "the laptop is signed out");
  assert.equal((await call("POST", "/account/sign-ins/sia_unknown/not-me", { cookie: home.session })).status, 404);
});

test("rate limit: at most 5 alerts an hour; more are listed and audited without a message", async () => {
  const before = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sign_in_alerts WHERE notified = 1")!.n;
  for (let i = 0; i < ALERTS_PER_HOUR + 2; i++) await login({ ua: `Mozilla/5.0 (Windows NT 10.0) Firefox/${100 + i}.0` });
  const notified = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sign_in_alerts WHERE notified = 1 AND at > ?", Date.now() - 3600_000)!.n;
  assert.equal(notified, ALERTS_PER_HOUR);
  assert.ok(before < ALERTS_PER_HOUR);
  assert.ok(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sign_in_alerts WHERE notified = 0")!.n >= 2);
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE '%alert not sent%'", lea.id));
});

test("works for every way in: the passkey and Google go through the same place (twofactor.ts openSession)", async () => {
  const { openSession } = await import("../src/twofactor.js");
  const { Hono } = await import("hono");
  const app = new Hono();
  app.get("/x", (c) => { openSession(c, lea.id, "Google"); return c.text("ok"); });
  q.run("DELETE FROM sign_in_alerts");
  await app.request("/x", { headers: { "user-agent": SAFARI_IOS } });
  const row = q.get<{ via: string; family: string }>("SELECT via, family FROM sign_in_alerts")!;
  assert.deepEqual([row.via, row.family], ["Google", "Safari|iOS"]);
});

test("no alert while the account's address is not confirmed yet (no mail to an unproven address); once confirmed, alerts work", async () => {
  const { hashPassword } = await import("../src/auth.js");
  const id = users.create("held@example.com", "Held", hashPassword("motdepasse1"), "fr").id;
  q.run("UPDATE users SET email_verify_pending = 1 WHERE id = ?", id); // what a public sign-up does (publicsignup.ts accountOpened)
  const signIn = (ua: string) => call("POST", "/auth/login", { body: { email: "held@example.com", password: "motdepasse1" }, ua });
  assert.equal((await signIn(CHROME_WIN)).status, 200); // its first device: remembered
  assert.equal((await signIn(SAFARI_IOS)).status, 200); // another one, while the address is unconfirmed
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sign_in_alerts WHERE user_id = ?", id)!.n, 0);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM known_devices WHERE user_id = ?", id)!.n, 2, "the device is still remembered");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(inbox.filter((m) => m.to.includes("held@example.com")).length, 0);
  q.run("UPDATE users SET email_verify_pending = 0 WHERE id = ?", id);
  assert.equal((await signIn("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0")).status, 200);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sign_in_alerts WHERE user_id = ? AND notified = 1", id)!.n, 1);
});
