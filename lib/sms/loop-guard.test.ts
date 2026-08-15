import { describe, expect, it } from "vitest";
import {
  SAME_MOVE,
  contentTokens,
  detectLoop,
  isCounterpartyLooping,
  isSelfRepeat,
  similarity,
} from "./loop-guard";

// The actual 2026-07-31 transcript. Every threshold here is justified against
// these strings, not against intuition — if the tuning changes, it has to keep
// catching this.
const THEIRS = [
  "Got it! I'll keep JJ posted that Cole will be texting him directly. If you need anything else, just let me know!",
  "Thanks for the update! I'll keep JJ informed that Cole will be texting him directly. If you need anything else, just let me know!",
  "Got it! I'll make sure JJ knows Cole will be texting him directly to finalize the details. If you need anything else, just let me know!",
];
const OURS = [
  "Cole will text JJ directly.",
  "Cole will text JJ directly. Nothing else needed here.",
  "Cole will text JJ directly to lock in the specifics.",
];

describe("similarity", () => {
  it("scores the real looping messages as the same move", () => {
    expect(similarity(THEIRS[0], THEIRS[1])).toBeGreaterThanOrEqual(SAME_MOVE);
    expect(similarity(OURS[0], OURS[1])).toBeGreaterThanOrEqual(SAME_MOVE);
  });

  it("does NOT flag a real conversation about the same lead", () => {
    // These reuse city and trade every turn, which is exactly the false
    // positive that would silence the AI on legitimate threads.
    const a = "Cole with Greenkeep — that Houston commercial painting job is still open if you want it. Anything I can answer about it?";
    const b = "No call needed to grab it — JJ just opens the link and enters the company name plus an email or cell.";
    expect(similarity(a, b)).toBeLessThan(SAME_MOVE);
  });

  it("ignores the short link, which is freshly minted every send", () => {
    // Without stripping URLs each reply looks novel and the guard never fires.
    const a = "Here it is, no charge: https://greenkeep.us/l/Pt6hKYfmK";
    const b = "Here it is, no charge: https://greenkeep.us/l/jFWCCXgcj";
    expect(similarity(a, b)).toBe(1);
  });

  it("is symmetric and self-identical", () => {
    expect(similarity(THEIRS[0], THEIRS[1])).toBeCloseTo(similarity(THEIRS[1], THEIRS[0]));
    expect(similarity(OURS[0], OURS[0])).toBe(1);
  });

  it("treats two contentless pleasantries as the same move, not as novel", () => {
    expect(similarity("Got it, thanks!", "Okay, thank you!")).toBe(1);
  });
});

describe("contentTokens", () => {
  it("keeps the words that carry the meaning", () => {
    expect(contentTokens("Cole will text JJ directly.")).toEqual(["cole", "text", "jj", "directly"]);
  });
  it("drops pure filler entirely", () => {
    expect(contentTokens("Got it, thanks! Just let me know.")).toEqual([]);
  });
});

describe("isSelfRepeat", () => {
  it("catches the loop early — at the third echo, not the thirtieth", () => {
    // AI_REPLY_CAP would have allowed 27 more.
    expect(isSelfRepeat([OURS[0], OURS[1]], OURS[0])).toBe(true);
  });

  it("ALLOWS one echo — a recurring situation deserves the same answer twice", () => {
    // The Home Keepers case: they asked for a call on Monday and again on
    // Tuesday. "Cole will call you" is the correct reply both times.
    expect(isSelfRepeat([OURS[0]], OURS[0])).toBe(false);
  });

  it("catches a reworded repeat once it is the second echo", () => {
    expect(isSelfRepeat([OURS[2], OURS[1]], OURS[0])).toBe(true);
  });

  it("lets a genuinely new reply through", () => {
    const prior = ["Cole will text JJ directly."];
    const fresh = "The job is a 12,000 sq ft repaint off Westheimer, budget around $40k.";
    expect(isSelfRepeat(prior, fresh)).toBe(false);
  });

  it("only looks at recent replies, so an old topic can come back", () => {
    const long = [OURS[0], OURS[1], "a", "b", "c", "d", "e"].map(String);
    expect(isSelfRepeat(long, OURS[0])).toBe(false);
  });

  it("an empty history never trips it", () => {
    expect(isSelfRepeat([], OURS[0])).toBe(false);
  });
});

