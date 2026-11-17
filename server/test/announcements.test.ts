import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Annonces » (announcements.ts): who may write (the owner; in hosted mode, the operators too), who reads (everyone, a
// plan, a workspace's members, named accounts), dates (scheduled, ended), each reader's state (seen, dismissed, an
// important one counted until read), push and e-mail sent once (switches, quiet hours, e-mail choice, no SMTP), and the
// plain-text rules (no HTML, https links only).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-announce-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "anon:anon-1";
delete process.env.HOSTED_MODE;
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "MAX_BOTS", "SMTP_HOST", "SMTP_FROM", "SMTP_USER"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { SESSION_COOKIE } = await import("../src/auth.js");
const ann = await import("../src/announcements.js");
const { linkify, safeHttpsUrl, ANNOUNCE_LIMITS } = await import("../src/announcetext.js");
const { subscriptions } = await import("../src/hosted.js");
const { savePushSettings, pushSettings } = await import("../src/push.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { AnnounceSender } from "../src/announcements.js";

registerProvider({
  id: "anon", label: "Anon", models: ["anon-1"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> { return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "anon-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});

const ORIGIN = process.env.PUBLIC_URL!;
type Who = "owner" | "op" | "ann" | "bob" | "cleo";
const jars: Record<Who, string> = { owner: "", op: "", ann: "", bob: "", cleo: "" };
const ids: Record<Who, string> = { owner: "", op: "", ann: "", bob: "", cleo: "" };
async function call(who: Who, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && set.startsWith(`${SESSION_COOKIE}=`)) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const H = 3_600_000;
const D = 24 * H;
const draft = (patch: Record<string, unknown> = {}) => ({ kind: "info", title: "Hello testers", body: "First line\nSecond line", audience: { type: "everyone" }, ...patch });
/** Direct calls get times an hour apart, so the per-author write limit (per hour) never gets in the way. */
let clock = Date.now();
const tick = () => (clock += H);

test("setup: five accounts (the first is the owner) and a workspace with two members", async () => {
  for (const who of ["owner", "op", "ann", "bob", "cleo"] as const) {
    const r = await call(who, "POST", "/auth/signup", { email: `${who}@example.com`, name: who, password: "password123", acceptTerms: true });
    assert.equal(r.status, 200, r.text);
    ids[who] = r.json.user.id;
  }
  const t = Date.now();
  q.run("INSERT INTO workspaces (id, name, owner_id, created_at) VALUES ('ws_beta', 'Beta testers', ?, ?)", ids.owner, t);
  for (const who of ["ann", "bob"] as const) q.run("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('ws_beta', ?, 'member', ?)", ids[who], t);
});

test("authors: only the owner may write (404 for anyone else); in hosted mode the operators too, never a customer", async () => {
  for (const who of ["op", "ann"] as const) {
    assert.equal((await call(who, "GET", "/announcements-admin")).status, 404);
    assert.equal((await call(who, "POST", "/announcements-admin", draft())).status, 404);
    assert.equal((await call(who, "POST", "/announcements-admin/preview", draft())).status, 404);
    assert.equal((await call(who, "GET", "/announcements")).json.canAuthor, false);
  }
  assert.equal((await call("owner", "GET", "/announcements")).json.canAuthor, true);
  const made = await call("owner", "POST", "/announcements-admin", draft({ title: "Welcome" }));
  assert.equal(made.status, 200, made.text);
  assert.ok(made.json.items.some((i: any) => i.id === made.json.id && i.status === "live" && i.authorName === "owner"));
  // The log and the account's audit.
  assert.equal(made.json.log[0].action, "create");
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE 'Announcement published: Welcome'", ids.owner));
  // Hosted mode: "op" becomes an operator and may write; "ann", a customer, still may not.
  process.env.HOSTED_MODE = "1";
  try {
    q.run("UPDATE users SET server_role = 'operator' WHERE id = ?", ids.op);
    assert.equal((await call("op", "GET", "/announcements-admin")).status, 200);
    const byOp = await call("op", "POST", "/announcements-admin", draft({ title: "From the operator", audience: { type: "accounts", emails: ["op@example.com"] } }));
    assert.equal(byOp.status, 200, byOp.text);
    assert.equal((await call("ann", "GET", "/announcements-admin")).status, 404);
    assert.equal((await call("ann", "PUT", `/announcements-admin/${byOp.json.id}`, draft())).status, 404);
    assert.equal((await call("ann", "POST", `/announcements-admin/${byOp.json.id}/archive`, {})).status, 404);
    assert.ok(q.get("SELECT 1 FROM admin_audit WHERE action = 'announcement.create' AND detail = 'From the operator'"), "hosted: in the administration log too");
    assert.equal((await call("op", "POST", `/announcements-admin/${byOp.json.id}/archive`, {})).status, 200);
  } finally {
    delete process.env.HOSTED_MODE;
    q.run("UPDATE users SET server_role = '' WHERE id = ?", ids.op);
  }
  // Out of hosted mode, the former operator is a reader again.
  assert.equal((await call("op", "GET", "/announcements-admin")).status, 404);
  ann.archiveAnnouncement(ids.owner, made.json.id, tick());
});

test("plain text only: HTML is refused, links must be https, invisible characters are removed", () => {
  const bad = (patch: Record<string, unknown>, re: RegExp) => assert.throws(() => ann.cleanAnnouncement(draft(patch), clock), (e: any) => e instanceof ann.AnnounceError && e.status === 400 && re.test(e.message));
  bad({ body: "Hi <script>alert(1)</script>" }, /HTML/);
  bad({ title: "<img src=x onerror=alert(1)>" }, /HTML/);
  bad({ linkUrl: "https://ok.example", linkLabel: "<b>Go</b>" }, /HTML/);
  bad({ linkUrl: "javascript:alert(1)" }, /https/);
  bad({ linkUrl: "data:text/html,<script>alert(1)</script>" }, /https/);
  bad({ linkUrl: "http://plain.example" }, /https/);
  bad({ linkUrl: "https://user:pw@evil.example" }, /https/);
  bad({ linkUrl: "//evil.example" }, /https/);
  bad({ kind: "sponsor" }, /kind/);
  bad({ title: "" }, /title/);
  bad({ title: "x".repeat(ANNOUNCE_LIMITS.title + 1) }, /title is at most/);
  bad({ body: "x".repeat(ANNOUNCE_LIMITS.body + 1) }, /text is at most \{n\} characters/);
  bad({ body: Array(ANNOUNCE_LIMITS.bodyLines + 1).fill("a").join("\n") }, /lines/);
  bad({ email: true }, /SMTP/);
  const ok = ann.cleanAnnouncement(draft({ title: "  Two\nlines‮  ", body: "a\r\n\r\n\r\n\r\nb\u0007", linkUrl: " https://example.com/notes?x=1 ", linkLabel: "Read" }), clock);
  assert.equal(ok.title, "Two lines");
  assert.equal(ok.body, "a\n\nb");
  assert.equal(ok.linkUrl, "https://example.com/notes?x=1");
  // A link label without a link is dropped; a site banner only for a maintenance.
  assert.equal(ann.cleanAnnouncement(draft({ linkLabel: "Orphan", siteBanner: true }), clock).linkLabel, "");
  assert.equal(ann.cleanAnnouncement(draft({ siteBanner: true }), clock).siteBanner, false);
  assert.equal(ann.cleanAnnouncement(draft({ kind: "maintenance", siteBanner: true }), clock).siteBanner, true);
  // The body's links: https only, through the URL constructor, the end of the sentence kept as text.
  assert.deepEqual(linkify("See https://example.com/a. Not javascript:alert(1) nor http://x.example or data:text/html,hi"), [
    { text: "See " }, { text: "https://example.com/a", url: "https://example.com/a" }, { text: ". Not javascript:alert(1) nor http://x.example or data:text/html,hi" },
  ]);
  assert.equal(safeHttpsUrl("https://exa mple.com"), null);
  assert.equal(safeHttpsUrl("JAVASCRIPT:alert(1)"), null);
  // The route says it in the author's language, and saves nothing.
  return call("owner", "POST", "/announcements-admin", draft({ linkUrl: "javascript:alert(1)" })).then(async (r) => {
    assert.equal(r.status, 400);
    assert.match(r.json.error, /https/);
    assert.equal((await call("owner", "POST", "/announcements-admin", draft({ body: "<script>x</script>" }))).status, 400);
    assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements WHERE body LIKE '%script%' OR link_url LIKE 'javascript%'")!.n, 0);
  });
});

test("audience: everyone, a workspace's members, named accounts, a plan (hosted mode only)", async () => {
  const seenBy = (id: string) => (["owner", "op", "ann", "bob", "cleo"] as const).filter((w) => ann.readerState(ids[w], clock).items.some((i) => i.id === id));
  const all = ann.createAnnouncement(ids.owner, draft({ title: "To all" }), tick());
  assert.deepEqual(seenBy(all.id), ["owner", "op", "ann", "bob", "cleo"]);
  const ws = ann.createAnnouncement(ids.owner, draft({ title: "To the beta", audience: { type: "workspace", workspaceId: "ws_beta" } }), tick());
  assert.deepEqual(seenBy(ws.id), ["owner", "ann", "bob"], "the workspace's owner and its members");
  const named = ann.createAnnouncement(ids.owner, draft({ title: "To Cleo", audience: { type: "accounts", emails: "CLEO@example.com, op@example.com" } }), tick());
  assert.deepEqual(seenBy(named.id), ["op", "cleo"]);
  assert.throws(() => ann.cleanAnnouncement(draft({ audience: { type: "accounts", emails: ["nobody@example.com"] } }), clock), /No account uses/);
  assert.throws(() => ann.cleanAnnouncement(draft({ audience: { type: "workspace", workspaceId: "ws_nope" } }), clock), /workspace/);
  assert.throws(() => ann.cleanAnnouncement(draft({ audience: { type: "plan", planId: "free" } }), clock), /hosted/);
  // Hosted mode: Bob on "included", Ann and Cleo on "free".
  process.env.HOSTED_MODE = "1";
  try {
    subscriptions.start(ids.bob, "included");
    subscriptions.start(ids.ann, "free");
    subscriptions.start(ids.cleo, "free");
    assert.throws(() => ann.cleanAnnouncement(draft({ audience: { type: "plan", planId: "gold" } }), clock), /plan/);
    const plan = ann.createAnnouncement(ids.owner, draft({ title: "To the free plan", audience: { type: "plan", planId: "free" } }), tick());
    assert.deepEqual(seenBy(plan.id), ["ann", "cleo"]);
    assert.equal(ann.previewAnnouncement(draft({ audience: { type: "plan", planId: "included" } }), clock).recipients, 1);
    const admin = ann.adminState(ids.owner, clock);
    assert.ok(admin.plans?.some((p) => p.id === "free"));
    assert.equal(admin.items.find((i) => i.id === plan.id)!.recipients, 2);
    ann.archiveAnnouncement(ids.owner, plan.id, tick());
  } finally { delete process.env.HOSTED_MODE; }
  assert.equal(ann.adminState(ids.owner, clock).plans, null, "no plans outside hosted mode");
  // The preview counts without saving.
  const before = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements")!.n;
  const pre = await call("owner", "POST", "/announcements-admin/preview", draft({ audience: { type: "workspace", workspaceId: "ws_beta" } }));
  assert.equal(pre.status, 200, pre.text);
  assert.equal(pre.json.recipients, 3);
  assert.equal(pre.json.view.title, "Hello testers");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements")!.n, before);
  for (const r of [all, ws, named]) ann.archiveAnnouncement(ids.owner, r.id, tick());
  assert.deepEqual(seenBy(all.id), [], "archived: nobody sees it");
});

test("dates: a scheduled one shows at its start, an ended one no more; bad dates are refused", () => {
  const t = tick();
  const later = ann.createAnnouncement(ids.owner, draft({ title: "Tomorrow", startsAt: t + D, endsAt: t + 2 * D }), t);
  assert.equal(ann.readerState(ids.ann, t).items.some((i) => i.id === later.id), false);
  assert.equal(ann.adminState(ids.owner, t).items.find((i) => i.id === later.id)!.status, "scheduled");
  assert.equal(ann.readerState(ids.ann, t + D + 1).items.some((i) => i.id === later.id), true);
  assert.equal(ann.readerState(ids.ann, t + 2 * D).items.some((i) => i.id === later.id), false);
  assert.equal(ann.adminState(ids.owner, t + 2 * D).items.find((i) => i.id === later.id)!.status, "ended");
  assert.throws(() => ann.cleanAnnouncement(draft({ startsAt: t - 3 * D }), t), /already past/);
  assert.throws(() => ann.cleanAnnouncement(draft({ startsAt: t + 400 * D }), t), /more than a year/);
  assert.throws(() => ann.cleanAnnouncement(draft({ startsAt: t + H, endsAt: t }), t), /after the start/);
  assert.throws(() => ann.cleanAnnouncement(draft({ endsAt: t + 400 * D }), t), /at most a year/);
  assert.throws(() => ann.cleanAnnouncement(draft({ startsAt: "tomorrow" }), t), /dates/);
  // An edit keeps a start that is already past.
  const live = ann.createAnnouncement(ids.owner, draft({ title: "Old start" }), t - 2 * D + 1000);
  const edited = ann.updateAnnouncement(ids.owner, live.id, draft({ title: "Old start, new words", startsAt: live.starts_at }), tick());
  assert.equal(edited.starts_at, live.starts_at);
  assert.equal(edited.title, "Old start, new words");
  for (const r of [later, live]) ann.archiveAnnouncement(ids.owner, r.id, tick());
  assert.throws(() => ann.updateAnnouncement(ids.owner, live.id, draft(), tick()), /archived/);
});

test("each reader's state: seen in the bell, closed per reader, an important one counted until 'J'ai lu', the maintenance band", async () => {
  // Created "now" (real time): the routes below read the clock.
  const t = Date.now();
  const info = ann.createAnnouncement(ids.owner, draft({ title: "Tip" }), t);
  const imp = ann.createAnnouncement(ids.owner, draft({ kind: "important", title: "Read me" }), t);
  const maint = ann.createAnnouncement(ids.owner, draft({ kind: "maintenance", title: "Down tonight", siteBanner: true }), t);
  const s0 = ann.readerState(ids.ann, t);
  assert.equal(s0.items[0].id, imp.id, "the important one first");
  assert.equal(s0.unread, 3);
  assert.equal(s0.site?.id, maint.id);
  // The bell is opened: the important one still counts.
  let r = await call("ann", "POST", "/announcements/seen", { ids: [info.id, imp.id, maint.id, "ann_unknown"] });
  assert.equal(r.status, 200);
  assert.equal(r.json.unread, 1);
  assert.deepEqual(r.json.items.filter((i: any) => i.unread).map((i: any) => i.id), [imp.id]);
  // Closing is per reader.
  r = await call("ann", "POST", `/announcements/${imp.id}/dismiss`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.unread, 0);
  assert.ok(!r.json.items.some((i: any) => i.id === imp.id));
  r = await call("ann", "POST", `/announcements/${maint.id}/dismiss`, {});
  assert.equal(r.json.site, null, "the band is closed for Ann");
  assert.equal(ann.readerState(ids.bob, t).unread, 3, "Bob still has all three");
  assert.equal(ann.readerState(ids.bob, t).site?.id, maint.id);
  // Not up, unknown, or not for you: 404, the same answer.
  assert.equal((await call("ann", "POST", "/announcements/ann_nope/dismiss", {})).status, 404);
  const mine = ann.createAnnouncement(ids.owner, draft({ title: "Cleo only", audience: { type: "accounts", emails: ["cleo@example.com"] } }), Date.now());
  assert.equal((await call("ann", "POST", `/announcements/${mine.id}/dismiss`, {})).status, 404);
  assert.equal(ann.adminState(ids.owner, clock).items.find((i) => i.id === imp.id)!.dismissed, 1);
  // The e-mail choice.
  assert.equal((await call("ann", "GET", "/announcements")).json.emailOptIn, true);
  assert.equal((await call("ann", "PUT", "/announcements/prefs", { email: false })).json.emailOptIn, false);
  assert.equal((await call("ann", "PUT", "/announcements/prefs", { email: "no" })).status, 400);
  for (const x of [info, imp, maint, mine]) ann.archiveAnnouncement(ids.owner, x.id, tick());
});

test("push and e-mail: once per reader and channel; switches, quiet hours, e-mail choice and SMTP respected", async () => {
  // Ann's e-mail choice is off (previous test); Bob is in his quiet hours; Cleo switched announcement pushes off.
  const t0 = Date.now();
  for (const who of ["owner", "op", "ann", "bob", "cleo"] as const) q.run("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_enc, label, created_at) VALUES (?, ?, ?, 'k', 'a', 'Phone', ?)", `psh_${who}`, ids[who], `https://push.example.com/${who}`, t0);
  // Bob's quiet hours: from an hour before the first pass to an hour after it (UTC).
  const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  savePushSettings(ids.bob, { ...pushSettings(ids.bob), quiet: { enabled: true, start: hm(clock), end: hm(clock + 3 * H), timezone: "UTC" } });
  savePushSettings(ids.cleo, { ...pushSettings(ids.cleo), kinds: { ...pushSettings(ids.cleo).kinds, announce: false } });
  const pushes: string[] = [];
  const mails: { to: string; subject: string; text: string }[] = [];
  let mailReady = true;
  const send: AnnounceSender = {
    push: async (userId) => { pushes.push(userId); return 1; },
    mail: async (to, subject, text) => { mails.push({ to, subject, text }); },
    mailReady: () => mailReady,
  };
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_FROM = "bot@example.test";
  try {
    const t = tick();
    const a = ann.createAnnouncement(ids.owner, draft({ kind: "new", title: "New voices", body: "Try them: https://example.com/voices", linkUrl: "https://example.com/voices", linkLabel: "See", push: true, email: true }), t);
    const first = await ann.dispatchAnnouncements(t, send, "https://bots.example.test");
    const by = (ch: string, st: string) => first.filter((s) => s.channel === ch && s.status === st).map((s) => s.userId).sort();
    assert.deepEqual(by("push", "sent"), [ids.owner, ids.op, ids.ann].sort());
    assert.deepEqual(by("push", "skipped"), [ids.cleo], "Cleo switched announcement pushes off");
    assert.deepEqual(by("email", "sent"), [ids.owner, ids.op, ids.cleo].sort(), "the push switch does not stop Cleo's e-mail");
    assert.deepEqual(by("email", "skipped"), [ids.ann], "Ann chose no e-mails");
    assert.ok(!first.some((s) => s.userId === ids.bob), "Bob is in his quiet hours: nothing yet");
    const m = mails.find((x) => x.to === "owner@example.com")!;
    assert.match(m.subject, /^\[Sklubot\] New · New voices$/);
    assert.match(m.text, /Try them: https:\/\/example\.com\/voices/);
    assert.match(m.text, /See: https:\/\/example\.com\/voices/);
    assert.match(m.text, /https:\/\/bots\.example\.test\/\?view=today/);
    // A second pass sends nothing again.
    assert.deepEqual(await ann.dispatchAnnouncements(t + 60_000, send), []);
    // Bob's quiet hours end: he gets it then, once.
    savePushSettings(ids.bob, { ...pushSettings(ids.bob), quiet: { ...pushSettings(ids.bob).quiet, enabled: false } });
    const later = await ann.dispatchAnnouncements(t + 120_000, send);
    assert.deepEqual(later.map((s) => `${s.channel}:${s.status}`).sort(), ["email:sent", "push:sent"]);
    assert.ok(later.every((s) => s.userId === ids.bob));
    assert.deepEqual(await ann.dispatchAnnouncements(t + 180_000, send), []);
    assert.equal(pushes.length, 4);
    assert.equal(pushes.filter((u) => u === ids.bob).length, 1);
    // Editing it does not send it again.
    ann.updateAnnouncement(ids.owner, a.id, draft({ kind: "new", title: "New voices (fixed)", push: true, email: true }), tick());
    assert.deepEqual(await ann.dispatchAnnouncements(clock, send), []);
    const item = ann.adminState(ids.owner, clock).items.find((i) => i.id === a.id)!;
    assert.deepEqual(item.sent, { push: 4, email: 4, skipped: 2 });
    // Without SMTP, no e-mail at all (and nothing recorded for e-mail, so nothing is lost if it comes back).
    mailReady = false;
    const b = ann.createAnnouncement(ids.owner, draft({ title: "Push only now", push: true, email: true }), tick());
    const res = await ann.dispatchAnnouncements(clock, send);
    assert.ok(res.length > 0 && res.every((s) => s.channel === "push" && s.id === b.id));
    // A reader who already closed it gets no notification.
    const c = ann.createAnnouncement(ids.owner, draft({ title: "Closed first", push: true, audience: { type: "accounts", emails: ["op@example.com"] } }), tick());
    ann.dismiss(ids.op, c.id, clock);
    assert.deepEqual(await ann.dispatchAnnouncements(clock, send), []);
    // At most ANNOUNCE_LIMITS.notifiedPerDay announcements with a notification in 24 hours.
    for (const x of [a, b, c]) ann.archiveAnnouncement(ids.owner, x.id, tick());
    const w = tick();
    let made = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements WHERE (push = 1 OR email = 1) AND created_at > ?", w - D)!.n;
    for (let i = 0; made < ANNOUNCE_LIMITS.notifiedPerDay; i++, made++) ann.archiveAnnouncement(ids.owner, ann.createAnnouncement(ids.owner, draft({ push: true }), w + i).id, w + i);
    assert.throws(() => ann.createAnnouncement(ids.owner, draft({ push: true }), w + 100), (e: any) => e.status === 429 && /notification in 24 hours/.test(e.message));
    assert.ok(ann.createAnnouncement(ids.owner, draft({ title: "Silent is fine" }), w + 101).id);
  } finally {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
  }
});

test("a scheduled announcement is announced to the apps when it starts (once), and the per-author write limit holds", async () => {
  const t = tick();
  const later = ann.createAnnouncement(ids.owner, draft({ title: "At noon", startsAt: t + H }), t);
  assert.equal(later.live_at, null);
  const send: AnnounceSender = { push: async () => 1, mail: async () => {}, mailReady: () => false };
  await ann.dispatchAnnouncements(t + H + 1, send);
  assert.equal(q.get<{ live_at: number }>("SELECT live_at FROM announcements WHERE id = ?", later.id)!.live_at, t + H + 1);
  // 30 writes an hour per author, then 429 (the route answers in the author's language).
  const w = tick();
  let refused = 0;
  for (let i = 0; i < ANNOUNCE_LIMITS.writesPerHour + 2; i++) {
    try { ann.archiveAnnouncement(ids.owner, ann.createAnnouncement(ids.owner, draft({ title: `n${i}` }), w + i).id, w + i); } catch (e: any) { if (e.status === 429) refused++; else throw e; }
  }
  assert.ok(refused > 0);
});
