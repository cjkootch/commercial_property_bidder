"use client";

import { useState } from "react";

// Copy the personalized intro letter to the clipboard (buyer pastes it into
// their email/letterhead). Falls back to selecting nothing loudly — just a
// transient "Copied" state.
export function CopyLetter({ text, accent }: { text: string; accent: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      style={{ backgroundColor: accent }}
    >
      {copied ? "Copied ✓" : "Copy letter"}
    </button>
  );
}