describe("isCounterpartyLooping", () => {
  // Helper: build an interleaved thread (them, us, them, us, them ...) — the
  // shape a bot loop actually has, since each of their messages answers ours.
  const interleaved = (theirs: string[]) =>
    theirs.flatMap((b, i) =>
      i === 0
        ? [{ direction: "in", body: b }]
        : [{ direction: "out", body: `our reply ${i}` }, { direction: "in", body: b }]
    );

  it("recognizes an auto-responder from three interchangeable INTERLEAVED messages", () => {
    expect(isCounterpartyLooping(interleaved(THEIRS))).toBe(true);
  });

  it("does NOT fire on two — a person repeating themselves deserves an answer", () => {
    expect(isCounterpartyLooping(interleaved(THEIRS.slice(0, 2)))).toBe(false);
  });

  it("does not fire on a real human thread", () => {
    expect(
      isCounterpartyLooping(
        interleaved(["Hello, yes definitely", "whats the address on it", "ok send me the link"])
      )
    ).toBe(false);
  });

  it("needs the run to be UNBROKEN — one substantive message resets it", () => {
    expect(
      isCounterpartyLooping(interleaved([THEIRS[0], "Whats your pricing for residential?", THEIRS[1]]))
    ).toBe(false);
  });

  it("does NOT fire when they sent a RUN with no reply from us", () => {
    // The Strategic Protection case. Identical messages, but nothing of ours
    // between them: that is a person being ignored, not a bot conversing.
    expect(
      isCounterpartyLooping([
        { direction: "out", body: "Hey, would you like a free lead on a large commercial job?" },
        { direction: "in", body: "Sure tell me more" },
        { direction: "in", body: "Sure tell me more" },
        { direction: "in", body: "Sure tell me more" },
        { direction: "in", body: "Sure tell me more" },
      ])
    ).toBe(false);
  });
});

describe("detectLoop", () => {
  it("reports WHICH loop tripped, because they need different human responses", () => {
    expect(
      detectLoop({ priorOwnReplies: [OURS[0], OURS[1]], tail: [], candidate: OURS[0] })
    ).toEqual({ stalled: true, reason: "self_repeat" });

    expect(
      detectLoop({
        priorOwnReplies: [],
        tail: [
          { direction: "in", body: THEIRS[0] },
          { direction: "out", body: "ok" },
          { direction: "in", body: THEIRS[1] },
          { direction: "out", body: "ok" },
          { direction: "in", body: THEIRS[2] },
        ],
        candidate: "Something new entirely",
      })
    ).toEqual({ stalled: true, reason: "counterparty_loop" });
  });

  it("stays out of the way of a healthy exchange", () => {
    expect(
      detectLoop({
        priorOwnReplies: ["Cole with Greenkeep — that Houston painting job is still open."],
        tail: [{ direction: "in", body: "Hello, yes definitely" }],
        candidate: "It's a 12,000 sq ft repaint off Westheimer, roughly $40k.",
      })
    ).toEqual({ stalled: false, reason: null });
  });

  it("would have stopped the real 2026-07-31 loop", () => {
    // Replay: by the third exchange both detectors are screaming.
    const verdict = detectLoop({
      priorOwnReplies: OURS,
      tail: [
        { direction: "in", body: THEIRS[0] },
        { direction: "out", body: OURS[0] },
        { direction: "in", body: THEIRS[1] },
        { direction: "out", body: OURS[1] },
        { direction: "in", body: THEIRS[2] },
      ],
      candidate: "Cole will text JJ directly.",
    });
    expect(verdict.stalled).toBe(true);
  });
});

