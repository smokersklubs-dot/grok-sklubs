/**
 * A small S3 client for the in-app backup (autobackup.ts): just the calls it needs, signed with AWS Signature
 * Version 4, so no SDK is added to the image (the official @aws-sdk/client-s3 + @aws-sdk/lib-storage bring several
 * megabytes of dependencies for these eight calls).
 *
 * Sources (Amazon S3 API reference, the format every S3-compatible provider implements):
 *  - Signature V4, Authorization header: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 *    (canonical request = method, URI-encoded path, sorted & encoded query, lower-case sorted headers, signed header
 *    list, payload SHA-256; string to sign = "AWS4-HMAC-SHA256", date, scope, SHA-256 of the canonical request; key =
 *    HMAC chain "AWS4"+secret → date → region → "s3" → "aws4_request"). The x-amz-content-sha256 header carries the
 *    payload's real SHA-256 (every part is in memory when it is sent, so no UNSIGNED-PAYLOAD is needed). The tests check
 *    this against the GET Object example of that page.
 *  - PutObject  https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
 *  - GetObject  https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
 *  - DeleteObject https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
 *  - ListObjectsV2 (GET /?list-type=2&prefix=…&continuation-token=…) https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
 *  - CreateMultipartUpload (POST /key?uploads) https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateMultipartUpload.html
 *  - UploadPart (PUT /key?partNumber=N&uploadId=…, answers an ETag) https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPart.html
 *  - CompleteMultipartUpload (POST /key?uploadId=…, may answer 200 with an <Error> body)
 *    https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html
 *  - AbortMultipartUpload (DELETE /key?uploadId=…) https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html
 *  - Part sizes: 5 MiB minimum except the last, at most 10,000 parts: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
 *
 * Addressing: "virtual-hosted" (https://bucket.endpoint/key) is what OVHcloud, Hetzner and Scaleway document; "path"
 * (https://endpoint/bucket/key) suits MinIO, a local test server, or bucket names with dots.
 */
import { createHash, createHmac } from "node:crypto";
import { Writable } from "node:stream";

export interface S3Config {
  endpoint: string; // https://s3.gra.io.cloud.ovh.net
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
}
export interface S3Object { key: string; size: number; lastModified: string }
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class S3Error extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "S3Error"; }
}

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();
/** RFC 3986 encoding as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ is %XX (upper case). */
export function uriEncode(s: string, keepSlash = false): string {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? e.replace(/%2F/g, "/") : e;
}
export const EMPTY_SHA256 = sha256hex("");

