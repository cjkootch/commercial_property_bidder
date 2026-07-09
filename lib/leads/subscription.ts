// First Look: the MRR layer. What the whole sourcing machine manufactures is
// EARLINESS — members buy it directly: brand-new leads appear on their shelf
// during the early-access window; everyone else sees them after it passes.
//
// The gate is DISPLAY-LEVEL by design: operator-initiated links (campaign
// claims, waterfall offers) keep working for anyone — the operator chose to
// send those. What non-members lose is organic discovery of the freshest
// inventory, which is exactly the product.

export const FIRST_LOOK_HOURS = 24;

export function firstLookPriceCents(): number {
  const usd = Number(process.env.FIRST_LOOK_PRICE_USD);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : 9900;
}

/** Is this buyer's First Look membership live right now? plan_expires_at is
 *  the safety net: a missed cancellation webhook lapses instead of comping. */
export function firstLookActive(
  b: { plan?: string | null; plan_expires_at?: Date | null } | null | undefined,
  now: Date = new Date()
): boolean {
  return (
    b?.plan === "first_look" &&
    b.plan_expires_at != null &&
    b.plan_expires_at.getTime() > now.getTime()
  );
}

/** Is a lead still inside the members-only early-access window? */
export function inFirstLookWindow(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() < FIRST_LOOK_HOURS * 3600_000;
}

/** Hours until a lead exits the window (ceil, min 1) — upsell copy. */
export function hoursUntilPublic(createdAt: Date, now: Date = new Date()): number {
  const ms = FIRST_LOOK_HOURS * 3600_000 - (now.getTime() - createdAt.getTime());
  return Math.max(1, Math.ceil(ms / 3600_000));
}