describe("the containment trap", () => {
  // Overlap alone scores a short message 1.0 against any longer one that
  // contains its words. Left unguarded, the single most useful reply in a
  // thread — the one that finally answers with specifics — gets suppressed as
  // a "repeat" because it happens to name the same people.
  const short = "Cole will text JJ directly.";
  const substantive =
    "JJ — the Houston repaint is 12,000 sq ft, roughly $40k, and Cole can walk you through the scope directly.";

  it("does not call a substantive reply a repeat of a one-liner", () => {
    expect(similarity(short, substantive)).toBeLessThan(SAME_MOVE);
    expect(isSelfRepeat([short], substantive)).toBe(false);
  });

  it("still catches the loop, which is NOT lopsided", () => {
    // The guard must not be bought at the cost of the thing it exists for.
    expect(similarity(OURS[0], OURS[2])).toBeGreaterThanOrEqual(SAME_MOVE);
    expect(similarity(THEIRS[1], THEIRS[2])).toBeGreaterThanOrEqual(SAME_MOVE);
  });

  it("a long reply is not a repeat of a different long reply", () => {
    expect(
      similarity(
        substantive,
        "The building is off Westheimer, two stories, and the owner wants it done before October."
      )
    ).toBeLessThan(SAME_MOVE);
  });
});

describe("the leads this guard cost — regression fixtures", () => {
  // Both of these are real threads the first version of this guard silenced.
  // They are the reason it exists in its current form, and neither may ever
  // be suppressed again.

  it("answers a human hammering send (Strategic Protection, 2026-08-10)", () => {
    // Four identical messages in sixteen seconds — a person getting impatient
    // because nothing came back, which the first version read as a bot and
    // answered with silence. They were the warmest inbound in the database.
    const tail = [
      { direction: "out", body: "Hey, would you like a free lead on a large commercial job?" },
      { direction: "in", body: "Sure tell me more" },
      { direction: "in", body: "Sure tell me more" },
      { direction: "in", body: "Sure tell me more" },
      { direction: "in", body: "Sure tell me more" },
    ];
    expect(
      detectLoop({
        priorOwnReplies: [],
        tail,
        candidate: "Happy to — it's a Katy security job. Here's the link for first look.",
      })
    ).toEqual({ stalled: false, reason: null });
  });

  it("answers a prospect asking for a call again (Home Keepers, 2026-08-04)", () => {
    // They asked for a call Monday, we said Cole would ring 3-4. Tuesday they
    // asked again and said they were free "for the next 30 to 40 minutes".
    // The honest reply resembles Monday's (0.714) — because the situation
    // recurred, not because the AI was stuck.
    const priorOwnReplies = [
      "Got it — Cole will call you at 713-984-8639 between 3-4 CT.",
      "No rush. The Katy cleaning lead is still open when you're back.",
    ];
    const tail = [
      { direction: "out", body: "Heads up — your hold on the KATY cleaning job ends at 11:10 AM." },
      { direction: "in", body: "OK, I have asked if someone could call me." },
      { direction: "in", body: "I'm available right now for the next probably 30 to 40 minutes" },
    ];
    expect(
      detectLoop({
        priorOwnReplies,
        tail,
        candidate: "Got it — Cole will call you at 713-984-8639 in the next few minutes.",
      })
    ).toEqual({ stalled: false, reason: null });
  });

  it("STILL stops the bot loop it was built for (2026-07-31)", () => {
    // The fix must not be bought by reopening the original hole.
    const tail = [
      { direction: "in", body: THEIRS[0] },
      { direction: "out", body: OURS[0] },
      { direction: "in", body: THEIRS[1] },
      { direction: "out", body: OURS[1] },
      { direction: "in", body: THEIRS[2] },
    ];
    expect(
      detectLoop({ priorOwnReplies: OURS, tail, candidate: "Cole will text JJ directly." }).stalled
    ).toBe(true);
  });
});
