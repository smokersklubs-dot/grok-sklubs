import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L40 (second part): secrets in the windows of apps are blacked out of the « Montre-moi » pictures, and every box is
// scaled to the picture (960 px wide) instead of being drawn at screen size.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-appmask-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.DESKTOP_RESOLUTION = "1280x800x24";
const { parseWindows, secretWordBoxes, scaleBoxes, SECRET_WINDOW, appSecretBoxes, screenWidth } = await import("../src/teachappmask.js");

/** One OCR word: [line, left, top, width, text]. */
const word = (line: number, left: number, text: string) => `5\t1\t1\t1\t${line}\t1\t${left}\t${line * 30}\t${text.length * 10}\t20\t95\t${text}`;
const head = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

test("L40: wmctrl's list → the visible windows (panels on every desktop dropped)", () => {
  const w = parseWindows("0x01400003 -1 0    776  1280 24   box tint2\n0x02000001  0 50   60   700  300  box Terminal — xterm\n0x02200004  0 0 0 1280 776 box Shop - Chromium\n");
  assert.deepEqual(w.map((x) => x.title), ["Terminal — xterm", "Shop - Chromium"]);
  assert.deepEqual([w[0].x, w[0].y, w[0].w, w[0].h], [42, 12, 708, 348], "grown up and left by the title bar's height");
  assert.ok(SECRET_WINDOW.test("KeePassXC") && SECRET_WINDOW.test("Entrez le mot de passe") && SECRET_WINDOW.test("pinentry-gtk"));
  assert.ok(!SECRET_WINDOW.test("Terminal — xterm") && !SECRET_WINDOW.test("notes.txt - Mousepad"));
});

test("L40: OCR words — keys, card numbers and what follows a password label are hidden; plain words are not", () => {
  const text = [head,
    word(1, 0, "Hello"), word(1, 60, "world"),
    word(2, 0, "password:"), word(2, 100, "hunter2"), word(2, 200, "extra"),
    word(3, 0, "token=abcdef123"),
    word(4, 0, "key"), word(4, 50, "sk-fake-for-tests-0000"),
    word(5, 0, "mot"), word(5, 40, "de"), word(5, 70, "passe"), word(5, 130, ":"), word(5, 150, "Soleil42"),
    word(6, 0, "card"), word(6, 50, "4242424242424242"),
    word(7, 0, "Done"),
  ].join("\n");
  const boxes = secretWordBoxes(text, 100, 1000);
  const tops = boxes.map((b) => b[1] - 1000 + 3);
  assert.ok(!tops.includes(30), "line 1 (Hello world) is not hidden");
  assert.equal(boxes.filter((b) => b[1] === 1000 + 60 - 3).length, 2, "line 2: the two words after « password: »");
  assert.ok(tops.includes(90), "token=… hidden");
  assert.ok(boxes.some((b) => b[1] === 1000 + 120 - 3 && b[0] === 100 + 50 - 3), "an API-key-looking word");
  assert.ok(boxes.some((b) => b[1] === 1000 + 150 - 3 && b[0] === 100 + 150 - 3), "« mot de passe : » hides what follows");
  assert.ok(tops.includes(180), "a card number");
  assert.ok(!tops.includes(210), "the next line (Done) is not hidden");
});

test("L40: boxes in screen pixels are scaled to the 960 px picture", () => {
  assert.equal(screenWidth(), 1280);
  assert.deepEqual(scaleBoxes([[100, 200, 40, 20]], 960 / 1280), [[75, 150, 31, 16]]);
  assert.deepEqual(scaleBoxes([[1, 2, 3, 4]], 1), [[1, 2, 3, 4]]);
});

test("L40: a window that cannot be read is hidden whole; a secret store's window is hidden whole without OCR", async () => {
  const calls: string[] = [];
  const fake = (async (args: string[]) => {
    const cmd = args.at(-1) ?? "";
    calls.push(cmd);
    if (cmd.includes("wmctrl")) return { code: 0, stdout: Buffer.from("0x1 0 10 60 300 200 box KeePassXC\n0x2 0 400 60 300 200 box notes - Mousepad\n0x3 0 0 0 1280 776 box Page - Chromium\n"), stderr: "" };
    return { code: 40, stdout: Buffer.alloc(0), stderr: "" }; // no OCR on this computer
  }) as unknown as Parameters<typeof appSecretBoxes>[1];
  const boxes = await appSecretBoxes("bot-x", fake);
  assert.deepEqual(boxes, [[2, 12, 308, 248], [392, 12, 308, 248]]);
  assert.equal(calls.filter((c) => c.includes("tesseract")).length, 1, "OCR tried for the editor only (not the browser, not KeePassXC)");
});

