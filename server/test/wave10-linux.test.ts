import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Wave 10 on a real bot computer (Docker): long commands as background jobs (jobs.ts) and office documents
// (office.ts). Skipped where there is no container runtime or desktop image; the office part is skipped when the image
// has no LibreOffice yet (SKLUBOT_TEST_DESKTOP_IMAGE can name an image that has it).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w10l-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "auto";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.JOBS_PER_BOT = "2";
process.env.SPILL_CHARS = "20000";
process.env.JOB_POLL_SECONDS = "3600";
if (process.env.SKLUBOT_TEST_DESKTOP_IMAGE) process.env.DESKTOP_IMAGE = process.env.SKLUBOT_TEST_DESKTOP_IMAGE;
delete process.env.MAX_BOTS;

const { computerKind, initComputer, screen, workspaceOf } = await import("../src/computer.js");
await initComputer();
const linux = computerKind() === "linux";
const skip = !linux && "no container runtime or desktop image here (npm run computer:build)";
const { api } = await import("../src/routes.js");
const { bots, users } = await import("../src/store.js");
const { runCommand, jobs, jobOutput, stopJob, pollJobs, setJobWaker, setJobBlocked, parseRead, JobLimitError } = await import("../src/jobs.js");
const { officeTools, officeArgs, parseOfficeOutput } = await import("../src/office.js");
const { linuxExec } = await import("../src/linux.js");
import type { BotRecord } from "../src/store.js";

test("office arguments: a known format, a spreadsheet to recalculate, a page number; nothing goes through a shell", () => {
  const a = officeArgs("convert", { input: "~/files/a b.docx", format: "PDF" });
  assert.ok(Array.isArray(a));
  assert.deepEqual((a as string[]).slice(0, 2), ["sh", "-c"]);
  assert.deepEqual((a as string[]).slice(3), ["sh", "convert", "~/files/a b.docx", "pdf", "", "1"]);
  assert.deepEqual((officeArgs("convert", { input: "x.odt", format: "txt" }) as string[])[6], "txt:Text (encoded):UTF8");
  assert.ok("error" in (officeArgs("convert", { input: "x.odt", format: "exe" }) as object));
  assert.equal((officeArgs("recalc", { input: "b.XLSX" }) as string[])[6], "xlsx");
  assert.ok("error" in (officeArgs("recalc", { input: "notes.docx" }) as object));
  assert.equal((officeArgs("render", { input: "s.pptx", page: 3.7 }) as string[])[8], "3");
  assert.ok("error" in (officeArgs("convert", { input: "a\nb.docx", format: "pdf" }) as object));
  assert.deepEqual(parseOfficeOutput("PAGES 4\nSAVED /root/files/x-page2.png\nSIZE 1234\n"), { saved: "/root/files/x-page2.png", size: 1234, pages: 4 });
  assert.deepEqual(parseRead("0\n12\n---\nhello\nworld"), { exit: 0, size: 12, tail: "hello\nworld" });
  assert.deepEqual(parseRead("-\n0\n---\n"), { exit: null, size: 0, tail: "" });
});

let bot: BotRecord;
let cookie = "";
const call = async (method: string, url: string, body?: unknown) => {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) as any };
};
const woken: { botId: string; text: string; jobIds: string[] }[] = [];
after(async () => { if (linux && bot) await screen.reset(bot.id).catch(() => {}); });

test("setup", { skip }, async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "w10l@example.com", password: "password-1", locale: "en" })).status, 200);
  bot = bots.byId((await call("POST", "/bots", { name: "Jobs" })).json.bot.id)!;
  setJobWaker((botId, t) => { woken.push({ botId, text: t.text, jobIds: t.jobIds }); });
  setJobBlocked(() => false);
});
const ws = () => workspaceOf(bot.id);

