import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyResendSignature } from "./resend";

// Build a genuine Svix-style signature for a payload under a given secret.
function sign(secret: string, id: string, timestamp: string, body: string): string {
  const bytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", bytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}

const SECRET_A = `whsec_${Buffer.from("secret-a-secret-a-secret-a").toString("base64")}`;
const SECRET_B = `whsec_${Buffer.from("secret-b-secret-b-secret-b").toString("base64")}`;
const BODY = '{"type":"email.received"}';
const HDR = (signature: string | null) => ({ id: "msg_1", timestamp: "1700000000", signature });

afterEach(() => {
  delete process.env.RESEND_WEBHOOK_SECRET;
});

describe("verifyResendSignature (multi-secret, 2026-07-20 incident)", () => {
  it("accepts a payload signed by the SECOND configured secret", () => {
    process.env.RESEND_WEBHOOK_SECRET = `${SECRET_A},${SECRET_B}`;
    const sig = sign(SECRET_B, "msg_1", "1700000000", BODY);
    expect(verifyResendSignature(BODY, HDR(sig))).toBe(true);
  });

  it("accepts the first secret too", () => {
    process.env.RESEND_WEBHOOK_SECRET = `${SECRET_A},${SECRET_B}`;
    const sig = sign(SECRET_A, "msg_1", "1700000000", BODY);
    expect(verifyResendSignature(BODY, HDR(sig))).toBe(true);
  });

  it("rejects a signature from an unknown secret — the 401 that disabled the webhook", () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET_A;
    const sig = sign(SECRET_B, "msg_1", "1700000000", BODY);
    expect(verifyResendSignature(BODY, HDR(sig))).toBe(false);
  });

  it("rejects missing headers when a secret is set", () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET_A;
    expect(verifyResendSignature(BODY, HDR(null))).toBe(false);
  });

  it("stray whitespace and empty entries in the env value are tolerated", () => {
    process.env.RESEND_WEBHOOK_SECRET = ` ${SECRET_A} , , ${SECRET_B} `;
    const sig = sign(SECRET_B, "msg_1", "1700000000", BODY);
    expect(verifyResendSignature(BODY, HDR(sig))).toBe(true);
  });
});
