import { Readable } from "node:stream";
import { tarStream } from "./tarstream.js";
import type { PageFile } from "./pagefiles.js";

/** Keep index.html and its relative asset paths together, including nested stylesheets and modules. */
export function exportArtifact(name: string, html: string, files: PageFile[]) {
  const headers = {
    "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "content-disposition": `attachment; filename="${name}.${files.length ? "tar" : "html"}"`,
    "content-type": files.length ? "application/x-tar" : "application/octet-stream",
  };
  if (!files.length) return new Response(html, { headers });
  const entries = [{ file: "index.html", content: html }, ...files].map(({ file, content }) => ({
    name: file, type: "file" as const, mode: 0o644, mtime: 0, data: Buffer.from(content),
  }));
  const stream = tarStream(entries, { files: 0, bytes: 0, changed: [] });
  return new Response(Readable.toWeb(Readable.from(stream)) as ReadableStream<Uint8Array>, { headers });
}