test("a short command runs and answers as before", { skip }, async () => {
  const r = await runCommand(bot, ws(), "echo hi; echo err >&2; exit 3", 30);
  assert.equal(r.code, 3);
  assert.match(r.output, /hi\nerr/);
  assert.equal(r.job, null);
  assert.equal(r.spilled, null);
  // Only the checking command's own files are there (its pid and log; no exit file yet): the first left nothing.
  const left = await runCommand(bot, ws(), "ls ~/.sklubot/jobs | sed 's/^j[0-9a-f]*\\.//' | sort | tr '\\n' ' '", 30);
  assert.equal(left.output.trim(), "log pid", "a finished command leaves no job files");
});

test("a long output is kept whole on the computer; the model gets its end and where the rest is", { skip }, async () => {
  const r = await runCommand(bot, ws(), "seq 1 20000", 30);
  assert.equal(r.code, 0);
  assert.ok(r.size > 20_000);
  assert.ok(r.spilled?.startsWith("/root/.sklubot/outputs/"));
  assert.match(r.output, /20000\n?$/);
  const check = await runCommand(bot, ws(), `wc -l < ${r.spilled}`, 30);
  assert.equal(check.output.trim(), "20000");
});

test("a command still running at its time limit becomes a background job; its end wakes the bot once", { skip }, async () => {
  const r = await runCommand(bot, ws(), "echo started; sleep 3; echo finished-late", 1, { thread: 0, origin: "user" });
  assert.equal(r.timedOut, true);
  assert.ok(r.job, "promoted to a job");
  assert.match(r.output, /started/);
  assert.equal(jobs.byId(r.job!.id)!.status, "running");
  for (let i = 0; i < 40 && jobs.byId(r.job!.id)!.status === "running"; i++) { await new Promise((x) => setTimeout(x, 250)); await pollJobs(); }
  const j = jobs.byId(r.job!.id)!;
  assert.equal(j.status, "done");
  assert.equal(j.exitCode, 0);
  const wake = woken.filter((w) => w.jobIds.includes(j.id));
  assert.equal(wake.length, 1);
  assert.match(wake[0].text, /finished with exit code 0/);
  assert.match(wake[0].text, /finished-late/);
  await pollJobs();
  assert.equal(woken.filter((w) => w.jobIds.includes(j.id)).length, 1, "one wake per job");
});

test("background: true starts a job at once; job_output can wait for it (then no separate wake)", { skip }, async () => {
  const r = await runCommand(bot, ws(), "sleep 2; echo done-x", 30, { background: true });
  assert.ok(r.job);
  const out = await jobOutput(bot, ws(), r.job!.id, 15);
  assert.equal(out.job.status, "done");
  assert.match(out.tail, /done-x/);
  const before = woken.length;
  await pollJobs();
  assert.equal(woken.length, before, "the bot already saw it end");
});

test("job_stop stops the whole job; a bot runs at most JOBS_PER_BOT; a reset computer ends its jobs", { skip }, async () => {
  const a = await runCommand(bot, ws(), "sleep 300 & sleep 301; wait", 30, { background: true });
  const b = await runCommand(bot, ws(), "sleep 302", 30, { background: true });
  await assert.rejects(runCommand(bot, ws(), "sleep 303", 30, { background: true }), JobLimitError);
  // At the cap, a command reaching its time limit is stopped instead of promoted.
  const c = await runCommand(bot, ws(), "sleep 304", 1);
  assert.equal(c.timedOut, true);
  assert.equal(c.job, null);
  const stopped = await stopJob(bot, ws(), a.job!.id);
  assert.equal(stopped.status, "stopped");
  const ps = await runCommand(bot, ws(), "ps -eo args | grep -c '^sleep 30[0-4]$'", 30);
  assert.equal(ps.output.trim(), "1", "only job b's sleep is left: " + (await runCommand(bot, ws(), "ps -eo pid,pgid,sid,args; cat ~/.sklubot/jobs/*.pid", 30)).output);
  // The computer panel's list, and its Stop button.
  const listed = (await call("GET", `/bots/${bot.id}/jobs`)).json.jobs;
  assert.ok(listed.some((j: any) => j.id === b.job!.id && j.status === "running"));
  await screen.reset(bot.id);
  assert.equal(jobs.byId(b.job!.id)!.status, "stopped");
});

