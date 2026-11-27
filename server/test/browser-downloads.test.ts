import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// DS-Bot item 10 (browser-downloads.ts, tools-browser.ts browser_download): downloads are held outside the bot's files
// until the user approves saving that file from that site. The watcher's Python is run here on its own (fake events,
// temporary folders); the tools run with the computer replaced by fakes.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-downloads-"));
process.env.SESSION_SECRET = "downloads-secret-downloads-secret-12";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

const { DOWNLOADS_WATCH_PY } = await import("../src/browser-downloads.js");
const { BROWSER_PY } = await import("../src/browser-cdp.js");
const { bindCall, probe } = await import("../src/agent/bind.js");
const { browserDownloadTools } = await import("../src/agent/tools-browser.js");
const { linuxScreen } = await import("../src/linux.js");

test("the watcher's held downloads: events, 200 MB cap, clean unique names, release into files/downloads, discard, 1 hour", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-dl-py-"));
  const script = `import os, time, json
sent = []
def send(m, p=None, s=None):
    sent.append([m, p])
${DOWNLOADS_WATCH_PY}
HELD = ${JSON.stringify(path.join(dir, "held"))}
FILES_DL = ${JSON.stringify(path.join(dir, "files", "downloads"))}
os.makedirs(HELD, exist_ok=True)
out = {}
dl_event("Browser.downloadWillBegin", {"guid": "aaaaaaaa-1111", "url": "https://shop.example/f.pdf", "suggestedFilename": "../../etc/fac<tu>re.pdf"})
open(os.path.join(HELD, "aaaaaaaa-1111"), "w").write("pdf")
out["early"] = dl_op({"op": "release", "id": "aaaaaaaa"})
dl_event("Browser.downloadProgress", {"guid": "aaaaaaaa-1111", "receivedBytes": 3, "state": "completed"})
out["list"] = dl_op({"op": "downloads"})
out["saved"] = dl_op({"op": "release", "id": "aaaaaaaa"})
dl_event("Browser.downloadWillBegin", {"guid": "bbbbbbbb-2222", "url": "https://shop.example/f.pdf", "suggestedFilename": "fac<tu>re.pdf"})
open(os.path.join(HELD, "bbbbbbbb-2222"), "w").write("pdf2")
dl_event("Browser.downloadProgress", {"guid": "bbbbbbbb-2222", "receivedBytes": 4, "state": "completed"})
out["second"] = dl_op({"op": "release", "id": "bbbbbbbb"})
dl_event("Browser.downloadWillBegin", {"guid": "cccccccc-3333", "url": "https://big.example/x.iso", "suggestedFilename": "x.iso"})
dl_event("Browser.downloadProgress", {"guid": "cccccccc-3333", "receivedBytes": 300 * 1024 * 1024, "state": "inProgress"})
out["cancel"] = [s for s in sent if s[0] == "Browser.cancelDownload"]
out["big"] = dl_op({"op": "release", "id": "cccccccc"})
dl_event("Browser.downloadWillBegin", {"guid": "dddddddd-4444", "url": "https://a.example/y", "suggestedFilename": ".."})
open(os.path.join(HELD, "dddddddd-4444"), "w").write("y")
out["discard"] = dl_op({"op": "discard", "id": "dddddddd"})
out["gone"] = os.path.exists(os.path.join(HELD, "dddddddd-4444"))
dl_event("Browser.downloadWillBegin", {"guid": "eeeeeeee-5555", "url": "https://a.example/z", "suggestedFilename": "z"})
downloads["eeeeeeee-5555"]["at"] -= 3601
out["old"] = dl_op({"op": "downloads"})
dl_event("Browser.downloadWillBegin", {"guid": "../evil", "url": "x", "suggestedFilename": "x"})
out["evil"] = "../evil" in downloads
out["name_dots"] = dl_name("..")
print(json.dumps(out))
`;
  const r = spawnSync("python3", ["-I", "-c", script], { encoding: "utf8", cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.match(o.early.error, /has not finished/);
  assert.deepEqual(o.list.downloads.map((d: any) => [d.id, d.state, d.size]), [["aaaaaaaa", "completed", 3]]);
  assert.equal(o.saved.ok, true);
  assert.equal(o.saved.path, "downloads/fac_tu_re.pdf", "only the last path part, unsafe characters replaced");
  assert.ok(existsSync(path.join(dir, "files", o.saved.path)), "moved into files/downloads");
  assert.equal(o.second.path, "downloads/fac_tu_re (2).pdf", "never written over an existing file");
  assert.equal(o.cancel.length, 1, "over 200 MB: cancelled");
  assert.match(o.big.error, /over 200 MB/);
  assert.equal(o.discard.ok, true);
  assert.equal(o.gone, false);
  assert.deepEqual(o.old.downloads.map((d: any) => d.id), ["cccccccc"], "kept 1 hour: the old one is gone, the cancelled one still listed");
  assert.equal(o.evil, false, "a guid that is a path is ignored");
  assert.equal(o.name_dots, "download");
});

test("the helper sets the download behaviour in the watcher and relays the requests", () => {
  assert.match(BROWSER_PY, /Browser\.setDownloadBehavior", \{"behavior": "allowAndName", "downloadPath": HELD, "eventsEnabled": True\}/);
  assert.match(BROWSER_PY, /"downloads": op_downloads, "download": op_download/);
  assert.match(BROWSER_PY, /WATCH_VERSION = 3/);
});

test("browser_download: bound to the held file read by the server; saving asks every time (never 'Always'); a changed id saves nothing", async () => {
  const held = { id: "aaaaaaaa", name: "facture.pdf", host: "shop.example", url: "https://shop.example/f.pdf", size: 2048, state: "completed" };
  probe.download = async (_b: string, id: string) => (id === "aaaaaaaa" ? held : null);
  const turn = { bot: { id: "bot_dl", userId: "u1" }, user: { id: "u1" }, thread: 0 } as any;
  const call = { type: "tool_use" as const, id: "c1", name: "browser_download", input: { id: "aaaaaaaa", action: "save", seen_download: { id: "aaaaaaaa", name: "autre.exe", host: "evil.example", url: "", size: 1, state: "completed" } } as Record<string, any> };
  await bindCall(turn, call);
  assert.deepEqual(call.input.seen_download, held, "the model's value is replaced by what the server read");
  const tool = browserDownloadTools.find((t) => t.spec.name === "browser_download")!;
  const gate = tool.gate!(call.input, { botId: "bot_dl", tainted: false })!;
  assert.equal(gate.once, true);
  assert.equal(gate.strict, true);
  assert.equal(gate.key, "download: shop.example");
  assert.deepEqual(gate.vars, { file: "facture.pdf", host: "shop.example", size: "2 KB" });
  assert.equal(tool.gate!({ id: "aaaaaaaa", action: "discard" }, { botId: "bot_dl", tainted: false }), null, "deleting a held file asks nothing");
  const acts: string[] = [];
  (linuxScreen as any).downloadAct = async (_b: string, _u: string, _w: string, action: string, id: string) => { acts.push(`${action}:${id}`); return { ok: true, path: "downloads/facture.pdf", size: 2048, name: "facture.pdf" }; };
  const out = await tool.run(call.input, { bot: { id: "bot_dl" }, user: { id: "u1" } } as any);
  assert.match(String(out.content), /Saved “facture\.pdf” from shop\.example as downloads\/facture\.pdf \(2 KB\)\. It is outside content/);
  assert.deepEqual(acts, ["release:aaaaaaaa"]);
  const stale = await tool.run({ id: "bbbbbbbb", action: "save", seen_download: held }, { bot: { id: "bot_dl" }, user: { id: "u1" } } as any);
  assert.equal(stale.isError, true);
  assert.deepEqual(acts, ["release:aaaaaaaa"], "nothing saved for another id");
  const unfinished = await tool.run({ id: "aaaaaaaa", action: "save", seen_download: { ...held, state: "inProgress" } }, { bot: { id: "bot_dl" }, user: { id: "u1" } } as any);
  assert.match(String(unfinished.content), /has not finished/);
});
