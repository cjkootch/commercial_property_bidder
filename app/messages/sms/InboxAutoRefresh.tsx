"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps the SMS inbox live without a manual refresh. The page is
// `force-dynamic`, so `router.refresh()` re-runs the server component and
// streams in new replies + delivery-status changes in place (client state and
// the active thread are preserved). Guards: only while the tab is visible, and
// never while the operator is typing a reply (a refresh mustn't wipe the box).
export function InboxAutoRefresh({ intervalMs = 7000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "TEXTAREA" ||
          el.tagName === "INPUT" ||
          el.isContentEditable);
      if (typing) return;
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
