"use client";

import { useState, useTransition } from "react";
import { getInstantEstimate, type InstantEstimateResult } from "@/app/quote/actions";

// Big homepage CTA: address → 2 quick questions → email → instant estimate range
// + a calendar button to book the walkthrough. Drops a measured lead in the
// pipeline server-side.
export function InstantQuote({ accent }: { accent: string }) {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InstantEstimateResult | null>(null);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [startTiming, setStartTiming] = useState("As soon as possible");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await getInstantEstimate({ address, city, zip, type, startTiming, email, name });
      setResult(res);
      setStep(3);
    });
  }

  const card = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm";

  // Step 3 — result
  if (step === 3) {
    if (result?.ok && result.measured) {
      return (
        <div className={`${card} text-center`}>
          <div className="text-sm text-gray-500">Estimated for {address}</div>
          <div className="mt-1 text-4xl font-bold" style={{ color: accent }}>
            ${result.low.toLocaleString()}–${result.high.toLocaleString()}
            <span className="text-lg font-medium text-gray-500">/mo</span>
          </div>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
            Based on aerial measurements. We&apos;ll confirm the exact price at a quick walkthrough —
            a copy is in your inbox.
          </p>
          {result.bookingUrl ? (
            <a
              href={result.bookingUrl}
              className="mt-5 inline-block rounded-lg px-6 py-3 text-sm font-medium text-white"
              style={{ backgroundColor: accent }}
            >
              Schedule my free walkthrough →
            </a>
          ) : (
            <p className="mt-5 text-sm font-medium" style={{ color: accent }}>We&apos;ll email you to schedule a walkthrough.</p>
          )}
        </div>
      );
    }
    return (
      <div className={`${card} text-center`}>
        <div className="text-lg font-semibold">Thanks — your estimate is on the way.</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
          {result?.ok === false
            ? result.error
            : `We're preparing your estimate for ${address} and will email it shortly.`}
        </p>
        {result?.ok && !result.measured && result.bookingUrl ? (
          <a href={result.bookingUrl} className="mt-5 inline-block rounded-lg px-6 py-3 text-sm font-medium text-white" style={{ backgroundColor: accent }}>
            Schedule a walkthrough →
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className={card}>
      {step === 0 ? (
        <div className="space-y-3 text-left">
          <label className="text-sm font-medium text-gray-700">Get an instant estimate</label>
          <input
            autoFocus
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Property address"
            className="input"
          />
          <div className="grid grid-cols-2 gap-3">
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="input" />
            <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" className="input" />
          </div>
          <button
            type="button"
            disabled={!address.trim()}
            onClick={() => setStep(1)}
            className="w-full rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            See my price →
          </button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4 text-left">
          <div>
            <label className="text-sm font-medium text-gray-700">This property is…</label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(["residential", "commercial"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium capitalize"
                  style={
                    type === t
                      ? { borderColor: accent, color: accent, backgroundColor: `${accent}0d` }
                      : { borderColor: "#e5e7eb", color: "#374151" }
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">When would you want to start?</span>
            <select value={startTiming} onChange={(e) => setStartTiming(e.target.value)} className="input mt-1">
              <option>As soon as possible</option>
              <option>Within 2–4 weeks</option>
              <option>1–2 months out</option>
              <option>Just exploring</option>
            </select>
          </label>
          <button type="button" onClick={() => setStep(2)} className="w-full rounded-lg px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
            Continue →
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3 text-left">
          <label className="text-sm font-medium text-gray-700">Where should we send your estimate?</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="input" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
          />
          <button
            type="button"
            disabled={pending || !email.includes("@")}
            onClick={submit}
            className="w-full rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {pending ? "Measuring your property…" : "See my estimate →"}
          </button>
          <p className="text-center text-xs text-gray-400">No obligation. We&apos;ll only use this to send your quote.</p>
        </div>
      ) : null}
    </div>
  );
}
