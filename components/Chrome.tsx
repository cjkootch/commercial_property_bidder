"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

// Operator chrome (nav + centered main) for internal pages. Public, customer-
// facing proposal pages render bare — no internal nav or width constraint.
export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Public / customer-facing routes render bare (their own headers); only the
  // operator app gets the internal nav chrome.
  const bare =
    pathname === "/" ||
    pathname?.startsWith("/residential") ||
    pathname?.startsWith("/commercial") ||
    pathname?.startsWith("/quote") ||
    pathname?.startsWith("/proposals") ||
    pathname?.startsWith("/customer") ||
    pathname?.startsWith("/buyers") ||
    pathname?.startsWith("/login");
  if (bare) return <>{children}</>;

  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" aria-label="Greenkeep" className="flex items-center gap-2">
            <Logo name="Greenkeep" />
            <span className="hidden text-xs font-medium uppercase tracking-wide text-gray-400 sm:inline">
              Operator
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-gray-600">
            <Link href="/dashboard" className="hover:text-brand">
              Dashboard
            </Link>
            <Link href="/queue" className="hover:text-brand">
              Queue
            </Link>
            <Link href="/leads" className="hover:text-brand">
              Leads
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
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
