import Link from "next/link";
import { Logo } from "@/components/Logo";

export type Brand = {
  name: string;
  accent: string;
  phone: string | null;
  email: string | null;
};

/** Shared header + footer for all public marketing pages, so the home, the
 *  residential journey, and the commercial journey stay visually consistent. */
export function MarketingShell({
  brand,
  active,
  children,
}: {
  brand: Brand;
  active?: "residential" | "commercial";
  children: React.ReactNode;
}) {
  const { name, accent } = brand;
  const navLink = (href: string, label: string, key: "residential" | "commercial") =>
    `text-sm hover:text-gray-900 ${active === key ? "font-semibold text-gray-900" : "text-gray-600"}`;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label={name}>
            <Logo accent={accent} name={name} />
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/residential" className={navLink("/residential", "Residential", "residential")}>
              Residential
            </Link>
            <Link href="/commercial" className={navLink("/commercial", "Commercial", "commercial")}>
              Commercial
            </Link>
            <Link href="/customer/login" className="text-sm font-medium" style={{ color: accent }}>
              Customer sign-in
            </Link>
          </nav>
        </div>
      </header>

      {children}

      <footer id="contact" className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-10 text-center">
          <h2 className="text-lg font-semibold">Get a free, no-pressure quote</h2>
          <div className="mt-3 text-sm text-gray-700">
            {brand.phone ? <div>{brand.phone}</div> : null}
            {brand.email ? (
              <a href={`mailto:${brand.email}`} className="font-medium" style={{ color: accent }}>
                {brand.email}
              </a>
            ) : null}
          </div>
          <p className="mt-6 text-xs text-gray-400">
            © {name}. ·{" "}
            <Link href="/login" className="hover:text-gray-600">Operator login</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Primary CTA button (segment-tailored label/target). */
export function CtaButton({ href, accent, children }: { href: string; accent: string; children: React.ReactNode }) {
  return (
    <a href={href} className="rounded-lg px-6 py-3 text-sm font-medium text-white" style={{ backgroundColor: accent }}>
      {children}
    </a>
  );
}
