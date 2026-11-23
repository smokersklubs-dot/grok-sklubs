/**
 * Operational transformation of plain text (L178 « Document partagé »), shared by the server (docs/livedoc.ts) and the
 * web editor (web/src/components/LiveDoc.tsx).
 *
 * Portions adapted from Operational-Transformation/ot.js (https://github.com/Operational-Transformation/ot.js, commit
 * e9a3a0e214dd6c001e25515274bae0842a8415f2), Copyright © 2012-2014 Tim Baumann, MIT licence: lib/text-operation.js
 * (TextOperation: retain / insert / delete, apply, invert, compose, transform) and lib/client.js (the three client
 * states: synchronized, awaiting confirm, awaiting with buffer). Modified for Sklubot: rewritten in TypeScript as a
 * class plus pure client-state functions; no shouldBeComposedWith / undo-manager / socket adapters (the server keeps the
 * history and undo); `fromJSON` validates its input (an operation comes from the network); `diffOp` added (one edit
 * from two texts, by common prefix and suffix).
 *
 * An operation walks the whole document: a positive number keeps that many characters, a string inserts it, a negative
 * number deletes that many. Lengths are JavaScript string lengths (UTF-16 code units) on both sides.
 */
export type Op = number | string;
const isRetain = (op: Op | undefined): op is number => typeof op === "number" && op > 0;
const isInsert = (op: Op | undefined): op is string => typeof op === "string";
const isDelete = (op: Op | undefined): op is number => typeof op === "number" && op < 0;

export class TextOp {
  ops: Op[] = [];
  baseLength = 0;
  targetLength = 0;

  retain(n: number): this {
    if (!Number.isInteger(n) || n < 0) throw new Error("retain expects a positive integer");
    if (n === 0) return this;
    this.baseLength += n; this.targetLength += n;
    const last = this.ops[this.ops.length - 1];
    if (isRetain(last)) this.ops[this.ops.length - 1] = last + n; else this.ops.push(n);
    return this;
  }

  insert(str: string): this {
    if (typeof str !== "string") throw new Error("insert expects a string");
    if (str === "") return this;
    this.targetLength += str.length;
    const ops = this.ops, last = ops[ops.length - 1];
    if (isInsert(last)) ops[ops.length - 1] = last + str;
    else if (isDelete(last)) {
      // An insert and a delete at the same place: the insert always comes first.
      const before = ops[ops.length - 2];
      if (isInsert(before)) ops[ops.length - 2] = before + str;
      else { ops[ops.length] = last; ops[ops.length - 2] = str; }
    } else ops.push(str);
    return this;
  }

  delete(n: number | string): this {
    let k = typeof n === "string" ? n.length : n;
    if (!Number.isInteger(k)) throw new Error("delete expects an integer or a string");
    if (k === 0) return this;
    if (k > 0) k = -k;
    this.baseLength -= k;
    const last = this.ops[this.ops.length - 1];
    if (isDelete(last)) this.ops[this.ops.length - 1] = last + k; else this.ops.push(k);
    return this;
  }

  isNoop() { return this.ops.length === 0 || (this.ops.length === 1 && isRetain(this.ops[0])); }
  toJSON(): Op[] { return this.ops; }
  equals(o: TextOp) { return this.baseLength === o.baseLength && this.targetLength === o.targetLength && this.ops.length === o.ops.length && this.ops.every((x, i) => x === o.ops[i]); }

  /** From the network: a list of integers and strings, at most `maxOps` of them. Throws on anything else. */
  static fromJSON(raw: unknown, maxOps = 10_000): TextOp {
    if (!Array.isArray(raw) || raw.length > maxOps) throw new Error("an operation is a list");
    const o = new TextOp();
    for (const op of raw) {
      if (isRetain(op) && Number.isInteger(op)) o.retain(op);
      else if (isInsert(op)) o.insert(op);
      else if (isDelete(op) && Number.isInteger(op)) o.delete(op);
      else throw new Error("unknown operation part");
    }
    return o;
  }

