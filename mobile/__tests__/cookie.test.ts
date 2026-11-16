import { cookieHeader, sessionFromSetCookie } from "../src/api/cookie";

describe("session cookie", () => {
  it("reads the token from the server's Set-Cookie", () => {
    expect(sessionFromSetCookie("sklubot_session=abc123; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax")).toBe("abc123");
    expect(sessionFromSetCookie(["other=1; Path=/", "sklubot_session=t%2Bk; Path=/; Secure"])).toBe("t+k");
  });
  it("handles folded headers with Expires dates", () => {
    expect(sessionFromSetCookie("a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT, sklubot_session=zz; Path=/")).toBe("zz");
  });
  it("sees a cleared cookie as an empty token, and ignores unrelated ones", () => {
    expect(sessionFromSetCookie("sklubot_session=; Max-Age=0; Path=/")).toBe("");
    expect(sessionFromSetCookie("sklubot_session=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT")).toBe("");
    expect(sessionFromSetCookie("theme=dark")).toBeNull();
    expect(sessionFromSetCookie(null)).toBeNull();
  });
  it("builds the Cookie header", () => {
    expect(cookieHeader("a b")).toBe("sklubot_session=a%20b");
  });
});
