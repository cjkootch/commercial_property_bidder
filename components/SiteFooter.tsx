import Link from "next/link";
import { Logo } from "./Logo";

/** Shared public-site footer: product + legal + contact + sign-ins. Used on
 *  every public marketing/legal page so cold-emailed prospects always find
 *  the trust surface (terms, privacy, a real contact) one scroll away. */
export function SiteFooter({
  name,
  accent,
  email,
}: {
  name: string;
  accent: string;
  email: string | null;
}) {
  return (
    <footer className="border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            <Logo accent={accent} name={name} size={24} />
            <p className="mt-3 max-w-xs text-sm text-gray-500">
              Job intelligence for commercial service companies. High-intent leads, measured and
              capped — never oversold.
            </p>
            {email ? (
              <a href={`mailto:${email}`} className="mt-3 inline-block text-sm font-medium text-gray-600 hover:text-gray-900">
                {email}
              </a>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
            <div>
              <div className="font-semibold text-gray-900">Product</div>
              <ul className="mt-3 space-y-2 text-gray-500">
                <li><Link href="/#how" className="hover:text-gray-900">How it works</Link></li>
                <li><Link href="/#pricing" className="hover:text-gray-900">Pricing</Link></li>
                <li><Link href="/why" className="hover:text-gray-900">The economics</Link></li>
                <li><Link href="/buyers/signup" className="hover:text-gray-900">Get your free sheet</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-gray-900">Company</div>
              <ul className="mt-3 space-y-2 text-gray-500">
                <li><Link href="/about" className="hover:text-gray-900">About</Link></li>
                <li><Link href="/contact" className="hover:text-gray-900">Contact</Link></li>
                <li><Link href="/terms" className="hover:text-gray-900">Terms</Link></li>
                <li><Link href="/privacy" className="hover:text-gray-900">Privacy</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-gray-900">Sign in</div>
              <ul className="mt-3 space-y-2 text-gray-500">
                <li><Link href="/buyers/login" className="hover:text-gray-900">Buyers</Link></li>
                <li><Link href="/customer/login" className="hover:text-gray-900">Customers</Link></li>
                <li><Link href="/login" className="hover:text-gray-900">Operator</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-10 border-t border-gray-200 pt-6 text-xs text-gray-400">
          © {new Date().getFullYear()} {name}. Property information is compiled from public
          records and our own measurements; contract values are estimates, not guarantees.
        </p>
      </div>
    </footer>
  );
}
