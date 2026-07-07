import { describe, expect, it } from "vitest";
import {
  signBuyerClaim,
  signBuyerLogin,
  signBuyerSession,
  verifyBuyerClaim,
  verifyBuyerLogin,
  verifyBuyerSession,
} from "./buyer-auth";

describe("buyer-auth tokens", () => {
  it("round-trips a claim token with property + company", () => {
    const t = signBuyerClaim("prop-123", "Acme Lawn Co");
    expect(verifyBuyerClaim(t)).toEqual({ property_id: "prop-123", company: "Acme Lawn Co" });
  });

  it("round-trips a claim token with a null company", () => {
    const t = signBuyerClaim("prop-123", null);
    expect(verifyBuyerClaim(t)).toEqual({ property_id: "prop-123", company: null });
  });

  it("round-trips login and session tokens", () => {
    expect(verifyBuyerLogin(signBuyerLogin("Buyer@Example.com"))).toBe("buyer@example.com");
    expect(verifyBuyerSession(signBuyerSession("buyer-9"))).toBe("buyer-9");
  });

  it("rejects cross-kind tokens (a session is not a claim)", () => {
    expect(verifyBuyerClaim(signBuyerSession("buyer-9"))).toBeNull();
    expect(verifyBuyerSession(signBuyerClaim("prop-1", null))).toBeNull();
    expect(verifyBuyerLogin(signBuyerClaim("prop-1", null))).toBeNull();
  });

  it("rejects tampered and malformed tokens", () => {
    const t = signBuyerClaim("prop-123", null);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ kind: "claim", property_id: "prop-999", company: null, exp: 9999999999 })).toString("base64url");
    expect(verifyBuyerClaim(`${forged}.${sig}`)).toBeNull();
    expect(verifyBuyerClaim(`${body}.AAAA`)).toBeNull();
    expect(verifyBuyerClaim("not-a-token")).toBeNull();
    expect(verifyBuyerClaim(undefined)).toBeNull();
    expect(verifyBuyerClaim("")).toBeNull();
  });
});
