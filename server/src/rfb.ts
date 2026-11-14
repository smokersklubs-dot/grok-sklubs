/**
 * Reads what a VNC viewer sends to the screen server (the client → server half of the RFB protocol,
 * RFC 6143), to notice pointer and key events while the user demonstrates a task. It only watches: the
 * bytes are passed on untouched by the proxy whatever happens here.
 *
 * Handshake from the client (RFC 6143 §7.1–7.3): ProtocolVersion (12 bytes), then for 3.7/3.8 one byte
 * choosing the security type (2 = VNC authentication is followed by a 16-byte response), then ClientInit
 * (1 byte). Then messages (§7.5), each starting with a type byte:
 *   0 SetPixelFormat  20 bytes            1 (unused)
 *   2 SetEncodings    4 + 4·n             3 FramebufferUpdateRequest 10 bytes
 *   4 KeyEvent        8 (down-flag, keysym u32)
 *   5 PointerEvent    6 (button-mask, x u16, y u16)
 *   6 ClientCutText   8 + length (a negative length is an Extended Clipboard message of |length| bytes)
 * and common extensions: 150 EnableContinuousUpdates 10 bytes, 248 Fence 9 + length,
 * 251 SetDesktopSize 8 + 16·screens, 255 QEMU (submessage 0: extended key event, 12 bytes;
 * submessage 1: audio, 4 or 8 bytes). On anything it does not know, the parser stops reading for good
 * rather than guess (the stream keeps flowing).
 */
export type RfbEvent = { type: "pointer"; buttons: number; x: number; y: number } | { type: "key"; down: boolean; keysym: number };

export class RfbClientParser {
  private buf = Buffer.alloc(0);
  private stage: "version" | "security" | "auth" | "init" | "messages" | "lost" = "version";
  private minor = 8;

  /** Feeds the next chunk sent by the viewer; returns the input events it completed. */
  push(chunk: Buffer): RfbEvent[] {
    if (this.stage === "lost") return [];
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    if (this.buf.length > 1_000_000) { this.stage = "lost"; this.buf = Buffer.alloc(0); return []; }
    const out: RfbEvent[] = [];
    for (;;) {
      const used = this.step(out);
      if (used <= 0) break;
      this.buf = this.buf.subarray(used);
    }
    return out;
  }

  get lost() { return this.stage === "lost"; }

  /** Consumes one item from the buffer; returns the bytes used (0 = wait for more). */
  private step(out: RfbEvent[]): number {
    const b = this.buf;
    switch (this.stage) {
      case "version": {
        if (b.length < 12) return 0;
        const m = /^RFB (\d{3})\.(\d{3})\n$/.exec(b.subarray(0, 12).toString("latin1"));
        if (!m) { this.stage = "lost"; return 0; }
        this.minor = Number(m[2]);
        this.stage = this.minor >= 7 ? "security" : "init";
        return 12;
      }
      case "security": {
        if (b.length < 1) return 0;
        this.stage = b[0] === 2 ? "auth" : "init";
        return 1;
      }
      case "auth": {
        if (b.length < 16) return 0;
        this.stage = "init";
        return 16;
      }
      case "init": {
        if (b.length < 1) return 0;
        this.stage = "messages";
        return 1;
      }
      case "messages": return this.message(b, out);
      default: return 0;
    }
  }

  private message(b: Buffer, out: RfbEvent[]): number {
    if (b.length < 1) return 0;
    const need = (n: number) => (b.length >= n ? n : 0);
    switch (b[0]) {
      case 0: return need(20);
      case 2: return b.length < 4 ? 0 : need(4 + 4 * b.readUInt16BE(2));
      case 3: return need(10);
      case 4: {
        if (b.length < 8) return 0;
        out.push({ type: "key", down: b[1] !== 0, keysym: b.readUInt32BE(4) });
        return 8;
      }
      case 5: {
        if (b.length < 6) return 0;
        out.push({ type: "pointer", buttons: b[1], x: b.readUInt16BE(2), y: b.readUInt16BE(4) });
        return 6;
      }
      // The length is signed: negative means an Extended Clipboard message of |length| bytes (RFB community extension, sent by noVNC).
      case 6: return b.length < 8 ? 0 : need(8 + Math.abs(b.readInt32BE(4)));
      case 150: return need(10);
      case 248: return b.length < 9 ? 0 : need(9 + b[8]);
      case 251: return b.length < 8 ? 0 : need(8 + 16 * b[6]);
      case 255: {
        if (b.length < 2) return 0;
        if (b[1] === 0) {
          // QEMU extended key event: down-flag u16, keysym u32, keycode u32.
          if (b.length < 12) return 0;
          out.push({ type: "key", down: b.readUInt16BE(2) !== 0, keysym: b.readUInt32BE(4) });
          return 12;
        }
        if (b[1] === 1) { if (b.length < 4) return 0; return need(b.readUInt16BE(2) === 2 ? 10 : 4); }
        this.stage = "lost";
        return 0;
      }
      default:
        this.stage = "lost";
        return 0;
    }
  }
}

/** X keysyms of keys worth naming in a demonstration (everything else that prints is only counted). */
const NAMED: Record<number, string> = {
  0xff0d: "Enter", 0xff8d: "Enter", 0xff09: "Tab", 0xff1b: "Escape", 0xff08: "Backspace", 0xffff: "Delete",
  0xff51: "Left", 0xff52: "Up", 0xff53: "Right", 0xff54: "Down", 0xff55: "PageUp", 0xff56: "PageDown", 0xff50: "Home", 0xff57: "End",
  0xffbe: "F1", 0xffbf: "F2", 0xffc0: "F3", 0xffc1: "F4", 0xffc2: "F5", 0xffc3: "F6", 0xffc4: "F7", 0xffc5: "F8", 0xffc6: "F9", 0xffc7: "F10", 0xffc8: "F11", 0xffc9: "F12",
};
export const MODIFIERS: Record<number, "shift" | "ctrl" | "alt" | "super"> = {
  0xffe1: "shift", 0xffe2: "shift", 0xffe3: "ctrl", 0xffe4: "ctrl", 0xffe9: "alt", 0xffea: "alt", 0xffe7: "alt", 0xffe8: "alt", 0xffeb: "super", 0xffec: "super",
};

/**
 * What may be kept of a key press, given the modifiers held. Printable characters are never kept — only
 * that one was typed — so a password typed during a demonstration leaves no trace. A shortcut (ctrl/alt/super
 * + a key) is kept by name, since it is part of the procedure ("ctrl+l").
 */
export function describeKey(keysym: number, held: Set<string>): { kind: "named"; name: string } | { kind: "typed" } | { kind: "ignore" } {
  if (MODIFIERS[keysym]) return { kind: "ignore" };
  const mods = ["ctrl", "alt", "super"].filter((m) => held.has(m));
  const named = NAMED[keysym];
  if (named) return { kind: "named", name: [...mods, ...(held.has("shift") && mods.length ? ["shift"] : []), named].join("+") };
  const printable = (keysym >= 0x20 && keysym <= 0x7e) || (keysym >= 0xa0 && keysym <= 0xff) || (keysym >= 0x1000100 && keysym <= 0x110ffff);
  if (!printable) return { kind: "ignore" };
  if (mods.length) {
    const ch = keysym <= 0xff ? String.fromCharCode(keysym).toLowerCase() : "?";
    return { kind: "named", name: [...mods, ch].join("+") };
  }
  return { kind: "typed" };
}
