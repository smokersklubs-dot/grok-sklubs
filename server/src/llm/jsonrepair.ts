/**
 * L75 — repair of malformed tool arguments (agent-browser / OpenMausBot audits: a model sometimes sends arguments that are
 * almost JSON; the call used to arrive as { INVALID_JSON: "…" } and fail). Our own code, for the usual slips only:
 *   - a Markdown fence or words around the object (```json { … } ```);
 *   - trailing commas (`{"a": 1,}`), single-quoted strings, unquoted keys (`{a: 1}`);
 *   - Python literals True / False / None;
 *   - raw line breaks or tabs inside a string;
 *   - an answer cut short (unclosed string, object or list): closed at the end.
 * Anything else stays invalid (null): the call is then refused as before. The repair never invents a value: it only
 * closes, quotes and removes characters, and the result must be a JSON object.
 */
export function repairJson(text: string): Record<string, unknown> | null {
  if (typeof text !== "string" || !text.trim() || text.length > 2_000_000) return null;
  let s = text.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  s = s.slice(start);
  const tryParse = (v: string) => { try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null; } catch { return null; } };
  const direct = tryParse(s.slice(0, s.lastIndexOf("}") + 1));
  if (direct) return direct;

  let out = "";
  const stack: string[] = [];
  let quote = ""; // the quote of the string we are in ("" when outside)
  let done = false;
  for (let i = 0; i < s.length && !done; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\") { out += ch + (s[i + 1] ?? ""); i++; continue; }
      if (ch === quote) { out += '"'; quote = ""; continue; }
      if (ch === '"') { out += '\\"'; continue; } // a double quote inside a single-quoted string
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += '"'; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch === "{" ? "}" : "]"); out += ch; continue; }
    if (ch === "}" || ch === "]") {
      out = out.replace(/,\s*$/, "");
      if (stack.at(-1) === ch) stack.pop();
      out += ch;
      if (!stack.length) done = true;
      continue;
    }
    // Bare words: Python literals, or an unquoted key (followed by ":").
    if (/[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z_$][\w$-]*/.exec(s.slice(i))![0];
      const after = s.slice(i + word.length).trimStart();
      if (after.startsWith(":") && stack.at(-1) === "}") out += JSON.stringify(word);
      else out += ({ True: "true", False: "false", None: "null" } as Record<string, string>)[word] ?? word;
      i += word.length - 1;
      continue;
    }
    out += ch;
  }
  // Cut short: close the open string, drop a dangling comma or key, then close what is open.
  if (quote) out += '"';
  if (!done) {
    out = out.replace(/,\s*$/, "").replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/:\s*$/, ": null");
    while (stack.length) out += stack.pop();
  }
  return tryParse(out);
}
