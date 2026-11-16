/// <reference types="node" />
import { fitRect, fromBase64, jpegSize, normalizeAddress, toBase64, toScreenPoint } from "../src/lib/screen";
import { ApiClient, type FetchLike } from "../src/api/client";

/** A minimal JPEG header: SOI, an APP0 segment, then SOF0 with the size. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0]);
}

describe("bot screen helpers", () => {
  it("reads the JPEG size", () => {
    expect(jpegSize(jpeg(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(jpegSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
  it("encodes and decodes base64 like the standard", () => {
    for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      const b = new TextEncoder().encode(s);
      expect(toBase64(b)).toBe(Buffer.from(s).toString("base64"));
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
    }
    const all = new Uint8Array(256).map((_, i) => i);
    expect(toBase64(all)).toBe(Buffer.from(all).toString("base64"));
  });
  it("maps a tap to screenshot pixels with letterboxing", () => {
    // 1280×800 shown in a 400×400 box: 400×250, 75 px bands above and below.
    expect(fitRect(400, 400, 1280, 800)).toEqual({ x: 0, y: 75, w: 400, h: 250 });
    expect(toScreenPoint(200, 200, 400, 400, 1280, 800)).toEqual({ x: 640, y: 400 });
    expect(toScreenPoint(0, 75, 400, 400, 1280, 800)).toEqual({ x: 0, y: 0 });
    expect(toScreenPoint(200, 20, 400, 400, 1280, 800)).toBeNull();
    expect(toScreenPoint(10, 10, 0, 0, 1280, 800)).toBeNull();
  });
  it("adds https to a bare address", () => {
    expect(normalizeAddress(" example.com ")).toBe("https://example.com");
    expect(normalizeAddress("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAddress("  ")).toBeNull();
  });
});

describe("ApiClient.bytes", () => {
  const fetchOf = (status: number, body: Uint8Array | null, calls: Record<string, unknown>[] = []): FetchLike => async (url, init) => {
    calls.push({ url, ...init });
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => "", arrayBuffer: async () => (body ?? new Uint8Array()).buffer as ArrayBuffer };
  };
  it("returns the screenshot bytes with the session header", async () => {
    const calls: Record<string, unknown>[] = [];
    const c = new ApiClient({ origin: "https://x.fr", token: "tok", fetch: fetchOf(200, jpeg(10, 20), calls) });
    const r = await c.bytes("/bots/b/screen");
    expect(r.status).toBe(200);
    expect(jpegSize(r.bytes!)).toEqual({ width: 10, height: 20 });
    expect(calls[0].url).toBe("https://x.fr/api/bots/b/screen");
    expect((calls[0].headers as Record<string, string>).Cookie).toBe("sklubot_session=tok");
    expect(calls[0].credentials).toBe("omit");
  });
  it("no desktop (204) is a null body; 401 means the session is gone", async () => {
    expect((await new ApiClient({ origin: "https://x.fr", token: "t", fetch: fetchOf(204, null) }).bytes("/s")).bytes).toBeNull();
    let lost = 0;
    const c = new ApiClient({ origin: "https://x.fr", token: "t", fetch: fetchOf(401, null), onUnauthorized: () => lost++ });
    await expect(c.bytes("/s")).rejects.toMatchObject({ status: 401 });
    expect(lost).toBe(1);
  });
});
