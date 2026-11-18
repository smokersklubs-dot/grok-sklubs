/** Shared by the server and both chat clients. Keep the range so choosing a source preserves the rest of the draft. */
export function mentionAt(text: string, caret: number) {
  if (caret < 0 || caret > text.length) return null;
  const match = /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const tail = /^[\p{L}\p{N}_.-]*/u.exec(text.slice(caret))![0];
  return { query: match[1].toLowerCase(), start: caret - match[1].length - 1, end: caret + tail.length };
}

export function replaceMention(text: string, range: { start: number; end: number }, value: string) {
  const after = text.slice(range.end);
  const prefix = text.slice(0, range.start) + value;
  const space = value && !/^\s/.test(after) ? " " : "";
  return { text: prefix + space + after, caret: prefix.length + space.length };
}

/** Only a repository root can become an attached source. Never carry credentials, queries or other hosts. */
export function repositoryName(input: string): string | null {
  const m = /^(?:https:\/\/(?:www\.)?github\.com\/)?([a-z\d][a-z\d-]{0,38})\/([a-z\d._-]{1,104})\/?$/i.exec(input.trim());
  if (!m) return null;
  const name = m[2].replace(/\.git$/i, "");
  return name && name.length <= 100 && name !== "." && name !== ".." ? m[1] + "/" + name : null;
}

export function isGithubConnector(url: string) {
  return /^https:\/\/api\.githubcopilot\.com\/mcp(?:\/readonly)?\/?$/i.test(url);
}

export const featuredRepositories = ["ai-timon/timon", "makushingu/harness-maxxing", "debpalash/VoiceStudio"];