// On a real bot computer (Docker and the desktop image), when available.
const { docker } = await import("../src/linux.js");
const dockerUp = (await docker(["info"], { timeoutMs: 8000 }).catch(() => ({ code: 1 }))).code === 0;
test("L40: on the bot's computer, a terminal showing a password and a key gets them hidden", { skip: !dockerUp && "Docker is not running", timeout: 480_000 }, async () => {
  process.env.COMPUTER = "linux";
  const { initComputer, screen } = await import("../src/computer.js");
  const { linuxScreen, containerName } = await import("../src/linux.js");
  const { bots, users } = await import("../src/store.js");
  const { blackOut } = await import("../src/teachmask.js");
  const sharp = (await import("sharp")).default;
  await initComputer();
  const user = users.create("appmask@example.com", "Léa", "x", "en");
  const bot = bots.create(user.id, { name: "Masky", autonomy: "balanced" });
  after(async () => { await linuxScreen.destroy(bot.id).catch(() => {}); });
  await screen.wake(bot.id, user.id);
  const n = containerName(bot.id);
  await docker(["exec", n, "sh", "-c", "pkill -f sklubot-browser; true"]);
  // An image built before Tesseract was added has no OCR: it is installed here when the network allows it, else the
  // terminal must be hidden whole (when unsure, hide).
  const ocr = (await docker(["exec", n, "sh", "-c", "command -v tesseract >/dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra) >/dev/null 2>&1; command -v tesseract"], { timeoutMs: 180_000 })).code === 0;
  await docker(["exec", "-d", n, "sh", "-c", "DISPLAY=:1 xterm -T 'Terminal' -geometry 60x8+40+60 -fa 'DejaVu Sans Mono' -fs 16 -bg white -fg black -e sh -c 'echo Hello there; echo password: Soleil42xyz; echo sk-fake-for-tests-0000000; echo Bye; sleep 300'"]);
  let boxes: [number, number, number, number][] = [];
  for (let i = 0; i < 20 && (ocr ? boxes.length < 2 : !boxes.length); i++) { await new Promise((r) => setTimeout(r, 700)); boxes = await appSecretBoxes(bot.id); }
  const seen = ocr ? (await docker(["exec", n, "sh", "-c", "DISPLAY=:1 import -silent -window root png:- | tesseract stdin stdout -l fra+eng 2>/dev/null"])).stdout.toString().replace(/\s+/g, " ").slice(0, 300) : "";
  // When it fails, say what the window list held (wmctrl -lG): the mask only reads inside listed windows.
  const wins = boxes.length >= 2 ? "" : (await docker(["exec", n, "sh", "-c", "DISPLAY=:1 wmctrl -lG 2>&1; echo wm=$(pgrep -c openbox)"])).stdout.toString().replace(/\s+/g, " ").slice(0, 400);
  if (ocr) assert.ok(boxes.length >= 2 && boxes.length <= 6 && boxes.every((b) => b[2] < 500), `the password and the key, word by word: ${JSON.stringify(boxes)} (OCR read: ${seen}) (windows: ${wins})`);
  else assert.equal(boxes.length, 1, `no OCR: the terminal hidden whole: ${JSON.stringify(boxes)}`);
  assert.ok(boxes.every((b) => b[0] >= 30 && b[1] >= 50 && b[0] < 900 && b[1] < 400), "inside the terminal");
  // The picture as the recording keeps it: the hidden boxes are black, scaled to 960 px.
  const raw = await screen.frame(bot.id);
  assert.ok(raw);
  const out = await blackOut(raw!, scaleBoxes(boxes, 960 / screenWidth()));
  const [x, y, w, h] = scaleBoxes([boxes[0]], 960 / 1280)[0];
  const px = await sharp(out).extract({ left: x + Math.floor(w / 2), top: y + Math.floor(h / 2), width: 1, height: 1 }).raw().toBuffer();
  assert.ok(px[0] < 40 && px[1] < 40 && px[2] < 40, `black in the middle of the first box: ${[...px]}`);
});
