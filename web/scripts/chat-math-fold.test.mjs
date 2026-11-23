// L136 (long blocks fold, ↑ brings back your messages) and L147 (LaTeX in the chat, KaTeX MathML).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMath, restoreMath, cleanMathMl, KATEX_OPTIONS } from "../src/lib/mathtex.ts";
import { codeLines, shouldFold, FOLD_LINES, FOLD_ROWS } from "../src/lib/blockfold.ts";
import { ownMessages, recallStep } from "../src/lib/recall.ts";
import { renderToString } from "../vendor/katex/katex.mjs";

test("math: the four delimiters are found, in order, block or inline", () => {
  const { text, items } = extractMath("Soit $x^2$ et \\(y_1\\).\n\n$$\\int_0^1 f$$\n\n\\[a_b\\]");
  assert.deepEqual(items, [{ tex: "x^2", display: false }, { tex: "y_1", display: false }, { tex: "\\int_0^1 f", display: true }, { tex: "a_b", display: true }]);
  assert.equal(/[$\\]/.test(text), false, "no delimiter is left for Markdown");
});

test("math: amounts of money stay text", () => {
  for (const s of ["Ça coûte 5 $ et 10 $.", "It costs $5 and $10.", "Prix : 3$ ou 4$", "un \\$ échappé $x$ non"])
    assert.equal(extractMath(s).items.filter((i) => i.tex !== "x").length, 0, s);
  assert.equal(extractMath("Between $5 and $10 per $x$").items.length, 1);
});

test("math: code blocks and inline code are left alone", () => {
  const src = "```\n$a$ \\(b\\)\n```\nAnd `$c$` but $d$\n~~~tex\n$$e$$\n~~~";
  const { text, items } = extractMath(src);
  assert.deepEqual(items.map((i) => i.tex), ["d"]);
  assert.ok(text.includes("$a$ \\(b\\)") && text.includes("`$c$`") && text.includes("$$e$$"));
});

test("math: a message without $ or \\ is returned as it is", () => {
  const s = "Bonjour *toi* — rien à voir.";
  assert.equal(extractMath(s).text, s);
});

test("math: the formula comes back escaped, never as markup", () => {
  const { text, items } = extractMath('Voir $<img src=x onerror="alert(1)">$');
  const html = restoreMath(`<p>${text}</p>`, items);
  assert.ok(!html.includes("<img"), html);
  assert.match(html, /<span class="md-math" data-tex="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;">/);
  const block = restoreMath(extractMath("$$a$$").text, extractMath("$$a$$").items);
  assert.match(block, /class="md-math is-display".*data-display="1"/);
});

test("math: limits — at most 200 formulas, each up to 2000 characters", () => {
  assert.equal(extractMath(Array.from({ length: 250 }, (_, i) => `$x_${i}$`).join(" ")).items.length, 200);
  assert.equal(extractMath(`$${"a".repeat(2001)}$`).items.length, 0);
});

test("KaTeX: MathML output, no link even when asked, errors do not throw", () => {
  const out = cleanMathMl(renderToString("\\frac{a}{b} + \\sqrt{2}", { ...KATEX_OPTIONS, displayMode: true }));
  assert.match(out, /<math[^>]*display="block"/);
  assert.match(out, /<mfrac>/);
  assert.ok(!out.includes("<annotation") && !out.includes("semantics"), "annotation and semantics removed for the sanitiser");
  const link = cleanMathMl(renderToString("\\href{javascript:alert(1)}{x}", KATEX_OPTIONS));
  assert.ok(!/href=|javascript:/.test(link), "trust is off: \\href is shown as text, never a link");
  assert.doesNotThrow(() => renderToString("\\frac{", KATEX_OPTIONS));
  assert.match(renderToString("\\frac{", KATEX_OPTIONS), /katex-error/);
});

test("fold: code blocks over 20 lines and tables over 12 rows fold", () => {
  assert.equal(codeLines("a\nb\nc\n"), 3);
  assert.equal(codeLines(""), 0);
  assert.equal(shouldFold("code", FOLD_LINES), false);
  assert.equal(shouldFold("code", FOLD_LINES + 1), true);
  assert.equal(shouldFold("table", FOLD_ROWS), false);
  assert.equal(shouldFold("table", FOLD_ROWS + 1), true);
});

const row = (seq, role, text, extra = {}) => ({ botId: "b", generation: 0, seq, rev: 0, createdAt: seq, body: { kind: "message", role, text, ...extra } });

test("recall: only your own messages, newest first, no repeats", () => {
  const rows = [row(1, "user", "un"), row(2, "assistant", "réponse"), row(3, "user", "deux"), row(4, "user", "un"), row(5, "user", "routine", { origin: { kind: "routine", id: "r", name: "R" } }), row(6, "user", "effacé", { deleted: true }), { ...row(7, "user", ""), body: { kind: "card", card: {} } }];
  assert.deepEqual(ownMessages(rows), ["un", "deux"]);
});

test("recall: ↑ in an empty box, ↑ again, ↓ back to what you were typing", () => {
  const h = ["trois", "deux", "un"];
  assert.equal(recallStep(h, null, "je tape", "up"), null, "a box with text keeps its arrows");
  assert.equal(recallStep(h, null, "", "down"), null);
  let s = recallStep(h, null, "", "up");
  assert.equal(s.text, "trois");
  s = recallStep(h, s.state, s.text, "up"); assert.equal(s.text, "deux");
  s = recallStep(h, s.state, s.text, "up"); assert.equal(s.text, "un");
  s = recallStep(h, s.state, s.text, "up"); assert.equal(s.text, "un", "stops at the oldest");
  s = recallStep(h, s.state, s.text, "down"); assert.equal(s.text, "deux");
  s = recallStep(h, s.state, s.text, "down"); s = recallStep(h, s.state, s.text, "down");
  assert.equal(s.text, ""); assert.equal(s.state, null, "past the newest: back to the empty box");
  const edited = recallStep(h, { index: 0, saved: "" }, "trois modifié", "up");
  assert.equal(edited, null, "an edited recall: the arrows move the cursor again");
  assert.equal(recallStep([], null, "", "up"), null);
});
