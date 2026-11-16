import { jsShouldNotify } from "../src/live";
import { relayNeedsAccessibility } from "../src/relay";

describe("background connection (complet build)", () => {
  it("notifies once: the app in front, or the service when it is on", () => {
    expect(jsShouldNotify(true, true)).toBe(true);
    expect(jsShouldNotify(true, false)).toBe(true);
    expect(jsShouldNotify(false, false)).toBe(true);
    expect(jsShouldNotify(false, true)).toBe(false);
  });
});

describe("phone control turned off", () => {
  const base = { enabled: true, accessibility: false, locked: false, state: "", paired: true, accessibilityWasOn: true };
  it("prompts only when paired, left on, and the accessibility service is off", () => {
    expect(relayNeedsAccessibility(base)).toBe(true);
    expect(relayNeedsAccessibility({ ...base, accessibility: true })).toBe(false);
    expect(relayNeedsAccessibility({ ...base, enabled: false })).toBe(false);
    expect(relayNeedsAccessibility({ ...base, paired: false })).toBe(false);
    expect(relayNeedsAccessibility(null)).toBe(false);
  });
});
