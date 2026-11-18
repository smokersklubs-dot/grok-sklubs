/** The web and native clients both use the server's part size, retrying at the same byte offset. */
export async function sendFileParts<T, P>(size: number, session: { id: string; partBytes: number }, io: {
  read(offset: number, end: number): P | Promise<P>;
  send(id: string, offset: number, part: P): Promise<{ received?: number; attachment?: unknown }>;
  cancel(id: string): Promise<unknown>;
  progress?(percent: number): void;
}): Promise<T> {
  const { id, partBytes } = session;
  try {
    if (!id || !Number.isSafeInteger(partBytes) || partBytes <= 0 || partBytes > 16_000_000) throw new Error("Invalid upload session.");
    let offset = 0;
    while (offset < size) {
      const end = Math.min(size, offset + partBytes);
      const part = await io.read(offset, end);
      const retryUntil = Date.now() + 90_000;
      for (let attempt = 0;; attempt++) {
        try {
          const reply = await io.send(id, offset, part);
          if (end === size && reply.attachment) { io.progress?.(100); return reply as T; }
          if (reply.received !== end) throw new Error("Unexpected upload receipt.");
          break;
        } catch (err) {
          const status = (err as { status?: number })?.status;
          const transient = status === 0 || status === 408 || status === 429 || (status !== undefined && status >= 500 && status !== 507);
          if (!transient || Date.now() >= retryUntil) throw err;
          await new Promise<void>(resolve => setTimeout(resolve, Math.min(10_000, 1000 * 2 ** attempt)));
        }
      }
      offset = end;
      io.progress?.(Math.floor(100 * offset / size));
    }
    throw new Error("Missing upload receipt.");
  } catch (err) {
    await io.cancel(id).catch(() => {});
    throw err;
  }
}
