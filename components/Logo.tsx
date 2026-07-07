// Greenkeep logomark — an ownable, in-code SVG identity (no stock assets).
// A solid rounded "badge" (signals established/trustworthy) holding a clean leaf
// mark. Scales crisply anywhere and themes to the brand accent.

export function LogoMark({
  size = 32,
  color = "#2f7d4f",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="11" fill={color} />
      {/* leaf */}
      <path
        d="M20 8c-6 4-9 11-5.5 18.5C19 22 21 16 20 8Z"
        fill="#ffffff"
      />
      <path
        d="M20 8c6 4 9 11 5.5 18.5C21 22 19 16 20 8Z"
        fill="#ffffff"
        fillOpacity="0.78"
      />
      {/* stem */}
      <path d="M20 30c-1.2-4-1.2-9 0-15" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({
  size = 30,
  accent = "#2f7d4f",
  name = "Greenkeep",
  className,
  wordmarkClassName = "text-gray-900",
}: {
  size?: number;
  accent?: string;
  name?: string;
  className?: string;
  wordmarkClassName?: string;
}) {
  // The Greenkeep brand uses the uploaded circuit-leaf mark (public/brand/).
  // White-label tenants keep the accent-themed SVG badge.
  const isGreenkeep = name === "Greenkeep";
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {isGreenkeep ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/greenkeep-mark.png"
          alt=""
          width={size}
          height={size}
          className="object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <LogoMark size={size} color={accent} />
      )}
      <span className={`text-xl font-semibold tracking-tight ${wordmarkClassName}`}>{name}</span>
    </span>
  );
}
