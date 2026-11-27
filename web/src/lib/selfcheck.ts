/**
 * L153 « Vérifier ce bot » (pure, tested in scripts/selfcheck.test.mjs; server: server/src/selfcheck.ts). The one-time
 * word, the message that asks the bot to use its real tools (read a page of this server, save a file holding the word,
 * read it back), and the three lines shown while it works: page, file, journal.
 */
export const SELFCHECK_FILE = "sklubot-verification.txt";
/** How long the check waits for the bot before saying it did not finish (ms). */
export const SELFCHECK_TIMEOUT = 5 * 60_000;

/** A one-time word like SKB-7K2Q9D (from `random`, 0–1; crypto in the app). */
export function selfCheckToken(random: () => number): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "SKB-";
  for (let i = 0; i < 8; i++) s += A[Math.floor(random() * A.length) % A.length];
  return s;
}

/** The message sent to the bot: three steps with its real tools, then a one-line report. */
export function selfCheckMessage(lang: string, token: string, pageUrl: string): string {
  return lang === "fr"
    ? `Vérification de tes outils (demandée depuis « Vérifier ce bot ») :\n1. Lis la page ${pageUrl} avec ton outil de lecture de page (web_fetch).\n2. Enregistre un fichier « ${SELFCHECK_FILE} » dans tes fichiers, qui contient seulement : ${token}\n3. Relis ce fichier et vérifie qu'il contient bien ${token}.\nPuis réponds en une ligne : ce qui a marché et ce qui n'a pas marché. Ne fais rien d'autre.`
    : `Tool check (asked from "Check this bot"):\n1. Read the page ${pageUrl} with your page reading tool (web_fetch).\n2. Save a file "${SELFCHECK_FILE}" in your files, containing only: ${token}\n3. Read that file back and check it holds ${token}.\nThen answer in one line: what worked and what did not. Do nothing else.`;
}

export type CheckState = "wait" | "ok" | "fail";
export interface CheckReport { file: "match" | "other" | "missing"; page: boolean; journal: { status: string }[] }

/** The three lines: page read, file written and read back, journal lines seen; « fail » once the time is up. */
export function selfCheckLines(r: CheckReport | null, elapsedMs: number): { page: CheckState; file: CheckState; journal: CheckState; done: boolean } {
  const over = elapsedMs >= SELFCHECK_TIMEOUT;
  const page: CheckState = r?.page ? "ok" : over ? "fail" : "wait";
  const file: CheckState = r?.file === "match" ? "ok" : r?.file === "other" || over ? "fail" : "wait";
  const journal: CheckState = r && r.journal.length > 0 ? (r.journal.some((j) => j.status === "failed" || j.status === "denied") ? "fail" : "ok") : over ? "fail" : "wait";
  return { page, file, journal, done: over || (page !== "wait" && file !== "wait" && journal !== "wait") };
}
