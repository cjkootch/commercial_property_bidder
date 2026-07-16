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
    // Input alone stopped being enough (2026-07-16: appliances simulate it) —
    // the POST also waits out a minimum dwell and reports it, so a machine
    // racing through a link list gets filtered server-side.
    const MIN_DWELL_MS = 1500;
    const loadedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const post = () => {
      fetch("/api/claim/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...props, dwellMs: Date.now() - loadedAt }),
        keepalive: true,
      }).catch(() => {});
    };
    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      cleanup();
      const wait = Math.max(0, MIN_DWELL_MS - (Date.now() - loadedAt));
      timer = setTimeout(post, wait);
    };
    const cleanup = () =>
      EVENTS.forEach((e) => window.removeEventListener(e, fire));
    EVENTS.forEach((e) =>
      window.addEventListener(e, fire, { passive: true })
    );
    return () => {
      cleanup();
      if (timer) clearTimeout(timer);
    };
  }, [props]);
  return null;
}
