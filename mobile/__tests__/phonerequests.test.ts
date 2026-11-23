import { locationPageUrl, mmss, onPhoneRequests, phoneRequestsEvent, secondsLeft, visibleRequests } from "../src/lib/phoneRequests";

describe("L177 phone requests", () => {
  const now = 1_000_000;
  const req = (o: object) => ({ id: "phr_1", botId: "b", botName: "Max", kind: "photo", reason: "facture", status: "pending", createdAt: now - 1000, expiresAt: now + 90_000, ...o });
  it("shows only pending, unexpired photo or location requests, oldest first", () => {
    const list = visibleRequests([req({ id: "b", createdAt: now }), req({ id: "a" }), req({ id: "x", expiresAt: now - 1 }), req({ id: "y", status: "done" }), req({ id: "z", kind: "contacts" }), null, "junk"], now);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    expect(visibleRequests(undefined, now)).toEqual([]);
  });
  it("counts down", () => {
    expect(secondsLeft({ expiresAt: now + 90_500 }, now)).toBe(91);
    expect(secondsLeft({ expiresAt: now - 5 }, now)).toBe(0);
    expect(mmss(125)).toBe("2:05");
  });
  it("only opens the server's one-time location page", () => {
    expect(locationPageUrl("https://sk.example/", "/api/phone/where/abcdefghijklmnopqrstuvwx")).toBe("https://sk.example/api/phone/where/abcdefghijklmnopqrstuvwx");
    expect(locationPageUrl("https://sk.example", "https://evil.example/x")).toBeNull();
    expect(locationPageUrl("https://sk.example", "/api/phone/where/short")).toBeNull();
    expect(locationPageUrl("https://sk.example", 42)).toBeNull();
  });
  it("the live event wakes the card, other events do not", () => {
    let n = 0;
    const off = onPhoneRequests(() => { n++; });
    expect(phoneRequestsEvent({ type: "phoneRequests" })).toBe(true);
    expect(phoneRequestsEvent({ type: "rows" })).toBe(false);
    off();
    phoneRequestsEvent({ type: "phoneRequests" });
    expect(n).toBe(1);
  });
});
