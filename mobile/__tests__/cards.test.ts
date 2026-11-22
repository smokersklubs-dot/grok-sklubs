/// <reference types="node" />
/**
 * The native cards send exactly what the web app sends (paths and bodies), and secrets stay out of logs and storage.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { cardReq } from "../src/lib/cardActions";
import { answersCard, rankApps, sameUrl } from "../src/lib/catalog";
import type { CatalogApp } from "../../server/src/shared";

const web = ["Cards.tsx", "RulesAndNudges.tsx", "SpendSkillsFiles.tsx", "Modals.tsx"].map((f) => readFileSync(join(__dirname, "../../web/src/components", f), "utf8")).join("\n");
const routes = readFileSync(join(__dirname, "../../server/src/routes.ts"), "utf8");

describe("card requests", () => {
  it("match the web app's calls", () => {
    expect(cardReq.decide("a/1", "always")).toEqual({ path: "/approvals/a%2F1", body: { decision: "always" } });
    // « Autoriser pour cette conversation »: the third yes (the server decides whether the card may be answered so).
    expect(cardReq.decide("a/1", "conversation")).toEqual({ path: "/approvals/a%2F1", body: { decision: "conversation" } });
    expect(cardReq.answer("b", 4, "Oui")).toEqual({ path: "/bots/b/cards/4/answer", body: { answer: "Oui" } });
    expect(cardReq.dismiss("b", 4)).toEqual({ path: "/bots/b/cards/4/dismiss" });
    expect(cardReq.secret("b", 7, "sk-x", "api.example.com")).toEqual({ path: "/bots/b/cards/7/secret", body: { value: "sk-x", host: "api.example.com" } });
    expect(cardReq.takeoverDone("b", "t1")).toEqual({ path: "/bots/b/takeover/t1/done" });
    expect(cardReq.uncertain("e1", "check")).toEqual({ path: "/executions/e1", body: { action: "check" } });
    expect(cardReq.taskStop("b", "t")).toEqual({ path: "/bots/b/bgtasks/t/stop" });
    expect(cardReq.taskReply("b", "t", "go")).toEqual({ path: "/bots/b/bgtasks/t/reply", body: { text: "go" } });
    expect(cardReq.nudge("b", "n", "later")).toEqual({ path: "/bots/b/nudges/n", body: { action: "later" } });
    expect(cardReq.spend("c", "raise")).toEqual({ path: "/spend/c", body: { action: "raise" } });
    expect(cardReq.skillSave("b", 2, "N", "S")).toEqual({ path: "/bots/b/cards/2/skill", body: { action: "save", name: "N", steps: "S" } });
    expect(cardReq.skillDismiss("b", 2).body).toEqual({ action: "dismiss" });
    expect(cardReq.apiApprove("b", 3, "").body).toEqual({ action: "approve", token: undefined });
    expect(cardReq.apiApprove("b", 3, "tok").body).toEqual({ action: "approve", token: "tok" });
    expect(cardReq.apiDismiss("b", 3)).toEqual({ path: "/bots/b/cards/3/apiconnector", body: { action: "dismiss" } });
    expect(cardReq.memory("b", 5, "new")).toEqual({ path: "/bots/b/cards/5/memory", body: { choice: "new" } });
    expect(cardReq.mailRelease("b", "m")).toEqual({ path: "/bots/b/mail/m/release" });
  });

  it("use endpoints that the web app calls and the server serves", () => {
    const pairs: [string, string][] = [
      ["/approvals/${", 'api.post("/approvals/:approvalId"'],
      ["run(\"answer\", { answer: opt })", 'api.post("/bots/:id/cards/:seq/answer"'],
      ["/cards/${seq}/dismiss", 'api.post("/bots/:id/cards/:seq/dismiss"'],
      ["/cards/${seq}/secret", 'api.post("/bots/:id/cards/:seq/secret"'],
      ["/takeover/${", 'api.post("/bots/:id/takeover/:takeoverId/done"'],
      ["/executions/${", "/executions/:"],
      ["/bgtasks/${enc(card.taskId)}/stop", 'api.post("/bots/:id/bgtasks/:taskId/stop"'],
      ["/bgtasks/${enc(card.taskId)}/reply", 'api.post("/bots/:id/bgtasks/:taskId/reply"'],
      ["/nudges/${enc(card.nudgeId)}", 'api.post("/bots/:id/nudges/:nudgeId"'],
      ["/spend/${enc(card.checkpointId)}", "/spend/:"],
      ["/cards/${seq}/skill", 'api.post("/bots/:id/cards/:seq/skill"'],
      ["/cards/${seq}/apiconnector", 'api.post("/bots/:id/cards/:seq/apiconnector"'],
      ["/cards/${seq}/memory", 'api.post("/bots/:id/cards/:seq/memory"'],
      ["/mail/${encodeURIComponent(card.mailId)}/release", 'api.post("/bots/:id/mail/:mailId/release"'],
    ];
    for (const [w, r] of pairs) {
      expect(web.includes(w) ? w : `missing in web: ${w}`).toBe(w);
      expect(routes.includes(r) ? r : `missing in routes: ${r}`).toBe(r);
    }
    // The web sends the secret card's value and host only (the server keeps the card's header and prefix).
    expect(web).toContain("`/bots/${botId}/cards/${seq}/secret`, { value, host }");
  });
});

describe("secrets stay out of logs and the phone's storage", () => {
  it("no logging or storage in the card code", () => {
    for (const f of ["components/Cards.tsx", "components/cardKit.tsx", "components/ConnectSheet.tsx", "lib/cardActions.ts"]) {
      const src = readFileSync(join(__dirname, "../src", f), "utf8");
      expect(src).not.toMatch(/console\.|SecureStore|AsyncStorage|FileSystem|setItem|Clipboard/);
    }
    const kit = readFileSync(join(__dirname, "../src/components/cardKit.tsx"), "utf8");
    expect(kit).toContain("secureTextEntry={!reveal}");
    expect(kit).toContain('importantForAutofill="no"');
  });
});

describe("connect card catalogue", () => {
  const app = (name: string, description = ""): CatalogApp => ({ id: name.toLowerCase(), name, category: "x", description, url: `https://${name}.example/mcp`, auth: "token", tokenHelp: "" });
  it("matches the app the bot asked for, like the web", () => {
    expect(answersCard("Notion", "notion")).toBe(true);
    expect(answersCard("GitHub", "GitHub Enterprise")).toBe(true);
    expect(answersCard("Linear", "Notion")).toBe(false);
    expect(answersCard("Linear", " ")).toBe(false);
  });
  it("puts the asked app first and filters on the search", () => {
    const apps = [app("Linear"), app("Notion", "notes"), app("Slack")];
    expect(rankApps(apps, "Notion", "").map((a) => a.name)).toEqual(["Notion", "Linear", "Slack"]);
    expect(rankApps(apps, "Notion", "sla").map((a) => a.name)).toEqual(["Slack"]);
    expect(rankApps(apps, "Notion", "NOTES").map((a) => a.name)).toEqual(["Notion"]);
  });
  it("compares connector addresses loosely", () => {
    expect(sameUrl("https://A.example/mcp/", "https://a.example/mcp")).toBe(true);
    expect(sameUrl("https://a.example/mcp", "https://b.example/mcp")).toBe(false);
  });
});
