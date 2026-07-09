import { describe, expect, it } from "vitest";
import {
  ALERT_COOLDOWN_DAYS,
  buildProspectMessage,
  selectKnownContacts,
  toPitch,
  type KnownContactRow,
} from "./buyer-prospecting";
import type { MarketLead } from "../leads/market";

const pitch = {
  id: "p1",
  kind: "transfer" as const,
  city: "Spring",
  lat: 30.05,
  lng: -95.5,
  annualLo: 14900,
  annualHi: 22300,
  turf: 177118,
  notes: "Ownership transfer: HCAD transfer 2026-06-30. Owner: ACME HOLDINGS LLC.",
  spotsLeft: 3,
  verified: false,
  value: null as { annualLo: number; annualHi: number; basis: string } | null,
};

describe("pipeline/buyer-prospecting", () => {
  it("reads as a lead handoff: specifics up top, real date, teaser-safe", () => {
    const m = buildProspectMessage({
      company: "Westco Grounds Maintenance",
      lead: pitch,
      distanceMi: 12.4,
      brand: "Greenkeep",
      replyEmail: "leads@greenkeep.us",
      price: 89,
      cap: 3,
      claimUrl: "https://greenkeep.us/buyers/claim/tok123",
    });
    expect(m.subject).toBe("Grounds contract lead — new owner, Spring area — est. $14,900–$22,300/yr");
    // The deal-memo block, with the REAL sale date from the notes.
    expect(m.body).toContain("A lead for you. No charge on this one, no obligation");
    // The scarcity rule is stated up front — urgency is the mechanism, honestly.
    expect(m.body).toContain("we only ever sell a job to 3 companies");
    expect(m.body).toContain("TRIGGER — Property changed owners on 2026-06-30");
    expect(m.body).toContain("GROUNDS — ~177,118 sq ft of maintainable turf, measured from the air");
    expect(m.body).toContain("EST. VALUE — $14,900–$22,300/yr at market rates, recurring");
    expect(m.body).toContain("STATUS — 3 of 3 spots left — when they're gone, this job closes for good");
    expect(m.body).toContain("https://greenkeep.us/buyers/claim/tok123");
    // Teaser-safe: no address, no owner name in the email.
    expect(m.body).not.toContain("ACME HOLDINGS");
    // Scarcity + terms conventions hold.
    expect(m.body).toContain("capped at 3 companies*");
    expect(m.body).toContain("/terms");
    // Honest outreach: signed as us, never impersonating a customer.
    expect(m.body).toContain("We're Greenkeep");
    expect(m.body).toContain("— Greenkeep");
  });

  it("subject variant B is short, local, and human — A stays value-led", () => {
    const args = {
      company: "X",
      lead: pitch,
      distanceMi: 5,
      brand: "Greenkeep",
      replyEmail: "leads@greenkeep.us",
      price: 89,
      cap: 3,
      claimUrl: "https://x",
    };
    const a = buildProspectMessage({ ...args, subjectVariant: "A" as const });
    const b = buildProspectMessage({ ...args, subjectVariant: "B" as const });
    expect(a.subject).toContain("est. $");
    expect(b.subject).toBe("A new owner near you needs grounds care — Spring");
    expect(b.subject.length).toBeLessThan(a.subject.length);
    // Body is identical — only the subject is under test.
    expect(b.body).toBe(a.body);
    // Trades voice their own service in B.
    const bp = buildProspectMessage({
      ...args,
      trade: "pest" as const,
      lead: { ...pitch, value: { annualLo: 4000, annualHi: 9000, basis: "x" } },
      subjectVariant: "B" as const,
    });
    expect(bp.subject).toBe("A new owner near you needs pest control — Spring");
  });

  it("hand-verified measurements say so — it sells", () => {
    const m = buildProspectMessage({
      company: "X",
      lead: { ...pitch, verified: true },
      distanceMi: null,
      brand: "G",
      replyEmail: "",
      price: 89,
      cap: 3,
      claimUrl: "https://x",
    });
    expect(m.body).toContain("hand-verified measurement");
  });

  it("frames each kind's trigger with its own date", () => {
    const at = (kind: "opening" | "construction" | "violation", notes: string) =>
      buildProspectMessage({
        company: "X",
        lead: { ...pitch, kind, notes },
        distanceMi: null,
        brand: "G",
        replyEmail: "",
        price: 89,
        cap: 3,
        claimUrl: "https://x",
      }).body;
    expect(at("opening", "Opens 2026-09-01.")).toContain(
      "TRIGGER — New business opening around 2026-09-01"
    );
    expect(at("violation", "311 case 26001 (2026-07-03): cited.")).toContain(
      "TRIGGER — Cited by the city on 2026-07-03"
    );
    expect(at("construction", "TABS 1: office, est. cost $2,000,000, Est. start 2026-08-15.")).toContain(
      "TRIGGER — New construction, breaks ground around 2026-08-15"
    );
  });

  it("non-landscaping memos quote the trade's own estimate, never the turf teaser", () => {
    const est = { annualLo: 48_000, annualHi: 90_000, basis: "~50,000 sq ft est. interior (county records)" };
    const m = buildProspectMessage({
      company: "Shine Janitorial",
      lead: { ...pitch, value: est },
      distanceMi: 8,
      brand: "Greenkeep",
      replyEmail: "leads@greenkeep.us",
      price: 89,
      cap: 3,
      claimUrl: "https://x",
      trade: "cleaning",
    });
    expect(m.subject).toBe(
      "Commercial cleaning lead — new owner, Spring area — est. $48,000–$90,000/yr"
    );
    expect(m.body).toContain("SCOPE — ~50,000 sq ft est. interior (county records)");
    expect(m.body).toContain("EST. VALUE — $48,000–$90,000/yr at market rates, recurring");
    // Never the landscaping numbers or turf.
    expect(m.body).not.toContain("$14,900");
    expect(m.body).not.toContain("turf");
    // Without an estimate, fall back to the trigger-only contract line.
    const bare = buildProspectMessage({
      company: "X",
      lead: { ...pitch, value: null },
      distanceMi: null,
      brand: "G",
      replyEmail: "",
      price: 89,
      cap: 3,
      claimUrl: "https://x",
      trade: "hvac",
    });
    expect(bare.subject).toBe("Commercial HVAC service lead — new owner, Spring area");
    expect(bare.body).toContain("CONTRACT — year-round HVAC service contract, vendor decision in motion");
  });

  it("toPitch requires a priced teaser and coordinates, and carries the memo fields", () => {
    const base = {
      p: { id: "x", lat: 30, lng: -95, city: "Spring", notes: "n" },
      kind: "construction",
      spotsLeft: 2,
      teaser: { annual_lo: 5000, annual_hi: 7500, turf_sqft: 40000, verified: true },
    } as unknown as MarketLead;
    const p = toPitch(base);
    expect(p?.annualHi).toBe(7500);
    expect(p?.spotsLeft).toBe(2);
    expect(p?.verified).toBe(true);
    expect(p?.notes).toBe("n");
    expect(toPitch({ ...base, teaser: null } as MarketLead)).toBeNull();
    expect(
      toPitch({ ...base, p: { ...base.p, lat: null } } as unknown as MarketLead)
    ).toBeNull();
  });
});

