"use client";

import { useEffect, useRef } from "react";

// Fires the one POST that records a real human viewing this claim page — the
// hold, the funnel event, the claim-heat bump.
//
// Why it's gated on *input*, not on mount (2026-07-15): link scanners now run
// full headless browsers that execute JS — companies we hadn't messaged in two
// days "viewed" their links hourly, two different companies' links 1s apart —
// so a mount-time POST re-placed bogus holds. Rendering a page is automatable;
// touching it is not: scanners produce no pointer/touch/scroll/key input, and
// any real visitor produces one within moments (mobile can't even scroll
// without touching). Fire-once, on the first input of any kind.
export function ClaimTrack(props: {
  token: string;
  event: string;
  trade: string;
  canHold: boolean;
}) {
  const fired = useRef(false);
  useEffect(() => {
    const EVENTS = [
      "pointerdown",
      "pointermove",
      "touchstart",
      "wheel",
      "scroll",
      "keydown",
    ] as const;
    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      cleanup();
      fetch("/api/claim/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(props),
        keepalive: true,
      }).catch(() => {});
    };
    const cleanup = () =>
      EVENTS.forEach((e) => window.removeEventListener(e, fire));
    EVENTS.forEach((e) =>
      window.addEventListener(e, fire, { passive: true })
    );
    return cleanup;
  }, [props]);
  return null;
}
