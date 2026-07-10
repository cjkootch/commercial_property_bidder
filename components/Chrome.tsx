"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

// Operator chrome (nav + centered main) for internal pages. Public, customer-
// facing proposal pages render bare — no internal nav or width constraint.
export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // DEFAULT BARE: only known operator routes get the internal nav chrome.
  // (The nav is links only — every operator page behind it is auth-gated —
  // but internal chrome must never wrap a public page, so new public pages
  // are born bare instead of needing to remember an allowlist entry.)
  const OPERATOR_PREFIXES = [
    "/dashboard",
    "/queue",
    "/leads",
    "/campaigns",
    "/messages",
    "/properties",
    "/config",
    "/customers",
    "/requests",
    "/companies",
    "/packages",
  ];
  const operator = OPERATOR_PREFIXES.some((p) => pathname?.startsWith(p));
  if (!operator) return <>{children}</>;

  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" aria-label="Greenkeep" className="flex shrink-0 items-center gap-2">
            <Logo name="Greenkeep" />
            <span className="hidden text-xs font-medium uppercase tracking-wide text-gray-400 lg:inline">
              Operator
            </span>
          </Link>
          {/* min-w-0 lets the nav shrink instead of overlapping the logo; it
              scrolls horizontally on phones so every link stays reachable. */}
          <nav className="flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap py-1 text-sm text-gray-600">
            <Link href="/dashboard" className="hover:text-brand">
              Dashboard
            </Link>
            <Link href="/queue" className="hover:text-brand">
              Queue
            </Link>
            <Link href="/leads" className="hover:text-brand">
              Leads
            </Link>
            <Link href="/campaigns" className="hover:text-brand">
              Campaigns
            </Link>
            <Link href="/messages" className="hover:text-brand">
              Messages
            </Link>
            <Link href="/customers" className="hover:text-brand">
              Customers
            </Link>
            <Link href="/companies" className="hover:text-brand">
              Companies
            </Link>
            <Link href="/requests" className="hover:text-brand">
              Requests
            </Link>
            <Link href="/packages" className="hover:text-brand">
              Residential
            </Link>
            <Link href="/properties/new" className="hover:text-brand">
              Add property
            </Link>
            <Link href="/config" className="hover:text-brand">
              Config
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </>
  );
}
