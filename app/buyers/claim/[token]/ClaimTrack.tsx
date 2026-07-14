"use client";

import { useEffect, useRef } from "react";

// Fires the one POST that records a real human viewing this claim page — the
// hold, the funnel event, the claim-heat bump. Because it runs in the browser,
// email-security link scanners (which fetch the HTML but execute no JS) never
// trigger it, so they can't place bogus holds or pollute the funnel. Fire-once.
export function ClaimTrack(props: {
  token: string;
  event: string;
  trade: string;
  canHold: boolean;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fetch("/api/claim/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(props),
      keepalive: true,
    }).catch(() => {});
  }, [props]);
  return null;
}
