import { describe, expect, it } from "vitest";
import {
  DEFAULT_INBOUND_DOMAINS,
  addressedToUs,
  allowedInboundDomains,
  domainOf,
  isOurDomain,
} from "./inbound-domains";

// The real 16 Nov 2026 leaks: Greenkeep alerted its operator about Wild Rose
// Advisors' mail because one Resend account serves both and its webhooks are
// account-level.
const OURS = ["greenkeep.us"];

describe("allowedInboundDomains", () => {
  it("defaults to greenkeep.us when the variable is unset", () => {
    expect(allowedInboundDomains(undefined)).toEqual(["greenkeep.us"]);
  });

  it("parses a list, trimming, lowercasing and dropping blanks", () => {
    expect(allowedInboundDomains(" Greenkeep.us, Other.COM ,")).toEqual([
      "greenkeep.us",
      "other.com",
    ]);
  });

  it("accepts a domain written with a leading @, as config values often are", () => {
    expect(allowedInboundDomains("@greenkeep.us")).toEqual(["greenkeep.us"]);
  });

  it("FAILS CLOSED when set but empty — nothing is ours", () => {
    // The direction matters. An empty list costs a missed alert; treating it as
    // "allow everything" leaks another business's mail and poisons our
    // suppression list. Only the first is recoverable.
    expect(allowedInboundDomains("")).toEqual([]);
    expect(allowedInboundDomains("   ")).toEqual([]);
    expect(allowedInboundDomains(",, ,")).toEqual([]);
    expect(addressedToUs("leads@greenkeep.us", allowedInboundDomains(""))).toBe(false);
  });

  it("hands back a copy, so a caller cannot corrupt the default for everyone", () => {
    const first = allowedInboundDomains(undefined);
    first.push("evil.com");
    expect(allowedInboundDomains(undefined)).toEqual(["greenkeep.us"]);
    expect(DEFAULT_INBOUND_DOMAINS).toEqual(["greenkeep.us"]);
  });
});

describe("addressedToUs", () => {
  it("accepts our own domain", () => {
    expect(addressedToUs(["leads@greenkeep.us"], OURS)).toBe(true);
  });

  it("accepts a white-label tenant subdomain", () => {
    // Tenants are served at <slug>.<TENANT_ROOT_DOMAIN>, so their mail is ours.
    expect(addressedToUs(["leads@acme.greenkeep.us"], OURS)).toBe(true);
    expect(addressedToUs("Leads <LEADS@Acme.Greenkeep.US>", OURS)).toBe(true);
  });

  it("REFUSES the other business on the shared account", () => {
    expect(addressedToUs(["cole@wildroseadvisors.com"], OURS)).toBe(false);
    expect(addressedToUs(["leads@wildroseadvisors.com"], OURS)).toBe(false);
    expect(addressedToUs("support+zara@micro1.ai", OURS)).toBe(false);
  });

  it("REFUSES lookalike domains", () => {
    // notgreenkeep.us ends with our domain but not with a dot before it;
    // greenkeep.us.evil.com merely contains it. A bare endsWith admits both.
    expect(addressedToUs(["x@notgreenkeep.us"], OURS)).toBe(false);
    expect(addressedToUs(["x@greenkeep.us.evil.com"], OURS)).toBe(false);
    expect(addressedToUs(["x@greenkeep.usa"], OURS)).toBe(false);
    expect(addressedToUs(["x@xgreenkeep.us"], OURS)).toBe(false);
  });

  it("accepts a mixed recipient list when ANY recipient is ours", () => {
    expect(addressedToUs(["cole@wildroseadvisors.com", "leads@greenkeep.us"], OURS)).toBe(true);
  });

  it("handles several addresses packed into one header string", () => {
    expect(addressedToUs("cole@wildroseadvisors.com, leads@greenkeep.us", OURS)).toBe(true);
    expect(addressedToUs("a@wildroseadvisors.com, b@micro1.ai", OURS)).toBe(false);
  });

  it("refuses an empty, missing or junk recipient list", () => {
    expect(addressedToUs(undefined, OURS)).toBe(false);
    expect(addressedToUs(null, OURS)).toBe(false);
    expect(addressedToUs([], OURS)).toBe(false);
    expect(addressedToUs("", OURS)).toBe(false);
    expect(addressedToUs(["not an address at all"], OURS)).toBe(false);
  });

  it("is not fooled by our domain appearing in a display name", () => {
    expect(addressedToUs(["greenkeep.us fan <x@evil.com>"], OURS)).toBe(false);
  });
});

describe("isOurDomain — the sender check that gates suppression", () => {
  it("tells our bounces from another business's", () => {
    // A bounce for mail Wild Rose sent must not add that recipient to
    // GREENKEEP's suppression list.
    expect(isOurDomain("Wild Rose Advisors <leads@wildroseadvisors.com>", OURS)).toBe(false);
    expect(isOurDomain("Greenkeep <leads@greenkeep.us>", OURS)).toBe(true);
  });

  it("reads a bare address as well as a named one", () => {
    expect(isOurDomain("leads@greenkeep.us", OURS)).toBe(true);
    expect(isOurDomain("leads@wildroseadvisors.com", OURS)).toBe(false);
  });

  it("refuses a missing sender rather than guessing", () => {
    expect(isOurDomain(null, OURS)).toBe(false);
    expect(isOurDomain(undefined, OURS)).toBe(false);
  });
});

describe("domainOf", () => {
  it("reads both address shapes", () => {
    expect(domainOf("Name <a@b.com>")).toBe("b.com");
    expect(domainOf("a@b.com")).toBe("b.com");
  });

  it("takes the LAST @, so a quoted local part cannot smuggle one in", () => {
    expect(domainOf('"a@greenkeep.us" <x@evil.com>')).toBe("evil.com");
  });

  it("strips a trailing dot, the FQDN spelling of the same domain", () => {
    expect(domainOf("a@greenkeep.us.")).toBe("greenkeep.us");
    expect(isOurDomain("a@greenkeep.us.", OURS)).toBe(true);
  });

  it("stops at characters a hostname cannot contain", () => {
    expect(domainOf("a@b.com (work)")).toBe("b.com");
  });

  it("returns null when there is no address", () => {
    expect(domainOf("")).toBeNull();
    expect(domainOf(null)).toBeNull();
    expect(domainOf("nobody")).toBeNull();
  });
});
