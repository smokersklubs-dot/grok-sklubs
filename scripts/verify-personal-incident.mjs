// Run from the production image's /app directory, passing the incident ID followed by
// the original upload basenames. Only a completed model response can update the card.
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";

const appModule = file => import(pathToFileURL(path.resolve("server/dist", file)).href);
const { failures, confirmTransportRecovery } = await appModule("agent/failures.js");
const { issueEngineToken, revokeEngineToken } = await appModule("agent/engine.js");
const { personalResponses } = await appModule("personalresponses.js");
const { personalActive } = await appModule("personalplan.js");
const { bots } = await appModule("store.js");
const { config } = await appModule("config.js");

async function verify(id, names) {
  const f = failures.byId(id);
  if (!f || f.provider !== "codex" || f.status !== "waiting") throw Error("No matching open Codex incident");
  const bot = bots.byId(f.bot_id);
  if (!bot || !bot.model.startsWith("codex:") || !personalActive(bot.userId)) throw Error("Personal subscription unavailable");
  const imageCheck = f.class === "bad_input" && /\b413\b.*payload too large/i.test(f.detail);
  if (!(imageCheck ? names.length > 0 && names.length <= 16 : f.class === "rate_limited" && names.length === 0)) throw Error("Check the incident class and original files");
  const root = await realpath(path.join(config.dataDir, "workspaces", bot.id));
  const uploads = path.join(root, "uploads");
  let bytes = 0;
  const parts = [{ type: "input_text", text: "Reply only OK." }];
  for (const name of names) {
    if (path.basename(name) !== name || !/\.(png|jpe?g|webp)$/i.test(name)) throw Error("Expected an original image basename");
    const file = path.join(uploads, name);
    const stat = await lstat(file);
    if (!stat.isFile() || (await realpath(file)) !== file || (bytes += stat.size) > 64 * 1024 * 1024) throw Error("Unsupported upload");
    const mime = /\.png$/i.test(name) ? "png" : /\.webp$/i.test(name) ? "webp" : "jpeg";
    parts.push({ type: "input_image", image_url: "data:image/" + mime + ";base64," + (await readFile(file)).toString("base64") });
  }
  if (imageCheck && bytes <= 21 * 1024 * 1024) throw Error("The files do not exceed the former limit");
  const app = new Hono();
  app.post("/verify/:botId", personalResponses);
  const token = issueEngineToken(bot.id);
  try {
    const response = await app.request("/verify/" + bot.id, { method: "POST", signal: AbortSignal.timeout(120000),
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ instructions: "This is a transport check. Reply only OK. Do not use tools.", tools: [], input: [{ role: "user", content: parts }] }) });
    if (!response.ok) throw Error("Model check returned HTTP " + response.status);
    const completed = (await response.text()).split(/\r?\n/).some(line => {
      if (!line.startsWith("data:")) return false;
      try { const event = JSON.parse(line.slice(5)); return event.type === "response.completed" && event.response?.status === "completed"; }
      catch { return false; }
    });
    if (!completed) throw Error("The model did not complete the response");
    if (!confirmTransportRecovery(bot, id, f.last_at, "codex", bytes)) throw Error("Incident changed during verification");
    console.log(JSON.stringify({ bot: bot.name, files: names.length, bytes, completed, incident: "resolved" }));
  } finally { revokeEngineToken(bot.id); }
}

try { await verify(process.argv[2], process.argv.slice(3)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
