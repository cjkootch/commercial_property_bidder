import { describe, it, expect } from "vitest";
import { slugFromHost } from "./tenant";

const ROOT = "greenkeep.us";

describe("slugFromHost", () => {
  it("resolves a tenant subdomain", () => {
    expect(slugFromHost("acme.greenkeep.us", ROOT)).toBe("acme");
    expect(slugFromHost("ACME.Greenkeep.US:443", ROOT)).toBe("acme");
  });

  it("treats apex, www, and unrelated hosts as the default tenant", () => {
    expect(slugFromHost("greenkeep.us", ROOT)).toBeNull();
    expect(slugFromHost("www.greenkeep.us", ROOT)).toBeNull();
    expect(slugFromHost("myapp.vercel.app", ROOT)).toBeNull();
    expect(slugFromHost("localhost:3000", ROOT)).toBeNull();
  });

  it("rejects nested labels and degenerate inputs", () => {
    expect(slugFromHost("a.b.greenkeep.us", ROOT)).toBeNull();
    expect(slugFromHost("evilgreenkeep.us", ROOT)).toBeNull(); // no dot boundary
    expect(slugFromHost(null, ROOT)).toBeNull();
    expect(slugFromHost("acme.greenkeep.us", null)).toBeNull();
    expect(slugFromHost("", ROOT)).toBeNull();
  });
});
