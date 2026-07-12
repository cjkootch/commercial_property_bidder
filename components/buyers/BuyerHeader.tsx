"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { buyerLogout } from "@/app/buyers/actions";

// Shared client-portal header: one header for every signed-in buyer page, so
// nav and branding never drift page to page. The current section is marked
// active (color + weight) so a buyer always knows where they are — the one
// usability gap in the old per-page headers, which rendered all links
// identically. Light + on-brand by design: the portal is a storefront, not
// the operator's dark instrument.

const NAV = [
  { href: "/buyers", label: "Leads", exact: true },
  { href: "/buyers/prospects", label: "My prospects" },
  { href: "/buyers/residential", label: "Residential" },
  { href: "/buyers/profile", label: "Profile" },
];

export function BuyerHeader({ brand = "Greenkeep" }: { brand?: string }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
        <Link href="/buyers" aria-label={brand}>
          <Logo name={brand} />
        </Link>
        <div className="flex items-center gap-5 text-sm font-medium">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "font-semibold text-brand"
                    : "text-gray-600 hover:text-gray-900"
                }
              >
                {item.label}
              </Link>
            );
          })}
          <form action={buyerLogout}>
            <button className="text-gray-600 hover:text-gray-900">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
