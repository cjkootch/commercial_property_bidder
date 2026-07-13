import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyStripeSignature } from "./stripe";

const SECRET = "whsec_test_123";
const sign = (payload: string, t: number, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");

describe("verifyStripeSignature", () => {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  beforeEach(() => (process.env.STRIPE_WEBHOOK_SECRET = SECRET));
  afterEach(() => (process.env.STRIPE_WEBHOOK_SECRET = prev));

  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = () => Math.floor(Date.now() / 1000);

  it("accepts a valid single-v1 signature", () => {
    const t = now();
    expect(verifyStripeSignature(payload, `t=${t},v1=${sign(payload, t)}`)).toBe(true);
  });

  it("accepts when MULTIPLE v1 are present and ours is NOT last (rotation)", () => {
    // During webhook-secret rotation Stripe signs with every active secret;
    // the previous impl kept only the last v1 and would reject valid events.
    const t = now();
    const ours = sign(payload, t);
    const other = sign(payload, t, "whsec_rotated_out");
    expect(verifyStripeSignature(payload, `t=${t},v1=${ours},v1=${other}`)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=${other},v1=${ours}`)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const t = now();
    expect(verifyStripeSignature(payload + "x", `t=${t},v1=${sign(payload, t)}`)).toBe(false);
  });

  it("rejects a stale timestamp (> 5 min skew)", () => {
    const t = now() - 600;
    expect(verifyStripeSignature(payload, `t=${t},v1=${sign(payload, t)}`)).toBe(false);
  });

  it("rejects a missing/blank header or secret", () => {
    expect(verifyStripeSignature(payload, null)).toBe(false);
    expect(verifyStripeSignature(payload, "garbage")).toBe(false);
  });
});
