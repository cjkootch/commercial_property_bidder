import { describe, expect, it } from "vitest";
import { buildOutcomeMessage, outcomeSmsFor, pickOutcomeChannel } from "./outcome-check";

describe("pickOutcomeChannel", () => {
  it("prefers SMS when the linked company has a textable number", () => {
    expect(
      pickOutcomeChannel({ phone: "+17135551234", lineType: "mobile", email: "a@b.com", emailOk: true })
    ).toBe("sms");
  });

  it("fails open on an unscreened number (warm relationship, not cold outreach)", () => {
    expect(
      pickOutcomeChannel({ phone: "+17135551234", lineType: null, email: "a@b.com", emailOk: true })
    ).toBe("sms");
  });

  it("falls to email on a landline", () => {
    expect(
      pickOutcomeChannel({ phone: "+17135551234", lineType: "landline", email: "a@b.com", emailOk: true })
    ).toBe("email");
  });

  it("falls to email when there is no phone at all", () => {
    expect(pickOutcomeChannel({ phone: null, lineType: null, email: "a@b.com", emailOk: true })).toBe("email");
  });

  it("returns null when email is a placeholder / notify off and no textable phone", () => {
    expect(pickOutcomeChannel({ phone: null, lineType: null, email: "x@sms.local", emailOk: false })).toBeNull();
    expect(
      pickOutcomeChannel({ phone: "+17135551234", lineType: "fixedVoip", email: null, emailOk: false })
    ).toBeNull();
  });
});

describe("outcomeSmsFor", () => {
  it("reads like Cole texting, names the job, asks the outcome", () => {
    const t = outcomeSmsFor({ city: "Houston", trade: "cleaning" });
    expect(t).toContain("Houston cleaning job");
    expect(t).toContain("Any luck with it?");
    expect(t).toContain("-Cole");
    expect(t.length).toBeLessThan(160); // one segment
  });

  it("drops the city cleanly when unknown", () => {
    const t = outcomeSmsFor({ city: null, trade: "landscaping" });
    expect(t).not.toContain("null");
    expect(t).toMatch(/that (commercial )?\w+.* job you claimed/);
  });
});

describe("buildOutcomeMessage", () => {
  it("keeps the email path intact (subject names the job, body offers the three replies)", () => {
    const m = buildOutcomeMessage({
      company: "Acme Cleaning",
      city: "Houston",
      trade: "cleaning",
      brand: "Greenkeep",
    });
    expect(m.subject).toContain("Houston");
    expect(m.body).toContain("refresh");
    expect(m.body).toContain("/buyers");
  });
});
