import { ApiClient, ApiError, checkHealth, multipartBody, type FetchLike } from "../src/api/client";

it("sends large files in server-sized reads and closes the native handle", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const handle = {
    offset: 0,
    readBytes: async (count: number) => bytes.slice(handle.offset, handle.offset + count),
    close: jest.fn(),
  };
  const parts: number[][] = [];
  const client = new ApiClient({ origin: "https://example.org", token: "test", fetch: async (url, init) => {
    if (url.endsWith("/start")) return fakeFetch({ body: { id: "transfer", partBytes: 2 } })(url, init);
    const offset = Number(new URL(url).searchParams.get("offset"));
    const body = Array.from(init.body as Uint8Array);
    parts.push(body);
    const received = offset + body.length;
    return fakeFetch({ body: received === bytes.length ? { attachment: { size: received } } : { received } })(url, init);
  } });
  const result = await client.uploadLargeFile("/bots/b/uploads", "clip.mp4", { size: bytes.length, open: () => handle });
  expect(parts).toEqual([[1, 2], [3, 4], [5]]);
  expect(result).toEqual({ attachment: { size: 5 } });
  expect(handle.close).toHaveBeenCalledTimes(1);
});

function fakeFetch(answer: { status?: number; body?: unknown; setCookie?: string }, calls: { url: string; init: Record<string, unknown> }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const status = answer.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === "set-cookie" ? answer.setCookie ?? null : null) },
      text: async () => (answer.body === undefined ? "" : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body)),
    };
  };
}

describe("ApiClient", () => {
  it("sends JSON to the configured origin with the session cookie and no cookie jar", async () => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const c = new ApiClient({ origin: "https://x.fr", token: "tok", fetch: fakeFetch({ body: { ok: true } }, calls) });
    await c.post("/bots/b1/messages", { text: "hi" });
    expect(calls[0].url).toBe("https://x.fr/api/bots/b1/messages");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("omit");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Cookie).toBe("sklubot_session=tok");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h.Origin).toBeUndefined();
    expect(calls[0].init.body).toBe('{"text":"hi"}');
  });
  it("keeps the session the server sets at sign-in, and forgets it at sign-out", async () => {
    const tokens: (string | null)[] = [];
    const c = new ApiClient({ origin: "https://x.fr", token: null, fetch: fakeFetch({ body: { user: {} }, setCookie: "sklubot_session=new; Path=/; HttpOnly" }), onToken: (t) => tokens.push(t) });
    await c.post("/auth/login", { email: "a@b", password: "x" });
    expect(c.authHeaders()).toEqual({ Cookie: "sklubot_session=new" });
    const out = new ApiClient({ origin: "https://x.fr", token: "new", fetch: fakeFetch({ body: { ok: true }, setCookie: "sklubot_session=; Max-Age=0; Path=/" }), onToken: (t) => tokens.push(t) });
    await out.post("/auth/logout");
    expect(out.hasSession).toBe(false);
    expect(tokens).toEqual(["new", null]);
  });
  it("turns errors into ApiError with the server's message; 401 outside /auth means the session is gone", async () => {
    let lost = 0;
    const c = new ApiClient({ origin: "https://x.fr", token: "t", fetch: fakeFetch({ status: 401, body: { error: "Please sign in." } }), onUnauthorized: () => lost++ });
    await expect(c.get("/bots")).rejects.toMatchObject({ status: 401, serverMessage: "Please sign in." });
    expect(lost).toBe(1);
    const login = new ApiClient({ origin: "https://x.fr", token: null, fetch: fakeFetch({ status: 401, body: { error: "Wrong email or password." } }), onUnauthorized: () => lost++ });
    await expect(login.post("/auth/login", {})).rejects.toBeInstanceOf(ApiError);
    expect(lost).toBe(1);
  });
  it("reports an unreachable server as status 0", async () => {
    const c = new ApiClient({ origin: "https://x.fr", token: null, fetch: async () => { throw new TypeError("network"); } });
    await expect(c.get("/me")).rejects.toMatchObject({ status: 0 });
  });
  it("builds file addresses under the bot", () => {
    const c = new ApiClient({ origin: "https://x.fr", token: null, fetch: fakeFetch({}) });
    expect(c.fileUrl("b 1", "out/r é.pdf", "download")).toBe("https://x.fr/api/bots/b%201/files/download?path=out%2Fr%20%C3%A9.pdf");
  });
  it("checkHealth recognises a Sklubot server", async () => {
    expect(await checkHealth("https://x.fr", fakeFetch({ body: { ok: true, model: "demo" } }))).toEqual({ ok: true });
    expect(await checkHealth("https://x.fr", fakeFetch({ body: "<html>" }))).toEqual({ ok: false, reason: "notSklubot" });
    expect(await checkHealth("https://x.fr", async () => { throw new Error("down"); })).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("multipartBody", () => {
  it("wraps the file bytes in one form-data part", () => {
    const { body, contentType } = multipartBody("file", { name: 'a"b.png', type: "image/png", bytes: new Uint8Array([1, 2, 3]) }, "XYZ");
    expect(contentType).toBe("multipart/form-data; boundary=XYZ");
    const text = String.fromCharCode(...Array.from(body));
    expect(text.startsWith('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a_b.png"\r\nContent-Type: image/png\r\n\r\n\u0001\u0002\u0003\r\n--XYZ--\r\n')).toBe(true);
  });
  it("is sent raw with its content type by upload()", async () => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const c = new ApiClient({ origin: "https://x.fr", token: "t", fetch: fakeFetch({ body: { attachment: { path: "uploads/a.png" } } }, calls) });
    await c.upload("/bots/b/uploads", { name: "a.png", type: "image/png", bytes: new Uint8Array([9]) });
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(calls[0].init.body).toBeInstanceOf(Uint8Array);
  });
});
