/**
 * CSV import of saved logins.
 *
 * The file is read as RFC 4180 CSV (https://www.rfc-editor.org/rfc/rfc4180): fields separated by commas, optionally in
 * double quotes, "" for a quote inside a quoted field, line breaks allowed inside quotes. The first line names the columns.
 *
 * Columns are recognised by name (case and spaces ignored). Formats checked against their vendors' documentation:
 *  - generic: name,url,username,password (+ note / notes)
 *  - Bitwarden: folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
 *    (https://bitwarden.com/help/condition-bitwarden-import/)
 *  - 1Password: title, website, username, password, notes (https://support.1password.com/import-1password-com/)
 * Anything else: the user maps the columns by hand (only the header names go back to the browser, never a value).
 */
export type Field = "name" | "url" | "username" | "password" | "note" | "totp";
export type Mapping = Partial<Record<Field, number>>;

const ALIASES: Record<Field, string[]> = {
  name: ["name", "title"],
  url: ["url", "login_uri", "website", "uri", "site", "loginuri"],
  username: ["username", "login_username", "user", "login", "email", "loginusername"],
  password: ["password", "login_password", "loginpassword"],
  note: ["note", "notes", "extra", "comments"],
  totp: ["totp", "login_totp", "otpauth", "otp", "logintotp"],
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  const src = text.replace(/^﻿/, "");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Which column holds what, from the header names. Null when there is no password column (or nothing to name it by). */
export function detectMapping(headers: string[]): Mapping | null {
  const map: Mapping = {};
  const names = headers.map(norm);
  for (const field of Object.keys(ALIASES) as Field[]) {
    const idx = names.findIndex((n) => ALIASES[field].includes(n) || ALIASES[field].includes(n.replace(/_/g, "")));
    if (idx >= 0) map[field] = idx;
  }
  if (map.password === undefined || (map.name === undefined && map.url === undefined)) return null;
  return map;
}

export interface ImportedLogin { name: string; url: string; username: string; password: string; note: string; totp: string }

/** The logins of a parsed file under a mapping. Rows without a password are skipped (a Bitwarden note, a card…). */
export function loginsFrom(rows: string[][], map: Mapping): { logins: ImportedLogin[]; skipped: number } {
  const get = (r: string[], f: Field) => (map[f] === undefined ? "" : (r[map[f]!] ?? "").trim());
  const logins: ImportedLogin[] = [];
  let skipped = 0;
  for (const r of rows) {
    const password = map.password === undefined ? "" : r[map.password] ?? "";
    const url = get(r, "url");
    let host = "";
    try { host = url ? new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "") : ""; } catch { /* keep empty */ }
    const name = get(r, "name") || host;
    if (!password || !name) { skipped++; continue; }
    logins.push({ name: name.slice(0, 80), url: url.slice(0, 300), username: get(r, "username").slice(0, 300), password, note: get(r, "note").slice(0, 500), totp: get(r, "totp") });
  }
  return { logins, skipped };
}