test("office: convert, recalculate a stale spreadsheet, render a page to a picture", { skip }, async (t) => {
  const has = await linuxExec(bot.id, bot.userId, ws(), ["sh", "-c", "command -v soffice && command -v pdftoppm"], 30);
  if (has.code !== 0) { t.skip("this desktop image has no LibreOffice yet (rebuild it)"); return; }
  // A sheet whose formula's stored value is stale (99 instead of 40), written in the computer.
  const make = String.raw`mkdir -p ~/files && cd ~/files && cat > t.fods <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:body><office:spreadsheet><table:table table:name="S"><table:table-row><table:table-cell office:value-type="float" office:value="20"><text:p>20</text:p></table:table-cell><table:table-cell table:formula="of:=[.A1]*2" office:value-type="float" office:value="40"><text:p>40</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document>
EOF`;
  assert.equal((await runCommand(bot, ws(), make, 30)).code, 0);
  const user = users.byId(bot.userId)!;
  const ctx = { bot, user, depth: 0, signal: new AbortController().signal };
  const tool = (name: string) => officeTools.find((x) => x.spec.name === name)!;
  const conv = await tool("office_convert").run({ input: "~/files/t.fods", format: "xlsx" }, ctx);
  assert.ok(!conv.isError, String(conv.content));
  assert.match(String(conv.content), /Saved as ~\/files\/t\.xlsx/);
  // A second conversion never overwrites: a number is added.
  assert.match(String((await tool("office_convert").run({ input: "~/files/t.fods", format: "xlsx" }, ctx)).content), /t-1\.xlsx/);
  const stale = String.raw`cd ~/files && python3 - <<'EOF'
import zipfile
src = zipfile.ZipFile("t.xlsx"); dst = zipfile.ZipFile("stale.xlsx", "w", zipfile.ZIP_DEFLATED)
for i in src.infolist():
    d = src.read(i.filename)
    if i.filename == "xl/worksheets/sheet1.xml": d = d.replace(b"<v>40</v>", b"<v>99</v>")
    dst.writestr(i, d)
dst.close()
EOF`;
  assert.equal((await runCommand(bot, ws(), stale, 30)).code, 0);
  const asIs = await tool("office_convert").run({ input: "~/files/stale.xlsx", format: "csv" }, ctx);
  assert.match(String(asIs.content), /stale\.csv/);
  assert.equal((await runCommand(bot, ws(), "cat ~/files/stale.csv", 30)).output.trim(), "20,99", "a plain conversion keeps the stale value");
  const re = await tool("office_recalculate").run({ input: "~/files/stale.xlsx" }, ctx);
  assert.match(String(re.content), /stale-recalculated\.xlsx/);
  await tool("office_convert").run({ input: "~/files/stale-recalculated.xlsx", format: "csv" }, ctx);
  assert.equal((await runCommand(bot, ws(), "cat ~/files/stale-recalculated.csv", 30)).output.trim(), "20,40", "recalculated");
  assert.equal((await runCommand(bot, ws(), "unzip -p ~/files/stale.xlsx xl/worksheets/sheet1.xml | grep -c '<v>99</v>'", 30)).output.trim(), "1", "the input is untouched");
  const shot = await tool("office_render").run({ input: "~/files/t.fods", page: 1 }, ctx);
  assert.ok(Array.isArray(shot.content), String(shot.content));
  const parts = shot.content as { type: string; mediaType?: string; data?: string; text?: string }[];
  assert.equal(parts[1].mediaType, "image/png");
  assert.ok(Buffer.from(parts[1].data!, "base64").subarray(1, 4).toString() === "PNG");
  assert.match(parts[0].text!, /Page 1 of 1/);
  const bad = await tool("office_render").run({ input: "~/files/t.fods", page: 5 }, ctx);
  assert.equal(bad.isError, true);
  assert.match(String(bad.content), /no page 5/);
  const missing = await tool("office_convert").run({ input: "~/files/nope.docx", format: "pdf" }, ctx);
  assert.match(String(missing.content), /no file at/);
});
