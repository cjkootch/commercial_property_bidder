import { describe, expect, it } from "vitest";
import { buildNudgeMessage, selectNudgeTargets, type NudgeCandidateRow } from "./nudges";

const NOW = new Date("2026-07-09T18:00:00Z");
const H = 3600_000;
const base = (over: Partial<NudgeCandidateRow>): NudgeCandidateRow => ({
  id: "id",
  company_key: "acme pest",
  company_name: "Acme Pest",
  email: "info@acmepest.com",
  property_id: "prop-1",
  claim_url: "https://greenkeep.us/buyers/claim/tok?trade=pest",
  sent_at: new Date(NOW.getTime() - 72 * H),
  opened_at: new Date(NOW.getTime() - 70 * H),
  clicked_at: null,
  nudged_at: null,
  ...over,
});

describe("pipeline/nudges selectNudgeTargets", () => {
  const opts = { now: NOW, convertedKeys: new Set<string>(), suppressed: new Set<string>() };

  it("selects an engaged, 48h+ old, un-nudged row", () => {
    expect(selectNudgeTargets([base({})], opts)).toHaveLength(1);
  });

  it("skips rows that are too fresh, un-engaged, already nudged, or incomplete", () => {
    expect(selectNudgeTargets([base({ sent_at: new Date(NOW.getTime() - 24 * H) })], opts)).toHaveLength(0);
    expect(selectNudgeTargets([base({ opened_at: null, clicked_at: null })], opts)).toHaveLength(0);
    expect(selectNudgeTargets([base({ nudged_at: new Date() })], opts)).toHaveLength(0);
    expect(selectNudgeTargets([base({ email: null })], opts)).toHaveLength(0);
    expect(selectNudgeTargets([base({ claim_url: null })], opts)).toHaveLength(0);
    expect(selectNudgeTargets([base({ property_id: null })], opts)).toHaveLength(0);
  });

  it("skips converted companies and suppressed emails", () => {
    expect(
      selectNudgeTargets([base({})], { ...opts, convertedKeys: new Set(["acme pest"]) })
    ).toHaveLength(0);
    expect(
      selectNudgeTargets([base({})], { ...opts, suppressed: new Set(["info@acmepest.com"]) })
    ).toHaveLength(0);
  });

  it("one nudge per company: the most recently engaged row wins", () => {
    const older = base({ id: "old", opened_at: new Date(NOW.getTime() - 71 * H) });
    const newer = base({
      id: "new",
      property_id: "prop-2",
      clicked_at: new Date(NOW.getTime() - 50 * H),
    });
    const picked = selectNudgeTargets([older, newer], opts);
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe("new");
  });
});

describe("pipeline/nudges buildNudgeMessage", () => {
  it("references the trade, live spots, and the original claim link — honestly", () => {
    const msg = buildNudgeMessage({
      company: "Acme Pest",
      trade: "pest",
      city: "Houston",
      spotsLeft: 1,
      cap: 3,
      claimUrl: "https://greenkeep.us/buyers/claim/tok?trade=pest",
      brand: "Greenkeep",
      replyEmail: "leads@greenkeep.us",
    });
    expect(msg.subject).toContain("Still open");
    expect(msg.subject).toContain("Houston");
    expect(msg.body).toContain("1 of 3 spots");
    expect(msg.body).toContain("https://greenkeep.us/buyers/claim/tok?trade=pest");
    expect(msg.body).toContain("only reminder");
  });
});
