import { normalizeOrigin, sameOrigin } from "../src/api/origin";

describe("normalizeOrigin", () => {
  it("adds https and drops paths, default ports and case", () => {
    expect(normalizeOrigin("Sklubot.Sklubs.fr/")).toEqual({ ok: true, origin: "https://sklubot.sklubs.fr" });
    expect(normalizeOrigin(" https://x.fr:443/app?q=1 ")).toEqual({ ok: true, origin: "https://x.fr" });
    expect(normalizeOrigin("https://x.fr:8443")).toEqual({ ok: true, origin: "https://x.fr:8443" });
  });
  it("accepts plain http only for this device and the emulator's host", () => {
    expect(normalizeOrigin("http://10.0.2.2:8799")).toEqual({ ok: true, origin: "http://10.0.2.2:8799" });
    expect(normalizeOrigin("http://localhost:8799")).toEqual({ ok: true, origin: "http://localhost:8799" });
    expect(normalizeOrigin("http://sklubot.example.com")).toEqual({ ok: false, reason: "insecure" });
    expect(normalizeOrigin("http://192.168.1.10")).toEqual({ ok: false, reason: "insecure" });
  });
  it("refuses empty, credentials, other schemes and garbage", () => {
    expect(normalizeOrigin("  ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeOrigin("https://user:pw@x.fr")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeOrigin("ftp://x.fr")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeOrigin("javascript:alert(1)").ok).toBe(false);
    expect(normalizeOrigin("https://exa mple.com").ok).toBe(false);
    expect(normalizeOrigin("https://x.fr:99999").ok).toBe(false);
  });
  it("sameOrigin compares scheme, host and port", () => {
    expect(sameOrigin("https://x.fr/api/bots", "https://x.fr")).toBe(true);
    expect(sameOrigin("https://x.fr.evil.com/api", "https://x.fr")).toBe(false);
    expect(sameOrigin("http://x.fr/api", "https://x.fr")).toBe(false);
    expect(sameOrigin("/api", "https://x.fr")).toBe(false);
  });
});
