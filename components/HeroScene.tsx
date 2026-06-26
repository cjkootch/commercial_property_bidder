// Ownable hero illustration: a clean line-art neighborhood scene (picket fence,
// trees, pickup, push mower, house) on a faint brand-green hill. Vector, themed
// to the brand accent, no external assets — the "develop a brand, not stock
// images" direction. Anchored to the bottom of the hero as a backdrop; hidden on
// small screens to keep the mobile hero focused on the address bar.
export function HeroScene({ accent, className = "" }: { accent: string; className?: string }) {
  const line = "#aab3ad"; // soft gray-green outline
  const sw = 2.5;
  const fenceTop = 250;
  const ground = 300;

  return (
    <svg
      className={className}
      viewBox="0 0 1200 340"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="xMidYMax meet"
    >
      {/* Faint ground hill */}
      <path d="M0 295 C 320 245, 760 240, 1200 215 L1200 340 L0 340 Z" fill={`${accent}1f`} />

      {/* Picket fence — rails first, pickets on top so rails show through gaps */}
      <line x1="0" y1={fenceTop + 16} x2="1200" y2={fenceTop + 16} stroke={line} strokeWidth={sw} />
      <line x1="0" y1={fenceTop + 36} x2="1200" y2={fenceTop + 36} stroke={line} strokeWidth={sw} />
      {Array.from({ length: 30 }).map((_, i) => {
        const x = i * 42;
        return (
          <path
            key={i}
            d={`M${x} ${ground} L${x} ${fenceTop + 8} L${x + 9} ${fenceTop} L${x + 18} ${fenceTop + 8} L${x + 18} ${ground}`}
            stroke={line}
            strokeWidth={sw}
            fill="#ffffff"
            strokeLinejoin="round"
          />
        );
      })}

      {/* Left tree */}
      <line x1="360" y1={ground} x2="360" y2="232" stroke={line} strokeWidth="6" strokeLinecap="round" />
      <circle cx="360" cy="222" r="48" fill={accent} />

      {/* Push mower */}
      <g stroke={line} strokeWidth={sw} fill="#ffffff" strokeLinecap="round" strokeLinejoin="round">
        <path d="M470 232 L505 260" /> {/* handle */}
        <rect x="496" y="262" width="58" height="26" rx="4" /> {/* deck */}
        <circle cx="508" cy="294" r="9" fill="#ffffff" />
        <circle cx="544" cy="294" r="9" fill="#ffffff" />
      </g>

      {/* Pickup truck (side view, cab left) */}
      <g stroke={line} strokeWidth={sw} fill="#ffffff" strokeLinecap="round" strokeLinejoin="round">
        <path d="M590 296 L590 272 L598 272 L612 243 L676 243 L686 272 L788 272 L788 296 Z" />
        <path d="M618 248 L668 248 L674 270 L618 270 Z" fill={`${accent}26`} /> {/* cab window */}
        <line x1="686" y1="272" x2="788" y2="272" /> {/* bed top */}
        <circle cx="632" cy="296" r="20" fill="#ffffff" />
        <circle cx="632" cy="296" r="7" fill={line} stroke="none" />
        <circle cx="748" cy="296" r="20" fill="#ffffff" />
        <circle cx="748" cy="296" r="7" fill={line} stroke="none" />
      </g>

      {/* House (right) */}
      <ellipse cx="1035" cy="306" rx="160" ry="10" fill={`${accent}1f`} />
      <g stroke={line} strokeWidth={sw} fill="#ffffff" strokeLinejoin="round">
        {/* body */}
        <rect x="905" y="208" width="262" height="92" />
        {/* gable roof */}
        <path d="M888 213 L1036 140 L1184 213 Z" fill="#ffffff" />
        {/* chimney */}
        <rect x="1112" y="156" width="22" height="48" />
        {/* garage door */}
        <rect x="922" y="238" width="96" height="62" fill={`${accent}14`} />
        <line x1="922" y1="258" x2="1018" y2="258" />
        <line x1="922" y1="278" x2="1018" y2="278" />
        {/* front door */}
        <rect x="1052" y="236" width="40" height="64" fill={`${accent}14`} />
        {/* window + mullions */}
        <rect x="1108" y="232" width="46" height="42" fill={`${accent}26`} />
        <line x1="1131" y1="232" x2="1131" y2="274" />
        <line x1="1108" y1="253" x2="1154" y2="253" />
      </g>
    </svg>
  );
}
