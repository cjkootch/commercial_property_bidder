// Per-signal "how to win it" playbooks. The dossier's guidance paragraph says
// WHY the property needs service; these steps say WHAT TO DO, in order, tuned
// to how vendor decisions actually get made for each signal type. Pure
// content — rendered on the job sheet and the public sample sheet. As
// outcome-loop replies accumulate, edit these to match what actually wins.

import type { LeadKind } from "./market";
import { TRADES, asTrade } from "./trades";

export type Playbook = { angle: string; steps: string[] };

/** Buyers read sheets on phones in trucks — every contact should be one tap
 *  from action. Emails become mailto: with the intro letter pre-filled,
 *  phones become tel:, mailing addresses open in Maps. */
export function contactHref(role: string, value: string, subject: string, letter: string): string | null {
  if (/\S+@\S+\.\S+/.test(value)) {
    // Slice the RAW letter before encoding so we never cut a %XX escape.
    return `mailto:${value}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter.slice(0, 1200))}`;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  if (/mail/i.test(role) && /\d/.test(value)) {
    return `https://maps.google.com/?q=${encodeURIComponent(value)}`;
  }
  return null;
}

export function playbookFor(kind: LeadKind, trade: string): Playbook {
  const service = TRADES[asTrade(trade)].service;
  switch (kind) {
    case "construction":
      return {
        angle: "Vendor selection happens BEFORE the ribbon cutting — the winner is usually signed 30–60 days pre-completion, while everyone else waits for the building to open.",
        steps: [
          "Call the architect or GC first, not the owner — they shortlist site vendors and love having one fewer thing to source.",
          `Lead with the construction timeline: "I saw you're wrapping up around the est. completion date — we set up ${service} contracts before handover so day one is covered."`,
          "Ask who's handling property management post-opening; get introduced while you're the only bidder in the room.",
          "Send the intro letter the same day you call — decision-makers on active builds move fast and forget faster.",
        ],
      };
    case "opening":
      return {
        angle: "A new business opening is signing EVERY vendor in the same two-week window — they don't shop hard, they take whoever shows up prepared.",
        steps: [
          "Reach out immediately — the window is the weeks around opening day, and the first credible bid usually wins.",
          `Offer an opening-month special: new operators are cash-tight and remember the ${service} company that made launch week easier.`,
          "Talk to the operator/manager on site, not corporate — local service decisions are almost always local.",
          "Ask for the neighboring units too: new tenants in a center often share a landlord who wants one vendor.",
        ],
      };
    case "violation":
      return {
        angle: "The owner is under a city compliance deadline — this is the one lead type where the prospect NEEDS to buy this week.",
        steps: [
          `Lead with speed, not price: "I can have this resolved by Friday and send you photo proof for the city."`,
          "Offer to handle it as a one-time cleanup, then quote the recurring contract AFTER you've solved their emergency — trust first, upsell second.",
          "Mention the case is public record (that's how you found it) — it signals the city is watching and you're the fastest way out.",
          "Follow up in 48 hours if no answer; violations escalate to fines and the urgency compounds in your favor.",
        ],
      };
    case "distress":
      return {
        angle: "Tax-sale properties change hands — the BUYER at auction needs every service contract from scratch, and nobody else is watching this.",
        steps: [
          "If the sale hasn't happened: pitch the current owner a cleanup that protects the property's sale value.",
          "If it has: the new owner is your real prospect — check the county deed record a few weeks after the auction date.",
          "Investors who buy at tax sales usually hold portfolios — win one property and ask what else they own.",
          "Keep the pitch practical and unsentimental; distressed-asset buyers respond to numbers, not relationship talk.",
        ],
      };
    case "transfer":
      return {
        angle: "New owners re-bid their vendors in the first year — the incumbent's contract is at its weakest the day the deed records.",
        steps: [
          `Open with the ownership change: "Congrats on the acquisition — most new owners re-quote ${service} in the first 90 days, so here's ours."`,
          "Don't trash the incumbent; offer a free walk-through audit that lets the property tell them what's been neglected.",
          "Target the property manager if there is one — owners of newly-bought commercial usually delegate vendor selection fast.",
          "If they just closed, they're reviewing EVERY line item — bundle pricing across services wins here.",
        ],
      };
    case "rfp":
      return {
        angle: "Public bids are won on compliance and completeness, not charm — most local competitors disqualify themselves on paperwork.",
        steps: [
          "Download the full solicitation TODAY and calendar the deadline minus two days — late means disqualified, no exceptions.",
          "Read the evaluation criteria first and mirror its exact language in your response; scorers check boxes.",
          "Attend the pre-bid meeting if there is one (it's often mandatory) and get on the plan-holders list for addenda.",
          "Ask the purchasing contact what tripped up prior bidders — they're public employees, they'll usually tell you.",
        ],
      };
  }
}