/** Signs a request (adds x-amz-date, x-amz-content-sha256 and Authorization to `headers`). Exported for the tests. */
export function signV4(o: { method: string; host: string; path: string; query: Record<string, string>; headers: Record<string, string>; payloadHash: string; region: string; accessKey: string; secretKey: string; date: Date }): Record<string, string> {
  const amzDate = o.date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...o.headers, host: o.host, "x-amz-date": amzDate, "x-amz-content-sha256": o.payloadHash };
  const lower = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(";");
  const canonicalQuery = Object.entries(o.query).map(([k, v]) => [uriEncode(k), uriEncode(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [o.method, o.path, canonicalQuery, lower.map(([k, v]) => `${k}:${v}\n`).join(""), signedHeaders, o.payloadHash].join("\n");
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

const xmlText = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]) : null;
};
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_x, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_x, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const encodeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class S3Client {
  private base: URL;
  constructor(public cfg: S3Config, private fetchImpl: FetchLike = (u, i) => fetch(u, i), private timeoutMs = 120_000) {
    let u: URL;
    try { u = new URL(cfg.endpoint); } catch { throw new S3Error(0, "BadEndpoint", "The endpoint is not a valid address (https://…)."); }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new S3Error(0, "BadEndpoint", "The endpoint must start with https://.");
    this.base = u;
  }

  private target(key: string | null): { url: URL; path: string } {
    const encKey = key === null ? "" : uriEncode(key, true);
    const url = new URL(this.base.origin);
    let path: string;
    if (this.cfg.pathStyle) path = `/${uriEncode(this.cfg.bucket)}${key === null ? "" : `/${encKey}`}`;
    else { url.hostname = `${this.cfg.bucket}.${this.base.hostname}`; path = `/${encKey}`; }
    url.pathname = path;
    return { url, path: path || "/" };
  }

  /** One signed request. Throws S3Error for an HTTP error (with the provider's <Code>/<Message> when it sent XML). */
  async request(method: string, key: string | null, opts: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string>; okStatus?: number[]; signal?: AbortSignal } = {}): Promise<Response> {
    const { url, path } = this.target(key);
    const query = opts.query ?? {};
    const qs = Object.entries(query).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");
    url.search = qs;
    const body = opts.body;
    const headers = signV4({
      method, host: url.host, path, query, headers: { ...(opts.headers ?? {}), ...(body ? { "content-length": String(body.length) } : {}) },
      payloadHash: body ? sha256hex(body) : EMPTY_SHA256, region: this.cfg.region || "us-east-1",
      accessKey: this.cfg.accessKey, secretKey: this.cfg.secretKey, date: new Date(),
    });
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await this.fetchImpl(url.toString(), { method, headers, body: body ? new Uint8Array(body) : undefined, redirect: "manual", signal });
    if ((opts.okStatus ?? [200, 204, 206]).includes(res.status)) return res;
    const text = await res.text().catch(() => "");
    const code = xmlText(text, "Code") ?? `HTTP${res.status}`;
    throw new S3Error(res.status, code, explain(res.status, code, xmlText(text, "Message")));
  }

  async putObject(key: string, body: Buffer, signal?: AbortSignal): Promise<void> {
    const res = await this.request("PUT", key, { body, headers: { "content-type": "application/octet-stream" }, signal });
    await res.body?.cancel().catch(() => {});
  }
  async getObject(key: string, signal?: AbortSignal): Promise<Response> { return this.request("GET", key, { signal }); }
  async deleteObject(key: string, signal?: AbortSignal): Promise<void> {
    const res = await this.request("DELETE", key, { signal, okStatus: [200, 204, 404] });
    await res.body?.cancel().catch(() => {});
  }
  async listObjects(prefix: string, signal?: AbortSignal): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
      if (token) query["continuation-token"] = token;
      const xml = await (await this.request("GET", null, { query, signal })).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = xmlText(m[1], "Key");
        if (key !== null) out.push({ key, size: Number(xmlText(m[1], "Size") ?? 0), lastModified: xmlText(m[1], "LastModified") ?? "" });
      }
      token = xmlText(xml, "IsTruncated") === "true" ? xmlText(xml, "NextContinuationToken") : null;
      if (!token) break;
    }
    return out;
  }
  async createMultipart(key: string, signal?: AbortSignal): Promise<string> {
    const xml = await (await this.request("POST", key, { query: { uploads: "" }, headers: { "content-type": "application/octet-stream" }, signal })).text();
    const id = xmlText(xml, "UploadId");
    if (!id) throw new S3Error(502, "NoUploadId", "The storage did not start the upload (no UploadId).");
    return id;
  }
  async uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer, signal?: AbortSignal): Promise<string> {
    const res = await this.request("PUT", key, { query: { partNumber: String(partNumber), uploadId }, body, signal });
    await res.body?.cancel().catch(() => {});
    const etag = res.headers.get("etag");
    if (!etag) throw new S3Error(502, "NoETag", "The storage did not confirm a part (no ETag).");
    return etag;
  }
  async completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[], signal?: AbortSignal): Promise<void> {
    const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${encodeXml(p.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`);
    const text = await (await this.request("POST", key, { query: { uploadId }, body, headers: { "content-type": "application/xml" }, signal })).text();
    // "a 200 OK response can contain either a success or an error" (CompleteMultipartUpload reference).
    if (/<Error>/.test(text)) { const code = xmlText(text, "Code") ?? "Error"; throw new S3Error(500, code, explain(500, code, xmlText(text, "Message"))); }
  }
  async abortMultipart(key: string, uploadId: string): Promise<void> {
    const res = await this.request("DELETE", key, { query: { uploadId }, okStatus: [200, 204, 404] }).catch(() => null);
    await res?.body?.cancel().catch(() => {});
  }
}

/** Words for the owner, from the S3 error code (https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html). */
function explain(status: number, code: string, message: string | null): string {
  const known: Record<string, string> = {
    InvalidAccessKeyId: "The access key is not known to this storage.",
    SignatureDoesNotMatch: "The secret key does not match the access key (or the region is wrong).",
    AccessDenied: "The storage refused access: check that the key may write to this bucket.",
    NoSuchBucket: "This bucket does not exist at this endpoint (check its name and region).",
    AuthorizationHeaderMalformed: "The region does not match this storage (check the region).",
    PermanentRedirect: "This bucket lives in another region: use that region's endpoint.",
    EntityTooSmall: "The storage refused a part as too small.",
    QuotaExceeded: "The storage space is full (quota exceeded).",
  };
  return known[code] ?? `The storage answered ${status} ${code}${message ? `: ${message.slice(0, 200)}` : ""}.`;
}

/**
 * A Writable that sends what is written to one object: a single PUT when it all fits in one part, otherwise a
 * multipart upload, one part at a time (memory holds about one part). Aborts the multipart upload when it fails.
 */
export class S3UploadStream extends Writable {
  private chunks: Buffer[] = [];
  private len = 0;
  private uploadId: string | null = null;
  private parts: { n: number; etag: string }[] = [];
  public bytes = 0;
  constructor(private s3: S3Client, private key: string, private partSize: number, private signal?: AbortSignal) {
    super({ highWaterMark: 1 << 20 });
  }
  private take(n: number): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const out = Buffer.from(all.subarray(0, n));
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.len = rest.length;
    return out;
  }
  private async sendPart(body: Buffer) {
    this.uploadId ??= await this.s3.createMultipart(this.key, this.signal);
    const n = this.parts.length + 1;
    if (n > 10_000) throw new S3Error(0, "TooManyParts", "The backup is too large for this part size.");
    this.parts.push({ n, etag: await this.s3.uploadPart(this.key, this.uploadId, n, body, this.signal) });
  }
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.chunks.push(chunk); this.len += chunk.length; this.bytes += chunk.length;
    if (this.len < this.partSize) return cb();
    (async () => { while (this.len >= this.partSize) await this.sendPart(this.take(this.partSize)); })().then(() => cb(), (err) => cb(err));
  }
  override _final(cb: (err?: Error | null) => void) {
    (async () => {
      if (!this.uploadId) { await this.s3.putObject(this.key, this.take(this.len), this.signal); return; }
      if (this.len) await this.sendPart(this.take(this.len));
      await this.s3.completeMultipart(this.key, this.uploadId, this.parts, this.signal);
    })().then(() => cb(), (err) => cb(err));
  }
  override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
    if (err && this.uploadId) { const id = this.uploadId; this.uploadId = null; void this.s3.abortMultipart(this.key, id).finally(() => cb(err)); return; }
    cb(err);
  }
}
