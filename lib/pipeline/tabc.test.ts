import { describe, expect, it } from "vitest";
import { normalizeTabc, tabcNotes } from "./tabc";
import { leadKind, displayName } from "../leads/market";

// Trimmed from the live SODA dataset (mxm5-tdpj, 2026-07-08).
const PENDING = {
  applicationid: "585211.0",
  license_type: "MB",
  applicationstatus: "Pending – In Review",
  submission_date: "2026-03-10T00:00:00.000",
  owner: "HTOWN TAPROOM LLC",
  address: "8606 HIGHWAY 6 N",
  city: "HOUSTON",
  zip: "770953528",
  county: "Harris",
};

describe("pipeline/tabc", () => {
  it("normalizes a pending application (float id stripped, zip5, title case)", () => {
    const t = normalizeTabc(PENDING);
    expect(t).not.toBeNull();
    expect(t!.applicationId).toBe("585211");
    expect(t!.licenseType).toBe("MB");
    expect(t!.address).toBe("8606 Highway 6 N");
    expect(t!.city).toBe("Houston");
    expect(t!.zip).toBe("77095");
    expect(t!.submittedIso).toBe("2026-03-10");
  });

  it("keeps only primary retail license types (FB certificates are duplicates)", () => {
    expect(normalizeTabc({ ...PENDING, license_type: "FB" })).toBeNull();
    expect(normalizeTabc({ ...PENDING, license_type: "BG" })).not.toBeNull();
    expect(normalizeTabc({ ...PENDING, license_type: "AG" })).toBeNull();
  });

  it("drops records missing the essentials", () => {
    expect(normalizeTabc({ ...PENDING, owner: "" })).toBeNull();
    expect(normalizeTabc({ ...PENDING, address: "" })).toBeNull();
  });

  it("notes never invent an opening date — the application date is the signal", () => {
    const notes = tabcNotes({
      applicationId: "585211",
      submittedIso: "2026-03-10",
      business: "Htown Taproom Llc",
      owner: "PARCEL OWNER LP",
    });
    expect(notes).toContain("submitted 2026-03-10");
    expect(notes.match(/Opens (\d{4}-\d{2}-\d{2})/)).toBeNull(); // no fake timeline
    expect(notes.match(/Owner: ([^.]+)\./)?.[1]).toBe("PARCEL OWNER LP");
  });

  it("TABC refs get the opening kind (same decision window as STP)", () => {
    expect(leadKind("Htown Taproom (TABC 585211)")).toBe("opening");
    expect(displayName("Htown Taproom (TABC 585211)")).toBe("Htown Taproom");
  });
});
