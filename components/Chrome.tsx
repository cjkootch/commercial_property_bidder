"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

// Operator chrome: a grouped left sidebar (GA / Ads-manager style) on desktop,
// a top bar + slide-over drawer on mobile. Public, customer-facing pages
// render bare — no internal nav or width constraint.

// DEFAULT BARE: only known operator routes get the internal chrome.
// (The nav is links only — every operator page behind it is auth-gated —
// but internal chrome must never wrap a public page, so new public pages
// are born bare instead of needing to remember an allowlist entry.)
const OPERATOR_PREFIXES = [
  "/dashboard",
  "/reports",
  "/opportunities",
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

type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };
type NavSection = { label: string | null; items: NavItem[] };

const NAV: NavSection[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/reports", label: "Reports", icon: "chart" },
    ],
  },
  {
    label: "Acquisition",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: "megaphone" },
      { href: "/companies", label: "Companies", icon: "building" },
      { href: "/requests", label: "Bid requests", icon: "inbox" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/opportunities", label: "Opportunities", icon: "grid" },
      { href: "/leads", label: "Leads", icon: "tag" },
      { href: "/queue", label: "Queue", icon: "list" },
      { href: "/properties/new", label: "Add property", icon: "plus", exact: true },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/customers", label: "Buyers", icon: "users" },
      { href: "/messages", label: "Messages", icon: "chat" },
    ],
  },
  {
    label: "Residential",
    items: [{ href: "/packages", label: "Packages", icon: "package" }],
  },
  {
    label: "Settings",
    items: [{ href: "/config", label: "Config", icon: "cog" }],
  },
];

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const operator = OPERATOR_PREFIXES.some((p) => pathname?.startsWith(p));
  if (!operator) return <>{children}</>;

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV.map((section, i) => (
        <div key={i}>
          {section.label ? (
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {section.label}
            </div>
          ) : null}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-brand font-semibold text-white shadow-sm"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon name={item.icon} className={active ? "text-white" : "text-slate-500"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-800 bg-slate-900 lg:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3.5">
          <Link href="/dashboard" aria-label="Greenkeep" className="flex items-center gap-2">
            <Logo name="Greenkeep" wordmarkClassName="text-white" />
          </Link>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Operator
          </span>
        </div>
        {nav}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        <Link href="/dashboard" aria-label="Greenkeep">
          <Logo name="Greenkeep" />
        </Link>
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
              <Logo name="Greenkeep" wordmarkClassName="text-white" />
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}

      <main className="px-4 py-6 sm:px-6 sm:py-8 lg:pl-[264px] lg:pr-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </>
  );
}

// Minimal stroke icons (16px, geometric) — no icon dependency.
type IconName =
  | "home"
  | "chart"
  | "grid"
  | "megaphone"
  | "building"
  | "inbox"
  | "tag"
  | "list"
  | "plus"
  | "users"
  | "chat"
  | "package"
  | "cog";

const ICON_PATHS: Record<IconName, string> = {
  home: "M3 8.5 10 3l7 5.5V17h-5v-4.5H8V17H3V8.5Z",
  chart: "M3 17V9m4.5 8V4M12 17v-6.5m4.5 6.5V7",
  grid: "M3 3h6v6H3V3Zm8 0h6v6h-6V3ZM3 11h6v6H3v-6Zm8 0h6v6h-6v-6Z",
  megaphone: "M3 8v4h3l6 4V4L6 8H3Zm12.5-1a4 4 0 0 1 0 6",
  building: "M4 17V4h8v13M7 7h2m-2 3h2m3-3h2v10M2.5 17h15",
  inbox: "M3 11l2-7h10l2 7v6H3v-6Zm0 0h4.5a2.5 2.5 0 0 0 5 0H17",
  tag: "M3 3h6l8 8-6 6-8-8V3Zm4 4h.01",
  list: "M6.5 5H17M6.5 10H17M6.5 15H17M3 5h.01M3 10h.01M3 15h.01",
  plus: "M10 4v12M4 10h12",
  users: "M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 8a5 5 0 0 1 10 0M13 3.5a3 3 0 0 1 0 5.5m1.5 2.5a5 5 0 0 1 3.5 5.5",
  chat: "M3 4h14v9H8l-5 4V4Z",
  package: "M3 6l7-3 7 3v8l-7 3-7-3V6Zm0 0 7 3 7-3M10 9v8",
  cog: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-7-2.5h1.5M15.5 10H17M10 3v1.5M10 15.5V17M5.3 5.3l1 1M13.7 13.7l1 1M14.7 5.3l-1 1M6.3 13.7l-1 1",
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ""}`}
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
