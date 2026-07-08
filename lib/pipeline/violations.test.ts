import { describe, expect, it } from "vitest";
import { parseExtract, violationNotes } from "./violations";
import { leadKind, displayName } from "../leads/market";

// Trimmed from the real nightly extract (hfdapp.houstontx.gov/311, 2026-07):
// banner lines, pipe header, then rows. Includes a non-grounds case type and
// a zero-coordinate row that must both be dropped.
const EXTRACT = `--------------------------------------------
----- 311 Public Data D365 - MTD - 2026 ----
--------------------------------------------
Extract date-time: [2026-07-07 21:45:03.12]
--------------------------------------------
365 Case Number|Case Number|Incident Address|Latitude|Longitude|Status|Created Date Local|Closed Date|Title|Incident Case Type|SLA Time|Resolve By Time|Service Area|Council District|Key Map|Department|Division|AVA Case Type|State Code|State Code Name|SLA Start Time|X|Y|Incident Street|Incident City|Incident State|Zip Code|TaxID|Created Date UTC
2600221658|2600221658|3920 BLOSSOM ST HOUSTON TX 77007|29.7678|-95.4002|Routed|2026-07-07 21:06:56.0000000||Weeds/Trash/Stagnant Water on Property - 2600221658|Weeds/Trash/Stagnant Water on Property|180 Working Days|2027-03-30|NW|C|492M|Public Works|Community Code Enforcement|Weeds|0|Active|2026-07-08|3110387|13844277|3920 BLOSSOM ST|HOUSTON|TX|77007|123|2026-07-08
2600221001|2600221001|100 MAIN ST HOUSTON TX 77002|29.76|-95.36|Closed|2026-07-02 10:00:00.0000000||Pothole - 2600221001|Pothole|30 Working Days|2026-08-30|NW|C|492M|Public Works|Streets|Pothole|0|Closed|2026-07-02|1|1|100 MAIN ST|HOUSTON|TX|77002|1|2026-07-02
2600221002|2600221002|200 BAD COORD ST HOUSTON TX 77002|0|0|Routed|2026-07-03 10:00:00.0000000||Weeds - 2600221002|Weeds/Trash/Stagnant Water on Property|180 Working Days|2027-03-30|NW|C|492M|Public Works|Community Code Enforcement|Weeds|0|Active|2026-07-03|0|0|200 BAD COORD ST|HOUSTON|TX|77002|2|2026-07-03
`;

describe("pipeline/violations", () => {
  it("parses grounds citations from the pipe extract, dropping noise", () => {
    const rows = parseExtract(EXTRACT);
    expect(rows).toHaveLength(1); // pothole + zero-coord rows dropped
    const v = rows[0];
    expect(v.caseNumber).toBe("2600221658");
    expect(v.address).toBe("3920 BLOSSOM ST HOUSTON TX 77007");
    expect(v.lat).toBeCloseTo(29.7678);
    expect(v.lng).toBeCloseTo(-95.4002);
    expect(v.createdIso).toBe("2026-07-07");
    expect(v.status).toBe("Routed");
    expect(v.zip).toBe("77007");
  });

  it("survives a malformed extract", () => {
    expect(parseExtract("")).toEqual([]);
    expect(parseExtract("no header here\njust noise")).toEqual([]);
  });

  it("notes carry the dossier Owner: sentence and the citation date for the card", () => {
    const notes = violationNotes({
      caseNumber: "2600221658",
      createdIso: "2026-07-07",
      owner: "BRETON RIDGE HOLDINGS LLC",
    });
    expect(notes.match(/Owner: ([^.]+)\./)?.[1]).toBe("BRETON RIDGE HOLDINGS LLC");
    // The buyer card extracts the cited date via this pattern.
    expect(notes.match(/311 case \S+ \(([\d-]+)\)/)?.[1]).toBe("2026-07-07");
  });

  it("H311 refs get the violation kind and strip from display names", () => {
    expect(leadKind("3920 Blossom St (H311 2600221658)")).toBe("violation");
    expect(displayName("3920 Blossom St (H311 2600221658)")).toBe("3920 Blossom St");
  });
});
