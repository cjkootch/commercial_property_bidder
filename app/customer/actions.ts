"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { company, contact, proposal } from "@/lib/db/schema";
import { customerOwnsProposal } from "@/lib/db/queries";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_SESSION_MAX_AGE,
  signToken,
  verifyToken,
} from "@/lib/customer-auth";
import { sendEmail, getResendKey } from "@/lib/integrations/resend";

/** The signed-in customer's email from the session cookie, or null. */
function currentCustomer(): string | null {
  return verifyToken(cookies().get(CUSTOMER_COOKIE)?.value, "session");
}

/**
 * Request a magic login link. Anti-enumeration: always reports success. Only
 * actually emails a link if the address is a known contact (so we don't leak
 * who's in the system). The link carries a short-lived login token.
 */
export async function requestMagicLink(formData: FormData): Promise<void> {
  const email = ((formData.get("email") as string) || "").toLowerCase().trim();
  if (!email || !email.includes("@")) redirect("/customer/login?error=1");

  const [known] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(sql`lower(${contact.email}) = ${email}`)
    .limit(1);

  if (known && getResendKey()) {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    const token = signToken(email, "login");
    const link = `${base}/customer/verify?token=${encodeURIComponent(token)}`;
    const [co] = await db.select().from(company).limit(1);
    await sendEmail({
      to: email,
      subject: `Your ${co?.name ?? "account"} sign-in link`,
      html:
        `<p>Click below to sign in — the link expires in 30 minutes.</p>` +
        `<p><a href="${link}">Sign in</a></p>` +
        `<p style="font-size:12px;color:#888">If you didn't request this, you can ignore it.</p>`,
    });
  }
  redirect("/customer/login?sent=1");
}

/** Exchange a login token for a session cookie, then land in the portal. */
export async function completeMagicLogin(token: string): Promise<boolean> {
  const email = verifyToken(token, "login");
  if (!email) return false;
  cookies().set(CUSTOMER_COOKIE, signToken(email, "session"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE,
  });
  return true;
}

export async function customerLogout(): Promise<void> {
  cookies().delete(CUSTOMER_COOKIE);
  redirect("/customer/login");
}

/** Customer accepts a proposal (authorized against their session email). */
export async function acceptProposal(slug: string): Promise<void> {
  const email = currentCustomer();
  if (!email || !(await customerOwnsProposal(email, slug))) return;
  await db
    .update(proposal)
    .set({ status: "accepted", accepted_at: new Date(), updated_at: new Date() })
    .where(eq(proposal.slug, slug));
  await notifyOperator(`Proposal accepted by ${email}`, slug);
  revalidatePath("/customer");
}

/** Customer requests a walkthrough for a proposal. */
export async function requestWalkthrough(slug: string): Promise<void> {
  const email = currentCustomer();
  if (!email || !(await customerOwnsProposal(email, slug))) return;
  await db
    .update(proposal)
    .set({ walkthrough_requested_at: new Date(), updated_at: new Date() })
    .where(and(eq(proposal.slug, slug)));
  await notifyOperator(`Walkthrough requested by ${email}`, slug);
  revalidatePath("/customer");
}

/** Best-effort operator notification (email to the company address). */
async function notifyOperator(subject: string, slug: string) {
  try {
    if (!getResendKey()) return;
    const [co] = await db.select().from(company).limit(1);
    if (!co?.email) return;
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    await sendEmail({
      to: co.email,
      subject: `[Greenkeep] ${subject}`,
      html: `<p>${subject}</p><p>Proposal: <a href="${base}/proposals/${slug}">${base}/proposals/${slug}</a></p>`,
    });
  } catch {
    // non-blocking
  }
}
