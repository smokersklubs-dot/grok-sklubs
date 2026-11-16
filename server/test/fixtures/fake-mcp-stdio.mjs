// A tiny MCP server over standard input/output, for the local tool server tests (localtools.ts). It uses the SDK's own
// low-level Server and StdioServerTransport. Tools: a read-only lookup, a send (irreversible by its name), a wipe
// (irreversible by its destructiveHint annotation), and an echo. `--crash-on-call` exits during any call.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const crash = process.argv.includes("--crash-on-call");
const server = new Server({ name: "fake-notes", version: "1.0.0" }, { capabilities: { tools: {} } });
const obj = (properties = {}) => ({ type: "object", properties });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "list_notes", description: "List the notes.", inputSchema: obj(), annotations: { readOnlyHint: true } },
    { name: "send_message", description: "Send a message to someone.", inputSchema: obj({ to: { type: "string" }, text: { type: "string" } }) },
    { name: "wipe_store", description: "Reset the store.", inputSchema: obj(), annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: "echo", description: "Echo the text back.", inputSchema: obj({ text: { type: "string" } }), annotations: { readOnlyHint: false, destructiveHint: false } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (crash) process.exit(7);
  const args = req.params.arguments ?? {};
  process.stderr.write(`called ${req.params.name}\n`);
  if (req.params.name === "list_notes") return { content: [{ type: "text", text: `notes: courses, banque (pid ${process.pid}, cwd ${process.cwd()})` }] };
  if (req.params.name === "send_message") return { content: [{ type: "text", text: `sent to ${args.to}` }] };
  if (req.params.name === "wipe_store") return { content: [{ type: "text", text: "wiped" }] };
  if (req.params.name === "echo") return { content: [{ type: "text", text: `echo: ${args.text}` }] };
  return { content: [{ type: "text", text: "no such tool" }], isError: true };
});
await server.connect(new StdioServerTransport());