  apply(str: string): string {
    if (str.length !== this.baseLength) throw new Error("The operation's base length must be equal to the string's length.");
    const out: string[] = [];
    let i = 0;
    for (const op of this.ops) {
      if (isRetain(op)) { if (i + op > str.length) throw new Error("Operation can't retain more characters than are left in the string."); out.push(str.slice(i, i + op)); i += op; }
      else if (isInsert(op)) out.push(op);
      else i -= op;
    }
    if (i !== str.length) throw new Error("The operation didn't operate on the whole string.");
    return out.join("");
  }

  /** The operation that undoes this one, given the text it applied to. */
  invert(str: string): TextOp {
    let i = 0;
    const inv = new TextOp();
    for (const op of this.ops) {
      if (isRetain(op)) { inv.retain(op); i += op; }
      else if (isInsert(op)) inv.delete(op.length);
      else { inv.insert(str.slice(i, i - op)); i -= op; }
    }
    return inv;
  }

  /** One operation with the effect of this one then `b`. */
  compose(b: TextOp): TextOp {
    if (this.targetLength !== b.baseLength) throw new Error("The base length of the second operation has to be the target length of the first operation");
    const out = new TextOp();
    const ops1 = this.ops, ops2 = b.ops;
    let i1 = 0, i2 = 0;
    // Untyped on purpose: the guards below are value tests (a delete is a number too), not type narrowing.
    let op1: any = ops1[i1++], op2: any = ops2[i2++];
    for (;;) {
      if (op1 === undefined && op2 === undefined) break;
      if (isDelete(op1)) { out.delete(op1); op1 = ops1[i1++]; continue; }
      if (isInsert(op2)) { out.insert(op2); op2 = ops2[i2++]; continue; }
      if (op1 === undefined) throw new Error("Cannot compose operations: first operation is too short.");
      if (op2 === undefined) throw new Error("Cannot compose operations: first operation is too long.");
      if (isRetain(op1) && isRetain(op2)) {
        if (op1 > op2) { out.retain(op2); op1 -= op2; op2 = ops2[i2++]; }
        else if (op1 === op2) { out.retain(op1); op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { out.retain(op1); op2 -= op1; op1 = ops1[i1++]; }
      } else if (isInsert(op1) && isDelete(op2)) {
        if (op1.length > -op2) { op1 = op1.slice(-op2); op2 = ops2[i2++]; }
        else if (op1.length === -op2) { op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { op2 += op1.length; op1 = ops1[i1++]; }
      } else if (isInsert(op1) && isRetain(op2)) {
        if (op1.length > op2) { out.insert(op1.slice(0, op2)); op1 = op1.slice(op2); op2 = ops2[i2++]; }
        else if (op1.length === op2) { out.insert(op1); op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { out.insert(op1); op2 -= op1.length; op1 = ops1[i1++]; }
      } else if (isRetain(op1) && isDelete(op2)) {
        if (op1 > -op2) { out.delete(op2); op1 += op2; op2 = ops2[i2++]; }
        else if (op1 === -op2) { out.delete(op2); op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { out.delete(op1); op2 += op1; op1 = ops1[i1++]; }
      } else throw new Error("This shouldn't happen");
    }
    return out;
  }

  /**
   * Two operations made on the same text at the same time → [a', b'] with apply(apply(s, a), b') = apply(apply(s, b), a').
   * When both insert at the same place, `a`'s text comes first (the server passes the incoming one as `a`).
   */
  static transform(a: TextOp, b: TextOp): [TextOp, TextOp] {
    if (a.baseLength !== b.baseLength) throw new Error("Both operations have to have the same base length");
    const a1 = new TextOp(), b1 = new TextOp();
    const ops1 = a.ops, ops2 = b.ops;
    let i1 = 0, i2 = 0;
    // Untyped on purpose: the guards below are value tests (a delete is a number too), not type narrowing.
    let op1: any = ops1[i1++], op2: any = ops2[i2++];
    for (;;) {
      if (op1 === undefined && op2 === undefined) break;
      if (isInsert(op1)) { a1.insert(op1); b1.retain(op1.length); op1 = ops1[i1++]; continue; }
      if (isInsert(op2)) { a1.retain(op2.length); b1.insert(op2); op2 = ops2[i2++]; continue; }
      if (op1 === undefined) throw new Error("Cannot transform operations: first operation is too short.");
      if (op2 === undefined) throw new Error("Cannot transform operations: first operation is too long.");
      let minl: number;
      if (isRetain(op1) && isRetain(op2)) {
        if (op1 > op2) { minl = op2; op1 -= op2; op2 = ops2[i2++]; }
        else if (op1 === op2) { minl = op2; op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { minl = op1; op2 -= op1; op1 = ops1[i1++]; }
        a1.retain(minl); b1.retain(minl);
      } else if (isDelete(op1) && isDelete(op2)) {
        // Both delete the same text: nothing to do but skip it.
        if (-op1 > -op2) { op1 -= op2; op2 = ops2[i2++]; }
        else if (op1 === op2) { op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { op2 -= op1; op1 = ops1[i1++]; }
      } else if (isDelete(op1) && isRetain(op2)) {
        if (-op1 > op2) { minl = op2; op1 += op2; op2 = ops2[i2++]; }
        else if (-op1 === op2) { minl = op2; op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { minl = -op1; op2 += op1; op1 = ops1[i1++]; }
        a1.delete(minl);
      } else if (isRetain(op1) && isDelete(op2)) {
        if (op1 > -op2) { minl = -op2; op1 += op2; op2 = ops2[i2++]; }
        else if (op1 === -op2) { minl = op1; op1 = ops1[i1++]; op2 = ops2[i2++]; }
        else { minl = op1; op2 += op1; op1 = ops1[i1++]; }
        b1.delete(minl);
      } else throw new Error("The two operations aren't compatible");
    }
    return [a1, b1];
  }
}

/** One operation that turns `before` into `after` (common start and end kept, the middle replaced). */
export function diffOp(before: string, after: string): TextOp {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return new TextOp().retain(start).delete(before.length - start - end).insert(after.slice(start, after.length - end)).retain(end);
}

/**
 * The client side (ot.js lib/client.js): at most one operation in flight; edits made meanwhile wait in a buffer.
 * Pure: each function returns the new state and what to send / apply.
 */
export interface ClientState { revision: number; inflight: TextOp | null; buffer: TextOp | null }
export const newClient = (revision: number): ClientState => ({ revision, inflight: null, buffer: null });

/** The user edited: send it now if nothing is in flight, else keep it in the buffer. */
export function clientEdit(s: ClientState, op: TextOp): { state: ClientState; send: TextOp | null } {
  if (!s.inflight) return { state: { ...s, inflight: op }, send: op };
  return { state: { ...s, buffer: s.buffer ? s.buffer.compose(op) : op }, send: null };
}
/** The server confirmed our operation: the buffer (if any) goes next. */
export function clientAck(s: ClientState): { state: ClientState; send: TextOp | null } {
  const next = s.buffer;
  return { state: { revision: s.revision + 1, inflight: next, buffer: null }, send: next };
}
/** Someone else's operation: transformed against ours in flight and buffered, then applied to the editor. */
export function clientRemote(s: ClientState, op: TextOp): { state: ClientState; apply: TextOp } {
  let inflight = s.inflight, buffer = s.buffer, x = op;
  if (inflight) { const [i1, x1] = TextOp.transform(inflight, x); inflight = i1; x = x1; }
  if (buffer) { const [b1, x2] = TextOp.transform(buffer, x); buffer = b1; x = x2; }
  return { state: { revision: s.revision + 1, inflight, buffer }, apply: x };
}

/** Where a cursor at `index` goes after `op` (someone else's change): pushed by text inserted before it, pulled back by text deleted before it. */
export function transformIndex(op: TextOp, index: number): number {
  let pos = 0, out = index;
  for (const o of op.ops) {
    if (typeof o === "number" && o > 0) pos += o;
    else if (typeof o === "string") { if (pos < out) out += o.length; pos += o.length; }
    else { const n = -(o as number); if (pos < out) out -= Math.min(n, out - pos); }
  }
  return out;
}
