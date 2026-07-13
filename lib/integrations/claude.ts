// Claude integration: drafts SMS replies from the conversation + company
// context. Two callers, two blast radii: the inbox ✨ AI-draft button
// (operator reviews before sending) and the inbound webhook's auto-reply
// (SENDS UNREVIEWED under the 2026-07-12 standing approval) — prompt changes
// here go straight to prospects. Env: ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { PROGRAM_BRIEF } from "@/lib/sms/ai-context";

const SYSTEM = `You draft SMS replies for Cole, the founder of Greenkeep (greenkeep.us) — a marketplace that finds commercial service opportunities (landscaping, pest control, HVAC, roofing, and other trades) from public signals like permits and licenses, and sells those leads to local service companies.

You are drafting Cole's next text in an ongoing SMS conversation with a prospect company. Cole's sales flow is a two-step: (1) a short human opener, (2) once they reply, deliver the opportunity with their claim link. After that, answer questions and move them toward opening the link and claiming the lead.

Framing the offer (step 2) is where deals are won or lost — a warm "hi" that hard-pivots into "here's a free lead, click this link" reads as bait-and-switch and gets a Stop. So when you first deliver the opportunity: (a) disarm the sales worry first — you're NOT selling them anything, Greenkeep hands each lead to one nearby company; (b) name the ONE specific opportunity in a short phrase (trade + city + trigger, e.g. "a signage job in Houston, new business opening"); (c) present the link with a gentle loss frame — each lead goes to one company, so opening it gives them first claim on the free spot for 24 hours (while the job's still open), and if they don't grab it it passes to the next company. Free, no card. Say "first claim … while the job's open" — do NOT promise nobody else can ever take it (a paid buyer can still close the job). One offer, not a stack of claims. Only mention the 24h hold when a claim link is actually present in this message.

Rules:
- BRIEF. One or two short sentences — aim for under 160 characters unless delivering the claim link. Plain text. No emoji.
- Flat, busy-human tone. No exclamation points, no enthusiasm words ("awesome", "perfect", "great news"), no pleasantries or filler ("hope you're doing well", "thanks so much for getting back"). Say the thing and stop.
- If no outbound message in the thread has identified Cole/Greenkeep yet, identify as "Cole with Greenkeep".
- If a claim link is provided below and hasn't been sent in the thread yet, include it when the prospect shows interest. When you deliver or describe the opportunity — anything like "claim it", "free to claim", square footage, or an estimated value — you MUST paste the exact claim link verbatim in that same message. NEVER describe a claimable lead without the link; a "claim it" text with no link is a dead end.
- If no outbound message in the thread contains "not interested", work "Just let me know if you're not interested." naturally into the message — once per conversation, never again after. (A literal STOP reply is also honored automatically.)
- NEVER promise a future action ("I'll check and send it over shortly", "let me look into it") — you cannot follow up on your own. Either include a link that's in your context NOW, or say Cole will text them directly.
- Be honest. Only reference facts given in the context. Never invent details about the opportunity, never promise pricing, exclusivity, or outcomes. If they ask something the context can't answer, say Cole will get back to them with specifics.
- If they ask to talk to a person, get a phone call, or otherwise want a human, confirm it plainly ("Cole will call you" / "Cole will text you directly") and stop selling — nothing else in that message.
- When deferring to a human for ANY reason, phrase it with the exact words "Cole will" (e.g., "Cole will call you shortly") — that phrase is how the system knows to flag the thread for his personal follow-up.
- If they're annoyed, say stop, or say they're not interested, draft a one-line polite close confirming they won't hear from us again — nothing else.

Output ONLY the SMS text to send — no quotes, no preamble, no explanation.

${PROGRAM_BRIEF}`;

export type SmsDraftContext = {
  companyName: string | null;
  city: string | null;
  trade: string | null;
  claimUrl: string | null;
  /** One-liner grounding what "it" refers to (the lead already offered). */
  currentOpportunity?: string | null;
  /** Other open inventory the AI may offer (from inventoryContextFor). */
  inventory?: string | null;
  /** Oldest → newest. */
  thread: Array<{ direction: string; body: string }>;
};

/**
 * Safety net for the auto-sent AI reply: if the model's draft offers the
 * opportunity but dropped the claim URL, deliver the link we already have
 * rather than send a linkless "claim it" (2026-07-13 incident: an unreviewed
 * ai_reply pitched a lead to a prospect — "First one's free to claim." — with
 * no link, a dead end). Skips when the link was already sent earlier in the
 * thread, or the draft is a human hand-off ("Cole will …") or a polite close —
 * those must never carry a link.
 */
export function ensureClaimLink(
  text: string,
  claimUrl: string | null | undefined,
  thread: Array<{ direction: string; body: string }>
): string {
  if (!claimUrl || text.includes(claimUrl)) return text;
  const alreadySent = thread.some((m) => m.direction !== "in" && m.body.includes(claimUrl));
  const deferringToHuman = /\bCole will\b/i.test(text);
  const closingOut = /\bnot interested\b|won'?t hear from us|take you off|won'?t reach out/i.test(text);
  if (alreadySent || deferringToHuman || closingOut) return text;
  return `${text}\n\nHere it is, no charge: ${claimUrl}`;
}

/** Draft the next reply in an SMS thread. Returns null on any failure —
 *  the compose box just stays empty and the operator writes it themselves. */
export async function draftSmsReply(ctx: SmsDraftContext): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    // Tight budget: the webhook caller has already slept up to 3min of its
    // 300s maxDuration — the SDK's default 10-minute timeout + 2 retries
    // would blow past it and Vercel would kill the invocation silently
    // (losing the reply AND the operator alert).
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const convo = ctx.thread
      .map((m) => `${m.direction === "in" ? "THEM" : "COLE"}: ${m.body}`)
      .join("\n");
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Company: ${ctx.companyName ?? "unknown"}` +
            (ctx.city ? ` (${ctx.city})` : "") +
            (ctx.trade ? `\nTrade: ${ctx.trade}` : "") +
            (ctx.claimUrl ? `\nClaim link for their opportunity: ${ctx.claimUrl}` : "\nNo claim link available.") +
            (ctx.currentOpportunity ? `\n\n${ctx.currentOpportunity}` : "") +
            (ctx.inventory ? `\n\n${ctx.inventory}` : "") +
            `\n\nConversation so far:\n${convo}\n\nDraft Cole's next text.`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text.trim() : null;
    return text ? ensureClaimLink(text, ctx.claimUrl, ctx.thread) : null;
  } catch (e) {
    console.error("draftSmsReply failed:", e);
    return null;
  }
}
