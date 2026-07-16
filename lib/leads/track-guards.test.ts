import { describe, expect, it } from "vitest";
import { hashIp, isCrossTokenScanner, isDuplicateFire, type RecentEvent } from "./track-guards";

const NOW = new Date("2026-07-16T15:12:11Z");
const ev = (o: Partial<RecentEvent> & { secondsAgo: number }): RecentEvent => ({
  company: o.company ?? null,
  property_id: o.property_id ?? null,
  event: o.event ?? "view_claimable",
  ip_hash: o.ip_hash ?? null,
  created_at: new Date(NOW.getTime() - o.secondsAgo * 1000),
});

describe("isDuplicateFire", () => {
  it("catches the wild double-load (same company+property, 24ms apart)", () => {
    const recent = [ev({ company: "Walton Roofing", property_id: "p1", secondsAgo: 0.024 })];
    expect(
      isDuplicateFire(recent, { company: "Walton Roofing", propertyId: "p1", event: "view_claimable" }, NOW)
    ).toBe(true);
  });

  it("lets a genuine revisit through after the window", () => {
    const recent = [ev({ company: "Walton Roofing", property_id: "p1", secondsAgo: 60 })];
    expect(
      isDuplicateFire(recent, { company: "Walton Roofing", propertyId: "p1", event: "view_claimable" }, NOW)
    ).toBe(false);
  });

  it("different event kinds don't collide", () => {
    const recent = [ev({ company: "A", property_id: "p1", event: "view_claimable", secondsAgo: 2 })];
    expect(isDuplicateFire(recent, { company: "A", propertyId: "p1", event: "submit_unlocked" }, NOW)).toBe(false);
  });
});

describe("isCrossTokenScanner", () => {
  it("flags one IP walking two companies' links (incl. an expired-token visit)", () => {
    const recent = [ev({ company: null, event: "view_expired", ip_hash: "machineA", secondsAgo: 2 })];
    expect(isCrossTokenScanner(recent, { ipHash: "machineA", company: "Walton Roofing" }, NOW)).toBe(true);
  });

  it("does not flag the same company's own earlier visit", () => {
    const recent = [ev({ company: "Walton Roofing", ip_hash: "machineA", secondsAgo: 30 })];
    expect(isCrossTokenScanner(recent, { ipHash: "machineA", company: "Walton Roofing" }, NOW)).toBe(false);
  });

  it("does not flag different IPs or missing hashes", () => {
    const recent = [ev({ company: "Other Co", ip_hash: "machineB", secondsAgo: 5 })];
    expect(isCrossTokenScanner(recent, { ipHash: "machineA", company: "Walton Roofing" }, NOW)).toBe(false);
    expect(isCrossTokenScanner(recent, { ipHash: null, company: "Walton Roofing" }, NOW)).toBe(false);
  });

  it("forgets after the window", () => {
    const recent = [ev({ company: "Other Co", ip_hash: "machineA", secondsAgo: 11 * 60 })];
    expect(isCrossTokenScanner(recent, { ipHash: "machineA", company: "Walton Roofing" }, NOW)).toBe(false);
  });
});

describe("hashIp", () => {
  it("is stable, salted, and never the raw IP", () => {
    const a = hashIp("203.0.113.9", "salt");
    expect(a).toBe(hashIp("203.0.113.9", "salt"));
    expect(a).not.toBe(hashIp("203.0.113.9", "other-salt"));
    expect(a).not.toContain("203");
    expect(hashIp(null, "salt")).toBeNull();
  });
});
