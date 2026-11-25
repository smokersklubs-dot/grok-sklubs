// « Doit marcher » (24/11): what is shipped (web/dist after `npm run build -w web`, server/dist after the server build)
// holds no path of the machine that built it (/home/…, /Users/…, C:\Users\…) and not its user name.
// /root/… is not looked at: it is the home of the bots' own Linux computers (/root/files, /root/.sklubot), a product path.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUTS = ["web/dist", "server/dist"];
const TEXT = /\.(js|mjs|cjs|css|html|json|map|txt|webmanifest|svg)$/i;
const ALLOWED = [];

export function leaks(text, user = "") {
  const found = [];
  for (const m of text.matchAll(/(?:\/home\/[A-Za-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+)/g)) {
    if (!ALLOWED.some((a) => a.test(text.slice(m.index, m.index + 40)))) found.push(m[0]);
  }
  if (text.includes(REPO)) found.push(`this checkout's folder ${REPO}`);
  // A user name long and rare enough to be one (not "root", "user", "node"…), as a whole word.
  if (user.length >= 5 && !/^(admin|ubuntu|runner|users?)$/i.test(user) && new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) found.push(`user name ${user}`);
  return found;
}

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p); else if (TEXT.test(e)) yield p;
  }
}

test("the path check finds a builder's folders and spares the documented example", () => {
  assert.deepEqual(leaks('x="/home/lea/app/src/a.ts";y="/Users/Marc/x";z="C:\\\\Users\\\\Ana\\\\b"'), ["/home/lea", "/Users/Marc", "C:\\\\Users\\\\Ana"]);
  assert.deepEqual(leaks("--out /root/restauration ; ls /root/files"), [], "the bot computer's own folders");
  assert.deepEqual(leaks(`import "${REPO}/web/src/x.ts"`).length, REPO.startsWith("/home/") || REPO.startsWith("/Users/") ? 2 : 1);
  assert.deepEqual(leaks("built by camille-dev", "camille-dev"), ["user name camille-dev"]);
  assert.deepEqual(leaks("https://example.com/users/12"), []);
});

for (const out of OUTPUTS) {
  const dir = join(REPO, out);
  test(`${out} holds no builder path nor user name`, { skip: !existsSync(dir) && `${out} is not built here` }, () => {
    const bad = [];
    for (const f of files(dir)) for (const l of leaks(readFileSync(f, "utf8"), userInfo().username)) bad.push(`${relative(REPO, f)}: ${l}`);
    assert.deepEqual([...new Set(bad)].slice(0, 20), []);
  });
}
