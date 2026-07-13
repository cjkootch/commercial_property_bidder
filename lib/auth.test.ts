import { afterEach, describe, expect, it } from "vitest";
import { isValidOperatorCookie } from "./auth";

describe("isValidOperatorCookie", () => {
  const prevSecret = process.env.OPERATOR_SHARED_SECRET;
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.OPERATOR_SHARED_SECRET = prevSecret;
    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  });

  it("accepts the exact secret and rejects everything else", () => {
    process.env.OPERATOR_SHARED_SECRET = "s3cret";
    expect(isValidOperatorCookie("s3cret")).toBe(true);
    expect(isValidOperatorCookie("wrong")).toBe(false);
    expect(isValidOperatorCookie(undefined)).toBe(false);
    expect(isValidOperatorCookie("")).toBe(false);
  });

  it("FAILS CLOSED in production when no secret is configured", () => {
    delete process.env.OPERATOR_SHARED_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    // The whole finding: a missing secret must NOT make the operator area public.
    expect(isValidOperatorCookie(undefined)).toBe(false);
    expect(isValidOperatorCookie("anything")).toBe(false);
  });

  it("stays open (auth disabled) in dev when no secret is configured", () => {
    delete process.env.OPERATOR_SHARED_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    expect(isValidOperatorCookie(undefined)).toBe(true);
  });
});
