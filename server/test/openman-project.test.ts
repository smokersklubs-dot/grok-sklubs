import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { openmanProject } from "../src/openman-project.js";

const python = process.platform === "win32" ? "python" : "python3";
const py = (args: string[], input?: string) => {
  const p = spawnSync(python, args, { input, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(p.status, 0, String(p.error ?? p.stderr)); return p.stdout.trim();
};

test("a project on an existing desktop can be reopened and bundled offline", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-openman-"));
  try {
    const create = readFileSync(new URL("../templates/openman/create-project.py", import.meta.url), "utf8").split('if __name__ == "__main__":')[0];
    const project = openmanProject({ kind: "slides", title: "Équipe & budget", theme: "paper", slides: [
      { title: "Recherche", points: ["<script>no()</script>"] }, { title: "Livraison", points: ["Été"] },
    ] }, "fr");
    const save = () => py(["-c", create + "\nprint(create(Path(sys.argv[1]), json.load(sys.stdin)))", dir], JSON.stringify(project));
    const folder = path.join(dir, save());
    assert.notEqual(path.join(dir, save()), folder);
    const cli = path.join(folder, "openman.py");
    const state = JSON.parse(py([cli, "state"]));
    assert.equal(state.marker.kind, "slides"); assert.equal(state.deck.slides.length, 2);
    const bundle = JSON.parse(py([cli, "bundle"]));
    const data = JSON.parse(gunzipSync(readFileSync(bundle.path)).toString("utf8"));
    assert.match(data.html[0], /&lt;script&gt;/);
    assert.match(data.html[0], /#f6f2ea/i);
    assert.match(data.html[1], /Été/);
    assert.match(project.files["slides/exports/presentation.fodp"], /&lt;script&gt;/);
    assert.match(project.files["slides/exports/presentation.html"], /lang="fr"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a workspace has no fabricated result and refuses invalid slide input", () => {
  for (const kind of ["research", "data", "video", "audio", "image", "slides"]) {
    const p = openmanProject({ kind, title: "Brief" }, "en");
    assert.equal(p.rendered, false); assert.equal(p.files[p.manifest], undefined);
    assert.equal(JSON.parse(p.files[".openman/generator.json"]).kind, kind);
  }
  for (const args of [{ kind: "../other" }, { kind: "slides", theme: "unknown" }, { kind: "slides", slides: [] },
    { kind: "audio", slides: [{ title: "Hi" }] }, { kind: "slides", slides: [{ title: "\u0001" }] }])
    assert.throws(() => openmanProject({ title: "Brief", ...args }, "fr"));
});
