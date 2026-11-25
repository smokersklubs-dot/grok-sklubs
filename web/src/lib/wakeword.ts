/**
 * L154 « mot de réveil » (backlog A-FAIRE): with the app open on a bot's chat, saying « Salut <nom du bot> » (or « Ok
 * Sklubot ») starts a call with that bot, hands free. Opt-in, per device, off by default, and LOCAL only: the browser must
 * recognise speech on the device itself — the Web Speech API's `processLocally` ("the speech recognition process MUST be
 * performed locally on the user's device") with `SpeechRecognition.available({ langs, processLocally: true })` answering
 * "available" (https://webaudio.github.io/web-speech-api/, §4.1). A browser that can only send the sound to an online
 * service never listens for the wake word. "downloadable": the language pack can be installed first
 * (`SpeechRecognition.install`, same section), on the owner's click.
 *
 * This file has the pure parts (phrases, matching, the per-device choice, the availability check); the listener is in
 * wakelisten.ts.
 */
export const WAKE_KEY = "sklubot.wakeWord";
export type LocalStatus = "available" | "downloadable" | "downloading" | "unavailable";

/** Lower case, no accents, no punctuation, single spaces. */
export const loose = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The phrases that wake this bot: a greeting with its name, or « Ok Sklubot ». */
export function wakePhrases(botName: string): string[] {
  const name = loose(botName);
  const out = ["ok sklubot", "okay sklubot", "hey sklubot", "salut sklubot"];
  if (name.length >= 2) for (const g of ["salut", "hey", "he", "ok", "okay", "dis", "bonjour", "hello", "hi"]) out.push(`${g} ${name}`);
  return out;
}

/** Whether what was heard contains a wake phrase for this bot (as whole words). */
export function heardWake(heard: string, botName: string): boolean {
  const said = ` ${loose(heard)} `;
  return wakePhrases(botName).some((p) => said.includes(` ${p} `));
}

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const store = (): Store | null => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };
export function wakeEnabled(): boolean { try { return store()?.getItem(WAKE_KEY) === "1"; } catch { return false; } }
export function setWakeEnabled(on: boolean): void {
  try { if (on) store()?.setItem(WAKE_KEY, "1"); else store()?.removeItem(WAKE_KEY); } catch { /* blocked storage: stays off */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("sklubot:wakeword"));
}

type Ctor = { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>; install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean> };
function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can recognise `lang` on the device itself. Anything unexpected counts as "unavailable". */
export async function localStatus(lang: string, c: Ctor | null = ctor()): Promise<LocalStatus> {
  if (!c || typeof c.available !== "function") return "unavailable";
  try {
    const s = await c.available({ langs: [lang], processLocally: true });
    return s === "available" || s === "downloadable" || s === "downloading" ? s : "unavailable";
  } catch { return "unavailable"; }
}

/** Installs the language pack for on-device recognition (only from a click: the spec refuses a download otherwise). */
export async function installLocal(lang: string, c: Ctor | null = ctor()): Promise<boolean> {
  if (!c || typeof c.install !== "function") return false;
  try { return await c.install({ langs: [lang], processLocally: true }); } catch { return false; }
}
