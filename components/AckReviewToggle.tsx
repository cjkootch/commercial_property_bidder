"use client";

import { useTransition } from "react";
import { setAcknowledgedReview } from "@/app/properties/actions";

export function AckReviewToggle({
  propertyId,
  initial,
}: {
  propertyId: string;
  initial: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        defaultChecked={initial}
        disabled={pending}
        onChange={(e) => {
          const checked = e.target.checked;
          startTransition(() => setAcknowledgedReview(propertyId, checked));
        }}
        className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
      />
      <span className={pending ? "text-gray-400" : "text-gray-700"}>
        I&apos;ve reviewed the flags and acknowledge them (required to send)
      </span>
    </label>
  );
}
