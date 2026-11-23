import type { ToolSpec } from "../llm/types.js";
import { plugins, PluginError } from "../plugins.js";
import { RemoteAgentError, remoteAgents } from "../remoteagents.js";
import { bots, clip } from "../store.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L172 — the bot works with another agent (A2A over HTTPS, or an ACP agent program in the bot's computer:
 * remoteagents.ts), and L174 — the bot proposes a plugin for the owner to review (plugins.ts).
 *
 * agent_ask is a connector call with the usual approvals: a card the first time for each agent (« Toujours » possible),
 * and after outside content every time (strict), since the message leaves for another agent. Its answer is outside
 * content. plugin_propose only files a plugin for review: nothing runs until the owner installs it in the app.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

const askGate: NonNullable<BuiltinTool["gate"]> = (a, ctx) => {
  const bot = bots.byId(ctx.botId);
  const agent = bot ? remoteAgents.byName(bot.userId, String(a.agent ?? "")) : null;
  if (!bot || !agent) return null; // the tool explains
  return {
    key: `remote agent: ${bot.name}: ${agent.id}`, strict: ctx.tainted, source: "Other agents",
    vars: { agent: agent.name, kind: agent.kind === "a2a" ? "A2A" : "ACP", message: clip(String(a.message ?? ""), 300) },
    title: ctx.tainted ? "{bot} has read outside content. Allow it to send this to the agent {agent}?" : "Allow {bot} to send this to the agent {agent} ({kind})?",
    reason: "work with the agent {agent}", note: "Message: “{message}”",
  };
};

export const remoteAgentTools: BuiltinTool[] = [
  {
    spec: { name: "agent_list", description: "List the other agents the owner connected (A2A agents on the web, ACP agent programs that run in your computer), with what they say they can do.", inputSchema: obj({}) },
    group: "apps", activity: "connector", label: "Listing other agents", parallel: true,
    run: async (_a, c) => {
      const list = remoteAgents.list(c.user.id);
      if (!list.length) return { content: "No other agent is connected. The owner adds one in Settings → Apps → « Autres agents ».", summary: "0" };
      return { content: list.map((x) => `- ${x.name} (${x.kind === "a2a" ? "A2A, on the web" : "ACP, runs in your computer"})${x.card.description ? `: ${x.card.description}` : ""}${x.card.skills?.length ? ` — skills: ${x.card.skills.join(", ")}` : ""}`).join("\n"), summary: `${list.length}` };
    },
  },
  {
    spec: { name: "agent_ask", description: "Send a message or a task to another agent the owner connected (agent_list) and get its answer. The owner is asked first. Give it everything it needs in the message; never secrets.", inputSchema: obj({ agent: str("The agent's name, as agent_list shows it"), message: str("What you ask it, complete and self-contained") }, ["agent", "message"]) },
    group: "apps", activity: "connector", label: "Working with another agent", outside: true, audited: true, gate: askGate,
    detail: (a) => (typeof a.agent === "string" ? a.agent : undefined),
    run: async (a, c) => {
      const agent = remoteAgents.byName(c.user.id, String(a.agent ?? ""));
      if (!agent) return { content: `No connected agent is called "${clip(String(a.agent ?? ""), 60)}". Use agent_list.`, isError: true };
      const message = clip(String(a.message ?? "").trim(), 20_000);
      if (!message) return { content: "Give the message to send.", isError: true };
      try {
        const answer = await remoteAgents.ask({ id: c.bot.id, userId: c.user.id }, agent, message, c.signal);
        return { content: `Answer from the agent ${agent.name}:\n${answer}`, summary: clip(agent.name, 40) };
      } catch (e) {
        if (e instanceof RemoteAgentError) return { content: `${e.message} Do not retry in a loop.`, isError: true, summary: "agent error" };
        throw e;
      }
    },
  },
  {
    spec: { name: "plugin_propose", description: "Propose a plugin (a third-party tool server in the sklubot-plugin/1 JSON format) for your owner to review and install. It runs only in your own computer once installed; until the owner installs it in the app, nothing runs.", inputSchema: obj({ manifest: str("The plugin's manifest, as JSON text") }, ["manifest"]) },
    group: "apps", activity: "saving", label: "Proposing a plugin", audited: true,
    run: async (a, c) => {
      try {
        const r = plugins.propose(c.bot, String(a.manifest ?? ""), "bot");
        return { content: `Plugin "${r.name}" ${r.version} is waiting for the owner's review (Settings → ${c.bot.name} → Plugins). Safety check: ${r.worst}. Nothing runs until they install it.`, summary: r.name };
      } catch (e) {
        if (e instanceof PluginError) return { content: e.message, isError: true };
        throw e;
      }
    },
  },
];
