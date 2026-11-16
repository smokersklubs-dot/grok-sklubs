import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-connerr-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { connectionStatus } = await import("../src/connectors.js");

test("a refused connection keeps only the HTTP status, never the app's text", () => {
  assert.equal(connectionStatus(new StreamableHTTPError(401, "Error POSTing to endpoint: secret page body")), 401);
  assert.equal(connectionStatus(new StreamableHTTPError(503, "down")), 503);
  assert.equal(connectionStatus(new StreamableHTTPError(-1, "Unexpected content type: text/html")), undefined);
  assert.equal(connectionStatus(new StreamableHTTPError(302, "redirect")), undefined);
  assert.equal(connectionStatus(new TypeError("fetch failed")), undefined);
});
