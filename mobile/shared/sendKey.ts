/**
 * Send keys for the composer (web and mobile): one key per message being sent, and the SAME key again when that same
 * message is sent again after a failure. The server (server/src/sendkeys.ts) answers a key it has already seen with the
 * first message's row and starts nothing new — so a reply lost on a bad network never makes a second message or a
 * second turn. Changing the text or the files makes a new message, with a new key.
 */
export interface SendKeys {
  /** The key for the message described by `signature` (its text, files and options): kept while it stays the same. */
  keyFor(signature: string): string;
  /** The message went through: the next one gets a new key, even with the same words. */
  done(): void;
}

/** A plain random token (letters, digits, dashes), unique enough to tell two sends apart. */
export function randomKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  let out = Date.now().toString(36);
  while (out.length < 32) out += Math.floor(Math.random() * 0xffffffff).toString(36);
  return out.slice(0, 40);
}

export function createSendKeys(random: () => string = randomKey): SendKeys {
  let held: { signature: string; key: string } | null = null;
  return {
    keyFor(signature) {
      if (!held || held.signature !== signature) held = { signature, key: random() };
      return held.key;
    },
    done() { held = null; },
  };
}

const holders = new Map<string, SendKeys>();
/** The send keys of one place messages are written in (a bot's composer, a thread): one message at a time each. */
export function sendKeysFor(scope: string): SendKeys {
  let k = holders.get(scope);
  if (!k) { k = createSendKeys(); holders.set(scope, k); }
  return k;
}
