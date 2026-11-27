/**
 * « Doit marcher » (24/11): a web page in any encoding is read as its author wrote it. The charset comes from the
 * Content-Type header, else from the page's own <meta charset> / <meta http-equiv> in its first 2 kB, else a byte order
 * mark, else UTF-8 (WHATWG Encoding: https://encoding.spec.whatwg.org/#concept-encoding-get ; Node's TextDecoder knows
 * the WHATWG labels: https://nodejs.org/api/util.html#class-utiltextdecoder). An unknown label falls back to UTF-8, and
 * broken bytes become U+FFFD instead of failing (fatal: false); NUL characters are dropped.
 */
export function charsetOf(contentType: string, head: Buffer): string | null {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return "utf-8";
  if (head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  if (head[0] === 0xfe && head[1] === 0xff) return "utf-16be";
  if (!/html|xml/i.test(contentType) && contentType) return null;
  const start = head.subarray(0, 2048).toString("latin1");
  return /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(start)?.[1] ?? null;
}

export function decodeBytes(bytes: Buffer, contentType = ""): string {
  const label = charsetOf(contentType, bytes) ?? "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(label, { fatal: false }); } catch { decoder = new TextDecoder("utf-8", { fatal: false }); }
  return decoder.decode(bytes).replace(/\u0000/g, "");
}

/** A response's body as text, in its own encoding. */
export async function decodedText(res: Response): Promise<string> {
  return decodeBytes(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") ?? "");
}
