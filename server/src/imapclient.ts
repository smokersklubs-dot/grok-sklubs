/**
 * L162 + OpenClaw E11: a small, read-only IMAP4rev1 client (RFC 3501, https://www.rfc-editor.org/rfc/rfc3501) — just
 * what reading new messages of an existing mailbox needs, without a new dependency:
 *   LOGIN (6.2.3, quoted strings 4.3), EXAMINE (6.3.2: read-only, so nothing in the mailbox ever changes; UIDVALIDITY and
 *   UIDNEXT response codes 7.1), UID SEARCH UID n:* (6.4.4, 6.4.8), UID FETCH … (UID RFC822.SIZE) and BODY.PEEK[] (6.4.5:
 *   PEEK does not set \Seen), LOGOUT (6.1.3). Literals {n} in responses (4.3) are read byte-exact.
 * TLS from the first byte (port 993, "imaps", RFC 8314 section 3.2); the certificate is checked against the host name.
 */
import net from "node:net";
import tls from "node:tls";

export interface ImapTarget { host: string; port: number; address: string; tls: boolean; timeoutMs?: number }
export class ImapError extends Error { constructor(msg: string, readonly auth = false) { super(msg); } }

interface Unit { text: string; literals: Buffer[] }

/** Quoted string (RFC 3501 4.3): only printable ASCII without CR/LF; " and \ escaped. */
export function quoted(s: string): string {
  if (!/^[\x20-\x7e]*$/.test(s)) throw new ImapError("Only plain characters (no accents, no line breaks) can be sent to this IMAP server.");
  return `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

export class ImapClient {
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private units: Unit[] = [];
  private current: Unit | null = null;
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  private tag = 0;

  async open(t: ImapTarget): Promise<void> {
    const timeout = t.timeoutMs ?? 30_000;
    this.sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = t.tls
        ? tls.connect({ host: t.address, port: t.port, servername: net.isIP(t.host) ? undefined : t.host, rejectUnauthorized: true }, () => resolve(s))
        : net.connect({ host: t.address, port: t.port }, () => resolve(s));
      s.once("error", reject);
      s.setTimeout(timeout, () => s.destroy(new ImapError("The IMAP server did not answer in time.")));
    });
    this.sock.on("data", (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    this.sock.on("error", (e) => { this.failure = e; this.wake?.(); });
    this.sock.on("close", () => { this.failure ??= new ImapError("The IMAP server closed the connection."); this.wake?.(); });
    const hello = await this.next();
    if (!/^\* (OK|PREAUTH)/i.test(hello.text)) throw new ImapError("This is not an IMAP server that accepts us.");
  }

  /** Splits what arrived into response units: a line, with any literals it announces read byte for byte. */
  private parse() {
    if (this.buf.length > 64 * 1024 * 1024) { this.failure = new ImapError("The IMAP answer is too large."); this.sock?.destroy(); return; }
    for (;;) {
      const nl = this.buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = this.buf.subarray(0, nl).toString("latin1");
      const lit = /\{(\d+)\}$/.exec(line);
      if (lit) {
        const n = Number(lit[1]);
        if (this.buf.length < nl + 2 + n) return; // wait for the whole literal
        const unit = this.current ?? { text: "", literals: [] };
        unit.text += line;
        unit.literals.push(Buffer.from(this.buf.subarray(nl + 2, nl + 2 + n)));
        this.current = unit;
        this.buf = this.buf.subarray(nl + 2 + n);
        continue;
      }
      const unit = this.current ?? { text: "", literals: [] };
      unit.text += line;
      this.current = null;
      this.buf = this.buf.subarray(nl + 2);
      this.units.push(unit);
      this.wake?.();
    }
  }

  private async next(): Promise<Unit> {
    for (;;) {
      const u = this.units.shift();
      if (u) return u;
      if (this.failure) throw this.failure;
      await new Promise<void>((r) => { this.wake = r; });
      this.wake = null;
    }
  }

  /** Sends one command; resolves with the untagged answers once the tagged OK comes (NO / BAD throw). */
  async command(cmd: string): Promise<Unit[]> {
    if (!this.sock) throw new ImapError("not connected");
    const tag = `s${++this.tag}`;
    this.sock.write(`${tag} ${cmd}\r\n`);
    const out: Unit[] = [];
    for (;;) {
      const u = await this.next();
      if (u.text.startsWith(`${tag} `)) {
        const m = /^\S+ (OK|NO|BAD)\b ?(.*)$/i.exec(u.text);
        if (m?.[1].toUpperCase() === "OK") return out;
        const why = (m?.[2] ?? "").replace(/^\[[^\]]*\]\s*/, "").slice(0, 200);
        throw new ImapError(why || "The IMAP server refused.", /AUTHENTICATIONFAILED|LOGIN|AUTH/i.test(u.text) && cmd.startsWith("LOGIN"));
      }
      out.push(u);
    }
  }

  async login(user: string, pass: string) { await this.command(`LOGIN ${quoted(user)} ${quoted(pass)}`); }

  /** Opens the mailbox read-only: its UIDVALIDITY and UIDNEXT. */
  async examine(mailbox: string): Promise<{ uidValidity: number; uidNext: number }> {
    const units = await this.command(`EXAMINE ${quoted(mailbox)}`);
    const code = (name: string) => Number(units.map((u) => new RegExp(`\\[${name} (\\d+)\\]`, "i").exec(u.text)?.[1]).find(Boolean) ?? 0);
    return { uidValidity: code("UIDVALIDITY"), uidNext: code("UIDNEXT") };
  }

  /** UIDs above `after` (n:* always names the last message too, so it is filtered). */
  async uidsAfter(after: number): Promise<number[]> {
    const units = await this.command(`UID SEARCH UID ${after + 1}:*`);
    const found = units.flatMap((u) => (/^\* SEARCH\b(.*)$/i.exec(u.text)?.[1] ?? "").trim().split(/\s+/)).map(Number).filter((n) => Number.isInteger(n) && n > after);
    return [...new Set(found)].sort((a, b) => a - b);
  }

  async sizes(uids: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!uids.length) return out;
    for (const u of await this.command(`UID FETCH ${uids.join(",")} (UID RFC822.SIZE)`)) {
      const uid = Number(/\bUID (\d+)/i.exec(u.text)?.[1]);
      const size = Number(/\bRFC822\.SIZE (\d+)/i.exec(u.text)?.[1]);
      if (uid) out.set(uid, size || 0);
    }
    return out;
  }

  /** The whole message (BODY.PEEK[]: not marked as read). */
  async message(uid: number): Promise<Buffer | null> {
    for (const u of await this.command(`UID FETCH ${uid} (UID BODY.PEEK[])`)) {
      if (Number(/\bUID (\d+)/i.exec(u.text)?.[1]) === uid && u.literals.length) return u.literals[0];
    }
    return null;
  }

  async close() {
    try { if (this.sock && !this.failure) await Promise.race([this.command("LOGOUT"), new Promise((r) => setTimeout(r, 2000))]); } catch { /* closing anyway */ }
    this.sock?.destroy();
    this.sock = null;
  }
}