describe("selectKnownContacts (area alerts)", () => {
  const NOW = new Date("2026-07-20T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000);
  // Lead in Spring, TX; the default office below is ~5 mi away.
  const lead = { id: "new-lead", lat: 30.05, lng: -95.5 };
  const row = (over: Partial<KnownContactRow> = {}): KnownContactRow => ({
    company_key: "westco grounds",
    company_name: "Westco Grounds",
    property_id: "old-lead",
    website: "https://westco.example",
    email: "info@westco.example",
    phone: null,
    contact_form_url: null,
    office_city: "Spring",
    office_lat: 30.08,
    office_lng: -95.45,
    commercial_signal: true,
    status: "sent",
    sent_at: daysAgo(10),
    resend_message_id: "re_1",
    opened_at: daysAgo(9),
    clicked_at: null,
    claim_url: "https://greenkeep.us/buyers/claim/tok?trade=landscaping",
    ...over,
  });

  it("offers a new lead to an engaged past recipient after the cadence window", () => {
    const [k] = selectKnownContacts([row()], lead, NOW);
    expect(k).toBeDefined();
    expect(k.email).toBe("info@westco.example");
    expect(k.distance).toBeLessThan(10);
    expect(k.commercial).toBe(true);
  });

  it("never re-offers the same lead", () => {
    expect(selectKnownContacts([row({ property_id: "new-lead" })], lead, NOW)).toEqual([]);
  });

  it("frequency cap: skips anyone emailed within the alert window", () => {
    const recent = row({ sent_at: daysAgo(ALERT_COOLDOWN_DAYS - 1) });
    expect(selectKnownContacts([recent], lead, NOW)).toEqual([]);
    // ...even when an OLDER row for the same company is outside the window.
    expect(selectKnownContacts([recent, row({ sent_at: daysAgo(40) })], lead, NOW)).toEqual([]);
  });

  it("skips bounced addresses and companies never actually emailed", () => {
    expect(selectKnownContacts([row({ status: "bounced" })], lead, NOW)).toEqual([]);
    expect(
      selectKnownContacts([row(), row({ status: "bounced", property_id: "older" })], lead, NOW)
    ).toEqual([]);
    expect(selectKnownContacts([row({ status: "skipped", sent_at: null })], lead, NOW)).toEqual([]);
  });

  it("engagement gate: 3 tracked sends with zero opens stops the emails", () => {
    const unopened = (id: string, pid: string) =>
      row({ resend_message_id: id, opened_at: null, clicked_at: null, property_id: pid });
    const three = [unopened("a", "p1"), unopened("b", "p2"), unopened("c", "p3")];
    expect(selectKnownContacts(three, lead, NOW)).toEqual([]);
    // One click anywhere keeps them on the list.
    const engaged = [...three.slice(0, 2), row({ property_id: "p3", opened_at: null, clicked_at: daysAgo(8) })];
    expect(selectKnownContacts(engaged, lead, NOW)).toHaveLength(1);
    // Untracked sends (pre-funnel, no message id) never count toward the gate.
    const untracked = [
      unopened("a", "p1"),
      row({ resend_message_id: null, opened_at: null, property_id: "p2" }),
      row({ resend_message_id: null, opened_at: null, property_id: "p3" }),
    ];
    expect(selectKnownContacts(untracked, lead, NOW)).toHaveLength(1);
  });

  it("LEAD INTEGRITY: a company is only 'known' for the trade that emailed it", () => {
    // A pest company from pest campaigns must never be alerted about a
    // landscaping lead...
    const pestRow = row({ claim_url: "https://greenkeep.us/buyers/claim/tok?trade=pest" });
    expect(selectKnownContacts([pestRow], lead, NOW, "landscaping")).toEqual([]);
    // ...but IS alertable for a new pest lead.
    expect(selectKnownContacts([pestRow], lead, NOW, "pest")).toHaveLength(1);
    // Politeness cap stays global: a fresh CLEANING email inside the window
    // blocks a pest alert too, even though the qualifying history is pest.
    const freshCleaning = row({
      claim_url: "https://greenkeep.us/buyers/claim/tok?trade=cleaning",
      property_id: "p-clean",
      sent_at: daysAgo(ALERT_COOLDOWN_DAYS - 1),
    });
    expect(selectKnownContacts([pestRow, freshCleaning], lead, NOW, "pest")).toEqual([]);
    // Trade-less rows (operator direct replies) qualify nobody.
    expect(
      selectKnownContacts([row({ claim_url: null })], lead, NOW, "landscaping")
    ).toEqual([]);
  });

  it("radius: offices beyond MAX_DISTANCE_MI or without coords are skipped", () => {
    expect(
      selectKnownContacts([row({ office_lat: 32.78, office_lng: -96.8 })], lead, NOW) // Dallas
    ).toEqual([]);
    expect(
      selectKnownContacts([row({ office_lat: null, office_lng: null })], lead, NOW)
    ).toEqual([]);
  });

  it("dedupes by company and sorts closest-first", () => {
    const far = row({
      company_key: "acme lawn",
      company_name: "Acme Lawn",
      email: "acme@example.com",
      office_lat: 29.76,
      office_lng: -95.37, // Houston proper, ~22 mi
    });
    const out = selectKnownContacts([row(), row({ property_id: "older" }), far], lead, NOW);
    expect(out.map((k) => k.name)).toEqual(["Westco Grounds", "Acme Lawn"]);
  });
});
