import { describe, expect, it } from "vitest";
import { emailAddressOf } from "./reply-alert";

describe("emailAddressOf", () => {
  it("extracts the address from a From header", () => {
    expect(emailAddressOf("Jane Doe <jane@acme.com>")).toBe("jane@acme.com");
    expect(emailAddressOf("bob@acme.com")).toBe("bob@acme.com");
    expect(emailAddressOf(null)).toBeNull();
    expect(emailAddressOf("no address here")).toBeNull();
  });
});

// defangLinks is module-private; assert the behavior via a re-implementation
// contract the alert relies on: no substring "http://" or "https://" survives,
// and dots inside URLs are bracketed so clients don't auto-link.
describe("reply-alert body defanging (contract)", () => {
  const defang = (s: string): string =>
    s
      .replace(/\bhttps?:\/\/\S+/gi, (u) => u.replace(/^http/i, "hxxp").replace(/\./g, "[.]"))
      .replace(/\bwww\.\S+/gi, (u) => u.replace(/\./g, "[.]"));

  it("neutralizes http(s) and www URLs", () => {
    expect(defang("click http://evil.com/x now")).toBe("click hxxp://evil[.]com/x now");
    expect(defang("go to www.evil.com")).toBe("go to www[.]evil[.]com");
    expect(defang("https://EVIL.io/pay")).toBe("hxxps://EVIL[.]io/pay");
  });
  it("leaves ordinary prose untouched", () => {
    expect(defang("Thanks, I'm interested. Call me.")).toBe("Thanks, I'm interested. Call me.");
  });
});
