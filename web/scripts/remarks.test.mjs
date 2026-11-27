// L140 remarks (src/lib/remarks.ts, server/src/clientshared/pagecomment.ts): comment a page element, annotate an image,
// « Montrer » a spot of the bot's screen, a remark on one changed file. Pure message builders and the check of what the
// page's comment layer posts back.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileRemarkMessage, fractionIn, imageRemarkMessage, pageRemarkMessage, screenPointMessage, where, REMARK_MAX } from "../src/lib/remarks.ts";
import { parsePagePick, withCommentLayer, PAGE_PICK } from "../../server/src/clientshared/pagecomment.ts";

const pick = { type: PAGE_PICK, v: 1, path: "main > section#tarifs > p:nth-of-type(2)", tag: "P", text: "29 €  par\nmois", selection: "" };

test("L140 page: a pick from the layer is checked field by field; anything else is refused", () => {
  assert.deepEqual(parsePagePick(pick), { path: "main > section#tarifs > p:nth-of-type(2)", tag: "p", text: "29 € par mois", selection: "" });
  assert.equal(parsePagePick({ ...pick, type: "other" }), null);
  assert.equal(parsePagePick({ ...pick, v: 2 }), null);
  assert.equal(parsePagePick({ ...pick, path: "" }), null);
  assert.equal(parsePagePick({ ...pick, path: "p[onclick=alert(1)]" }), null, "only tags, ids and :nth-of-type");
  assert.equal(parsePagePick({ ...pick, tag: "<img>" }), null);
  assert.equal(parsePagePick(null), null);
  assert.equal(parsePagePick("x"), null);
  assert.equal(parsePagePick({ ...pick, text: "a".repeat(5000) }).text.length, 300);
  assert.equal(parsePagePick({ ...pick, selection: "b".repeat(5000) }).selection.length, 600);
});

test("L140 page: the layer goes just before the last </body>, or at the end", () => {
  const out = withCommentLayer("<html><body><p>x</p></BODY></html>");
  assert.ok(out.indexOf("<script data-sklubot-layer>") < out.indexOf("</BODY>"));
  assert.equal((out.match(/data-sklubot-layer>/g) || []).length, 1);
  assert.ok(withCommentLayer("<p>x</p>").endsWith("</script>"));
  assert.ok(!/<\/script>[\s\S]*<\/script>/.test(withCommentLayer("")), "one script only");
});

test("L140 page: the message names the element and quotes its words, then the remark", () => {
  const p = parsePagePick(pick);
  assert.equal(pageRemarkMessage("Sur ta page « Tarifs » :", p, "  Mets 24 €  "), "Sur ta page « Tarifs » :\n`main > section#tarifs > p:nth-of-type(2)`\n> 29 € par mois\n\nMets 24 €");
  assert.equal(pageRemarkMessage("Tête", p, "   "), "", "no remark, nothing to send");
  assert.ok(pageRemarkMessage("Tête", { ...p, selection: "par mois" }, "ok").includes("> par mois"), "a selection wins over the element's words");
  assert.equal(pageRemarkMessage("Tête", p, "x".repeat(REMARK_MAX + 50)).split("\n").pop().length, REMARK_MAX);
});

test("L140 image: one line per pin with a note, its place in percent and pixels, then the remark", () => {
  const pins = [{ x: 0.25, y: 0.5, note: "Logo trop petit" }, { x: 1.2, y: -1, note: "" }, { x: 0.9, y: 0.1, note: "Enlève ça" }];
  const m = imageRemarkMessage("Image annotée :", pins, "Merci", { w: 800, h: 600 });
  assert.equal(m, "Image annotée :\n1. (x 25 %, y 50 % (px 200,300 / 800×600)) Logo trop petit\n3. (x 90 %, y 10 % (px 720,60 / 800×600)) Enlève ça\n\nMerci");
  assert.equal(imageRemarkMessage("H", [], "", null), "", "nothing drawn, nothing written");
  assert.equal(imageRemarkMessage("H", [{ x: 0.1, y: 0.1, note: "" }], "", null), "H", "a pin alone still sends the picture");
  assert.equal(where(1.5, -0.2, null), "x 100 %, y 0 %", "clamped, no pixels without a size");
});

test("L140 « Montrer » and file remark: the spot or the file, then what to do; nothing without words", () => {
  assert.equal(screenPointMessage("Sur ton écran, regarde ici :", 0.5, 0.25, { w: 1920, h: 1080 }, "Clique sur Valider"), "Sur ton écran, regarde ici : x 50 %, y 25 % (px 960,270 / 1920×1080)\n\nClique sur Valider");
  assert.equal(screenPointMessage("H", 0.5, 0.5, null, " "), "");
  assert.equal(fileRemarkMessage("À propos du fichier", "site/index.html", "Le titre en bleu"), "À propos du fichier `~/site/index.html`\n\nLe titre en bleu");
  assert.equal(fileRemarkMessage("H", "a`b.md", "x"), "H `~/ab.md`\n\nx");
  assert.equal(fileRemarkMessage("H", "a.md", ""), "");
});

test("L140: a click maps to fractions of the element; outside it, nothing", () => {
  const r = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(fractionIn(r, 150, 75), { x: 0.25, y: 0.25 });
  assert.equal(fractionIn(r, 99, 75), null);
  assert.equal(fractionIn({ ...r, width: 0 }, 150, 75), null);
});
