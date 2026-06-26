// Ownable hero backdrop: faint diagonal "mowing stripes" in the brand accent.
// A designed, brand-specific motif (vs. generic stock photography). Purely
// decorative; sits behind hero content.
export function BrandStripes({ accent = "#2f7d4f" }: { accent?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 600">
        <defs>
          <pattern
            id="mow"
            width="56"
            height="56"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-18)"
          >
            <rect width="56" height="56" fill="transparent" />
            <rect width="28" height="56" fill={accent} fillOpacity="0.05" />
          </pattern>
          <radialGradient id="fade" cx="50%" cy="0%" r="90%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.10" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1200" height="600" fill="url(#mow)" />
        <rect width="1200" height="600" fill="url(#fade)" />
      </svg>
    </div>
  );
}
