import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

/**
 * The public download page (/telecharger): GET /api/downloads needs no session, and lists the newest Sklubot desktop
 * build of each kind (Sklubot-<version>-<os>.<ext>, companion/package.json), the Android app when the server has it,
 * and the GitHub releases page. The desktop app has the relay built in, so it is also offered as a relay download.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-downloads-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.RELEASE_DOWNLOADS = "0";

const { api } = await import("../src/routes.js");
const { appDownloads, relayDownloads } = await import("../src/relay.js");
import type { AppDownloads } from "../src/shared.js";

test("GET /api/downloads is public and always gives the releases page", async () => {
  const res = await api.request("/downloads");
  assert.equal(res.status, 200);
  const body = (await res.json()) as AppDownloads;
  assert.match(body.releasesUrl, /^https:\/\/github\.com\/smokersklubs-dot\/grok-sklubs\/releases$/);
  assert.ok(Array.isArray(body.desktop));
});

test("desktop builds: newest of each kind, odd names ignored, Android when present", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-dl-"));
  const put = (name: string, bytes = 10) => writeFileSync(path.join(dir, name), Buffer.alloc(bytes));
  put("Sklubot-1.0.0-linux.AppImage", 100);
  put("Sklubot-1.2.0-linux.AppImage", 120);
  put("Sklubot-1.10.0-linux.deb", 90);
  put("Sklubot-1.2.0-win.exe", 70);
  put("Sklubot-1.2.0-win.zip", 75);
  put("Sklubot-1.2.0-mac.dmg", 80);
  put("Sklubot-latest-linux.AppImage");
  put("Sklubot-1.2.0-linux.AppImage.sh");
  put("..Sklubot-1.2.0-win.exe");
  put("sklubot.apk", 50);
  mkdirSync(path.join(dir, "Sklubot-9.9.9-win.exe"));
  const d = appDownloads(dir);
  assert.deepEqual(d.android, { url: "/download/sklubot.apk", size: 50 });
  assert.deepEqual(d.desktop.map((f) => [f.name, f.os, f.kind, f.version, f.size]), [
    ["Sklubot-1.10.0-linux.deb", "linux", "deb", "1.10.0", 90],
    ["Sklubot-1.2.0-linux.AppImage", "linux", "AppImage", "1.2.0", 120],
    ["Sklubot-1.2.0-mac.dmg", "mac", "dmg", "1.2.0", 80],
    ["Sklubot-1.2.0-win.exe", "windows", "exe", "1.2.0", 70],
    ["Sklubot-1.2.0-win.zip", "windows", "zip", "1.2.0", 75],
  ]);
  assert.ok(d.desktop.every((f) => f.url === `/download/${f.name}`));
  const relay = relayDownloads(dir);
  assert.ok(relay.files.some((f) => f.name === "Sklubot-1.2.0-mac.dmg" && f.platform === "mac"), "the desktop app is also offered as the relay");
});

test("no download folder: nothing but the releases page", () => {
  const d = appDownloads(path.join(tmpdir(), "does-not-exist-sklubot"));
  assert.deepEqual(d.desktop, []);
  assert.equal(d.android, null);
});

test("GitHub release files fill in what this server lacks; a local copy of the same version wins", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-dl-rel-"));
  writeFileSync(path.join(dir, "Sklubot-1.0.0-linux.AppImage"), Buffer.alloc(30));
  const gh = (name: string) => ({ name, url: `https://github.com/smokersklubs-dot/grok-sklubs/releases/download/desktop-v1.0.0/${name}`, size: 99 });
  const d = appDownloads(dir, [gh("Sklubot-1.0.0-linux.AppImage"), gh("Sklubot-1.0.0-win.exe"), gh("Sklubot-1.0.0-mac.dmg"), gh("notes.txt")]);
  assert.deepEqual(d.desktop.map((f) => [f.name, f.url.startsWith("/download/") ? "local" : "github"]), [
    ["Sklubot-1.0.0-linux.AppImage", "local"],
    ["Sklubot-1.0.0-mac.dmg", "github"],
    ["Sklubot-1.0.0-win.exe", "github"],
  ]);
  const relay = relayDownloads(dir, [gh("Sklubot-1.0.0-win.exe")]);
  assert.ok(relay.files.some((f) => f.name === "Sklubot-1.0.0-win.exe" && f.url.startsWith("https://github.com/")));
});

test("the native Android app attached to a release replaces the server's older APK, newest version first", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-dl-apk-"));
  writeFileSync(path.join(dir, "sklubot.apk"), Buffer.alloc(10));
  const gh = (name: string) => ({ name, url: `https://github.com/smokersklubs-dot/grok-sklubs/releases/download/desktop-v1.0.0/${name}`, size: 75 });
  const d = appDownloads(dir, [gh("sklubot-complet-1.0.0.apk"), gh("sklubot-complet-1.1.0.apk"), gh("sklubot-store-1.1.0.apk")]);
  assert.deepEqual(d.android, { url: gh("sklubot-complet-1.1.0.apk").url, size: 75, version: "1.1.0", name: "sklubot-complet-1.1.0.apk" });
  assert.deepEqual(appDownloads(dir, []).android, { url: "/download/sklubot.apk", size: 10 });
});
