// L184: poll results and the link to preview (mobile/shared/chatPlus.ts, used by the web and the phone app).
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLink, myChoices, nextChoice, pollResults } from "../../mobile/shared/chatPlus.ts";

const poll = { options: ["Pizza", "Sushi", "Salade"], multi: false, status: "open", votes: [{ by: "user:u", name: "Moi", choices: [0] }, { by: "bot:b", name: "Léa", choices: [0] }, { by: "bot:c", name: "Max", choices: [2] }] };

test("poll results: counts, shares of voters, names", () => {
  assert.deepEqual(pollResults(poll).map((r) => [r.count, r.pct, r.names.join("+")]), [[2, 67, "Moi+Léa"], [0, 0, ""], [1, 33, "Max"]]);
  assert.deepEqual(pollResults({ ...poll, votes: [] }).map((r) => r.pct), [0, 0, 0]);
  assert.deepEqual(myChoices(poll, "user:u"), [0]);
  assert.deepEqual(myChoices(poll, "user:x"), []);
});

test("a tap replaces with one answer, toggles with several", () => {
  assert.deepEqual(nextChoice({ multi: false }, [0], 2), [2]);
  assert.deepEqual(nextChoice({ multi: true }, [2], 0), [0, 2]);
  assert.deepEqual(nextChoice({ multi: true }, [0, 2], 2), [0]);
});

test("the first web address outside code, without the sentence's last punctuation", () => {
  assert.equal(firstLink("Regarde https://velo.example/modele-3. Super !"), "https://velo.example/modele-3");
  assert.equal(firstLink("Voir [la fiche](https://shop.example/p?id=4) et https://autre.example"), "https://shop.example/p?id=4");
  assert.equal(firstLink("`https://code.example` puis ```\nhttps://bloc.example\n``` rien"), null);
  assert.equal(firstLink("https://fr.wikipedia.org/wiki/Lyon_(ville)"), "https://fr.wikipedia.org/wiki/Lyon_(ville)");
  assert.equal(firstLink("ftp://x.example et javascript:alert(1)"), null);
  assert.equal(firstLink("https://user:pw@x.example/"), null);
});
