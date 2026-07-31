import { describe, expect, it } from "vitest";
import {
  FOLLOWUP_MAX_DAYS,
  FOLLOWUP_MIN_HOURS,
  followUpEmail,
  followUpSms,
  selectClaimFollowUps,
  type ClaimViewer,
} from "./claim-followup";

const NOW = new Date("2026-07-31T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const viewer = (over: Partial<ClaimViewer> = {}): ClaimViewer => ({
  key: "acme",
  name: "Acme",
  trade: "landscaping",
  city: "Houston",
  lastViewAt: hoursAgo(24),
  converted: false,
  blocked: false,
  alreadyFollowedUp: false,
  ...over,
});

describe("selectClaimFollowUps", () => {
  it("picks up someone who read the offer yesterday and didn't act", () => {
    expect(selectClaimFollowUps([viewer()], NOW)).toHaveLength(1);
  });

  it("does NOT interrupt someone who may still be filling the form", () => {
    // The floor exists so we never text a person mid-claim. Texting someone
    // who is actively converting is the one way this feature loses money.
    expect(selectClaimFollowUps([viewer({ lastViewAt: hoursAgo(1) })], NOW)).toHaveLength(0);
    expect(
      selectClaimFollowUps([viewer({ lastViewAt: hoursAgo(FOLLOWUP_MIN_HOURS + 1) })], NOW)
    ).toHaveLength(1);
  });

  it("gives up after the job has gone stale", () => {
    // Past the ceiling this stops being a follow-up and becomes a cold pitch
    // about a job that has probably closed.
    expect(
      selectClaimFollowUps([viewer({ lastViewAt: daysAgo(FOLLOWUP_MAX_DAYS + 1) })], NOW)
    ).toHaveLength(0);
  });

  it("never follows up a company that already bought", () => {
    // "Still interested?" to a customer is embarrassing.
    expect(selectClaimFollowUps([viewer({ converted: true })], NOW)).toHaveLength(0);
  });

  it("respects the operator's block verdict", () => {
    expect(selectClaimFollowUps([viewer({ blocked: true })], NOW)).toHaveLength(0);
  });

  it("sends ONCE, ever — a second nudge is nagging", () => {
    expect(selectClaimFollowUps([viewer({ alreadyFollowedUp: true })], NOW)).toHaveLength(0);
  });

  it("ignores companies that never opened the offer", () => {
    // This job's whole premise is that they READ it. Email opens are the
    // nudge's job, not this one's.
    expect(selectClaimFollowUps([viewer({ lastViewAt: null })], NOW)).toHaveLength(0);
  });

  it("works the longest-waiting first", () => {
    const out = selectClaimFollowUps(
      [
        viewer({ key: "fresh", lastViewAt: hoursAgo(4) }),
        viewer({ key: "stale", lastViewAt: daysAgo(5) }),
        viewer({ key: "mid", lastViewAt: daysAgo(2) }),
      ],
      NOW
    );
    expect(out.map((r) => r.key)).toEqual(["stale", "mid", "fresh"]);
  });

  it("caps a run so one backlog can't blast the whole list", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      viewer({ key: `c${i}`, lastViewAt: daysAgo(1) })
    );
    expect(selectClaimFollowUps(many, NOW).length).toBeLessThanOrEqual(25);
  });
});

describe("the message", () => {
  it("names the JOB and never reveals that we track opens", () => {
    // "I saw you clicked" is creepy and burns the trust the offer earned.
    const text = followUpSms({ city: "Houston", trade: "landscaping" });
    expect(text).toContain("Houston");
    expect(text).not.toMatch(/saw you|you (clicked|opened|viewed|looked)|tracking|noticed/i);
  });

  it("fits one SMS segment", () => {
    // 160 GSM-7 chars. A follow-up that costs two segments is a follow-up
    // nobody reviewed.
    expect(followUpSms({ city: "Houston", trade: "landscaping" }).length).toBeLessThanOrEqual(160);
    expect(followUpSms({ city: null, trade: "pest" }).length).toBeLessThanOrEqual(160);
  });

  it("reads correctly when we have no city", () => {
    const text = followUpSms({ city: null, trade: "landscaping" });
    expect(text).not.toMatch(/\s{2,}/); // no double space where the city was
    expect(text).not.toContain("null");
  });

  it("asks a question rather than pushing", () => {
    // The point is to reopen a conversation, not to close. A prospect who
    // stalled has an unanswered objection; the job is to surface it.
    expect(followUpSms({ city: "Houston", trade: "hvac" })).toMatch(/\?$/);
  });

  it("the email invites the objection instead of re-pitching", () => {
    const { subject, body } = followUpEmail({
      company: "Acme",
      city: "Houston",
      trade: "landscaping",
      brand: "Greenkeep",
    });
    expect(subject).toContain("Houston");
    expect(body).toMatch(/tell me what you're actually looking for/i);
    expect(body).not.toMatch(/saw you|you (clicked|opened|viewed)/i);
  });
});
