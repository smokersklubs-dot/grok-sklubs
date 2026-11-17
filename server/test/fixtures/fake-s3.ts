// A minimal S3-compatible server for the tests (path-style addressing only), in memory. It checks every request's
// Signature V4 (recomputed with the same canonical rules, after the AWS documentation vectors are checked separately)
// and that x-amz-content-sha256 is the real SHA-256 of the body. Implements PutObject, GetObject, DeleteObject,
// ListObjectsV2 (prefix, max-keys, continuation-token), and the multipart calls (create, upload part, complete, abort).
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { signV4 } from "../../src/s3.js";

export interface FakeS3 {
  url: string;
  bucket: string;
  objects: Map<string, Buffer>;
  /** Parts per completed multipart upload, by key. */
  multipartParts: Map<string, number>;
  requests: { method: string; path: string; query: string }[];
  /** Answer 500 to every write while true (PUT/POST). */
  failWrites: boolean;
  close(): Promise<void>;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const err = (res: http.ServerResponse, status: number, code: string, message: string) => {
  res.writeHead(status, { "content-type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xml(message)}</Message></Error>`);
};

export async function startFakeS3(o: { bucket: string; accessKey: string; secretKey: string; region: string }): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const state: Omit<FakeS3, "url" | "close"> = { bucket: o.bucket, objects, multipartParts: new Map(), requests: [], failWrites: false };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://x");
    state.requests.push({ method: req.method ?? "", path: url.pathname, query: url.search });
    // ── Signature check ──
    const auth = String(req.headers.authorization ?? "");
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
    if (!m) return err(res, 403, "AccessDenied", "no signature");
    if (m[1] !== o.accessKey) return err(res, 403, "InvalidAccessKeyId", "unknown key");
    const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
    if (payloadHash !== createHash("sha256").update(body).digest("hex")) return err(res, 400, "XAmzContentSHA256Mismatch", "payload hash");
    const amz = String(req.headers["x-amz-date"] ?? "");
    const date = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
    const signed: Record<string, string> = {};
    for (const h of m[4].split(";")) if (!["host", "x-amz-date", "x-amz-content-sha256", "authorization"].includes(h)) signed[h] = String(req.headers[h] ?? "");
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    const want = signV4({ method: req.method ?? "GET", host: String(req.headers.host), path: url.pathname, query, headers: signed, payloadHash, region: m[3], accessKey: o.accessKey, secretKey: o.secretKey, date });
    if (want.authorization !== auth || m[3] !== o.region) return err(res, 403, "SignatureDoesNotMatch", "signature");
    // ── Routing (path style: /bucket/key) ──
    const parts = url.pathname.split("/");
    if (decodeURIComponent(parts[1] ?? "") !== o.bucket) return err(res, 404, "NoSuchBucket", "no bucket");
    const key = parts.slice(2).map(decodeURIComponent).join("/");
    const method = req.method;
    if (state.failWrites && (method === "PUT" || method === "POST")) return err(res, 500, "InternalError", "storage down");
    if (!key && method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const max = Math.max(1, Number(url.searchParams.get("max-keys") ?? 1000));
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = url.searchParams.get("continuation-token") ? all.indexOf(Buffer.from(url.searchParams.get("continuation-token")!, "base64").toString()) : 0;
      const page = all.slice(start, start + Math.min(max, 2)); // small pages, to exercise pagination
      const next = all[start + page.length];
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${o.bucket}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${Buffer.from(next).toString("base64")}</NextContinuationToken>` : ""}${page.map((k) => `<Contents><Key>${xml(k)}</Key><LastModified>2026-11-17T00:00:00.000Z</LastModified><ETag>"x"</ETag><Size>${objects.get(k)!.length}</Size></Contents>`).join("")}</ListBucketResult>`);
    }
    if (!key) return err(res, 400, "InvalidRequest", "no key");
    if (method === "POST" && url.searchParams.has("uploads")) {
      const id = randomUUID();
      uploads.set(id, { key, parts: new Map() });
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<InitiateMultipartUploadResult><Bucket>${o.bucket}</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    const uploadId = url.searchParams.get("uploadId");
    if (uploadId) {
      const up = uploads.get(uploadId);
      if (!up || up.key !== key) return err(res, 404, "NoSuchUpload", "no upload");
      if (method === "PUT") {
        const n = Number(url.searchParams.get("partNumber"));
        up.parts.set(n, body);
        res.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"` });
        return res.end();
      }
      if (method === "POST") {
        const listed = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag>/g)].map((x) => ({ n: Number(x[1]), etag: x[2].replace(/&quot;/g, '"') }));
        for (const p of listed) if (!up.parts.has(p.n) || `"${createHash("md5").update(up.parts.get(p.n)!).digest("hex")}"` !== p.etag) return err(res, 400, "InvalidPart", "bad part");
        objects.set(key, Buffer.concat(listed.sort((a, b) => a.n - b.n).map((p) => up.parts.get(p.n)!)));
        state.multipartParts.set(key, listed.length);
        uploads.delete(uploadId);
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end(`<CompleteMultipartUploadResult><Key>${xml(key)}</Key></CompleteMultipartUploadResult>`);
      }
      if (method === "DELETE") { uploads.delete(uploadId); res.writeHead(204); return res.end(); }
    }
    if (method === "PUT") { objects.set(key, body); res.writeHead(200, { etag: '"x"' }); return res.end(); }
    if (method === "GET") {
      const obj = objects.get(key);
      if (!obj) return err(res, 404, "NoSuchKey", "no key");
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(obj.length) });
      return res.end(obj);
    }
    if (method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
    return err(res, 405, "MethodNotAllowed", "method");
  });
  const port: number = await new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  return Object.assign(state, { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }) as FakeS3;
}
