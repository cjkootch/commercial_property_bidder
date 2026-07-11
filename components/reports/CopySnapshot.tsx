"use client";

import { useState } from "react";

// "Copy for Claude": puts the plain-markdown report snapshot on the clipboard
// so the operator can paste the exact numbers on screen into a working session
// — no screenshots, no retyping, no drift between what each of us is seeing.

export function CopySnapshot({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
    >
      {copied ? "Copied ✓" : "Copy report for Claude"}
    </button>
  );
}
