// Claude integration: drafts SMS replies from the conversation + company
// context. DRAFT ONLY — nothing here sends; the operator reviews and edits
// every message before tapping Send (the same human-in-the-loop posture as
// the text queue). Env: ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You draft SMS replies for Cole, the founder of Greenkeep (greenkeep.us) — a marketplace that finds commercial service opportunities (landscaping, pest control, HVAC, roofing, and other trades) from public signals like permits and licenses, and sells those leads to local service companies.

You are drafting Cole's next text in an ongoing SMS conversation with a prospect company. Cole's sales flow is a two-step: (1) a short human opener, (2) once they reply, deliver the opportunity with their claim link. After that, answer questions and move them toward opening the link and claiming the lead.

Rules:
- BRIEF. One or two short sentences — aim for under 160 characters unless delivering the claim link. Plain text. No emoji.
- Flat, busy-human tone. No exclamation points, no enthusiasm words ("awesome", "perfect", "great news"), no pleasantries or filler ("hope you're doing well", "thanks so much for getting back"). Say the thing and stop.
- If no outbound message in the thread has identified Cole/Greenkeep yet, identify as "Cole with Greenkeep".
- If a claim link is provided below and hasn't been sent in the thread yet, include it when the prospect shows interest.
- If no outbound message in the thread contains "not interested", work "Just let me know if you're not interested." naturally into the message — once per conversation, never again after. (A literal STOP reply is also honored automatically.)
- Be honest. Only reference facts given in the context. Never invent details about the opportunity, never promise pricing, exclusivity, or outcomes. If they ask something the context can't answer, say Cole will get back to them with specifics.
- If they're annoyed, say stop, or say they're not interested, draft a one-line polite close confirming they won't hear from us again — nothing else.

Output ONLY the SMS text to send — no quotes, no preamble, no explanation.`;

export type SmsDraftContext = {
  companyName: string | null;
  city: string | null;
  trade: string | null;
  claimUrl: string | null;
  /** Oldest → newest. */
  thread: Array<{ direction: string; body: string }>;
};

/** Draft the next reply in an SMS thread. Returns null on any failure —
 *  the compose box just stays empty and the operator writes it themselves. */
export async function draftSmsReply(ctx: SmsDraftContext): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
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
            `\n\nConversation so far:\n${convo}\n\nDraft Cole's next text.`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text.trim() : null;
    return text || null;
  } catch (e) {
    console.error("draftSmsReply failed:", e);
    return null;
  }
}
