import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grounds Acquisition Engine",
  description: "Commercial landscaping contract pricing & outreach",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/dashboard" className="text-lg font-semibold text-brand">
              Grounds Acquisition Engine
            </Link>
            <nav className="flex items-center gap-4 text-sm text-gray-600">
              <Link href="/dashboard" className="hover:text-brand">
                Dashboard
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
      </body>
    </html>
  );
}
