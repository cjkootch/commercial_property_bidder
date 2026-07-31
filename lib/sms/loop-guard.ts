// Bot-to-bot loop detection for the SMS auto-replier.
//
// On 2026-07-31 our AI and a prospect's AI receptionist exchanged 26 messages
// in 40 minutes. Ours sent "Cole will text JJ directly." verbatim eight times;
// theirs answered "Got it! I'll keep JJ posted..." / "Thanks for the update!
// I'll keep JJ informed..." — different words, identical content, and every
// one of them looked to our webhook like a fresh inbound needing an answer.
//
// AI_REPLY_CAP (30 per 24h) did not help. Its comment said "no legit sales
// conversation gets near this number", which is true and exactly why it was
// the wrong brake: a bot conversation gets there in an hour, and a cap that
// only trips after thirty messages has already sent thirty. Volume is the
// wrong signal. REPETITION is the signal, and it is visible at message two.
//
// Two independent detectors, either of which suppresses the auto-reply and
// hands the thread to the operator:
//
//   1. We are repeating OURSELVES — the drafted reply says what we already
//      said. Nothing is being added; the model has run out of moves.
//   2. THEY are repeating themselves — the last few inbounds are mutually
//      interchangeable, which is what an auto-responder looks like and what
//      a human almost never does.
//
// Both compare meaning-ish rather than bytes, because the loop that motivated
// this drifted its wording every turn while saying the same thing.

/** Words that carry no signal for "did this message say the same thing" —
 *  the pleasantries a receptionist bot varies while the content stays fixed. */
const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "if", "so", "just", "got", "it", "ok",
  "okay", "thanks", "thank", "you", "your", "yours", "please", "hey", "hi",
  "hello", "sure", "great", "appreciate", "let", "know", "me", "my", "i", "ill",
  "im", "ive", "well", "will", "be", "is", "are", "was", "were", "to", "for",
  "of", "on", "in", "at", "with", "that", "this", "any", "anything", "else",
  "need", "want", "can", "would", "could", "should", "do", "does", "did",
  "have", "has", "had", "up", "out", "as", "we", "us", "our",
]);

/** Lowercase, drop punctuation and URLs, split to content words. Short links
 *  are stripped because we mint a FRESH one per send — leaving them in would
 *  make every reply look novel, which is the opposite of what we need. */
export function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));
}

/** Overlap coefficient of content words, 0..1 — shared / smaller set.
 *
 *  NOT Jaccard, which was the first attempt and failed on the real transcript.
 *  Jaccard divides by the union, so decoration dilutes it: "I'll keep JJ
 *  informed that Cole will be texting him directly" against "I'll make sure JJ
 *  knows Cole will be texting him directly to finalize the details" scores
 *  0.39 — the identical core is outvoted by "finalize" and "details". The
 *  overlap coefficient asks the question we actually care about: is one
 *  message's content already contained in the other's? That scores 0.63 and
 *  catches it.
 *
 *  Two empty messages count as identical — a pair of contentless pleasantries
 *  IS the loop, not an exception to it.
 *
 *  The containment trap: overlap alone scores a SHORT message 1.0 against any
 *  longer one that happens to contain its words. "Cole will text JJ directly"
 *  against "JJ — the Houston repaint is 12,000 sq ft, roughly $40k, and Cole
 *  can walk you through the scope directly" scores 0.75, so the one genuinely
 *  useful reply in the thread would be suppressed as a repeat. When one
 *  message carries much more information than the other they are not the same
 *  move, whatever they share, so a large length disparity falls back to
 *  Jaccard — which divides by the union and correctly scores that pair 0.20. */
export const CONTAINMENT_MIN_RATIO = 0.5;

export function similarity(a: string, b: string): number {
  const A = new Set(contentTokens(a));
  const B = new Set(contentTokens(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  const small = Math.min(A.size, B.size);
  const large = Math.max(A.size, B.size);
  return small / large < CONTAINMENT_MIN_RATIO
    ? shared / (A.size + B.size - shared) // lopsided: strict
    : shared / small; // comparable: same move with different trimmings
}

/** Above this, two messages are "the same move". Tuned against the real
 *  transcript: the looping pairs scored well above it, while genuine
 *  back-and-forth about one lead (which reuses the city and trade every turn)
 *  scored below. */
export const SAME_MOVE = 0.6;

/** How far back to look. Small on purpose — a long conversation legitimately
 *  revisits topics; what we are catching is an immediate ping-pong. */
export const LOOKBACK = 4;

/** Would sending `candidate` just repeat something we already said? Compares
 *  against our most recent replies only. */
export function isSelfRepeat(priorOwnReplies: readonly string[], candidate: string): boolean {
  return priorOwnReplies
    .slice(-LOOKBACK)
    .some((prior) => similarity(prior, candidate) >= SAME_MOVE);
}

/** Is the OTHER side looping? True when the last few inbounds are mutually
 *  interchangeable. Needs at least three: two similar messages is a person
 *  repeating themselves because we were unclear, which deserves an answer,
 *  not a shrug. */
export function isCounterpartyLooping(recentInbounds: readonly string[]): boolean {
  const recent = recentInbounds.slice(-3);
  if (recent.length < 3) return false;
  for (let i = 1; i < recent.length; i++) {
    if (similarity(recent[i - 1], recent[i]) < SAME_MOVE) return false;
  }
  return true;
}

export type LoopVerdict = { stalled: boolean; reason: "self_repeat" | "counterparty_loop" | null };

/** The whole decision, in one call. Returning the reason (not just a boolean)
 *  so the operator alert can say WHICH loop tripped — "we ran out of things to
 *  say" and "their bot is answering ours" need different responses from a
 *  human. */
export function detectLoop(args: {
  priorOwnReplies: readonly string[];
  recentInbounds: readonly string[];
  candidate: string;
}): LoopVerdict {
  if (isSelfRepeat(args.priorOwnReplies, args.candidate)) {
    return { stalled: true, reason: "self_repeat" };
  }
  if (isCounterpartyLooping(args.recentInbounds)) {
    return { stalled: true, reason: "counterparty_loop" };
  }
  return { stalled: false, reason: null };
}
