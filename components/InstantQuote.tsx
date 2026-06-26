"use client";

import { useState, useTransition } from "react";
import {
  getInstantEstimate,
  geocodeForEstimate,
  type InstantEstimateResult,
} from "@/app/quote/actions";

// Big homepage CTA: address → 2 quick questions → email → an aerial "measuring"
// screen of the customer's actual property → an instant quote page (frequency
// options + start date + what's-included + walkthrough CTA). Drops a measured
// lead into the pipeline server-side. Pricing is an honest RANGE, confirmed at a
// free walkthrough — we never commit to a firm online price.

const FREQUENCIES = [
  { key: "weekly", label: "Weekly", visitsPerMonth: 4.33, recommended: true },
  { key: "biweekly", label: "Every 2 weeks", visitsPerMonth: 2.17, recommended: false },
  { key: "monthly", label: "Monthly", visitsPerMonth: 1, recommended: false },
] as const;

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const money = (n: number) => `$${n.toLocaleString()}`;

export function InstantQuote({ accent }: { accent: string }) {
  const [step, setStep] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InstantEstimateResult | null>(null);
  const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [startTiming, setStartTiming] = useState("As soon as possible");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [freq, setFreq] = useState<(typeof FREQUENCIES)[number]["key"]>("weekly");

  function submit() {
    setMeasuring(true);
    startTransition(async () => {
      // Resolve coords first so the measuring screen can show the property.
      const geo = await geocodeForEstimate({ address, city, zip });
      setCoords(geo);
      const res = await getInstantEstimate({
        address,
        city,
        zip,
        type,
        startTiming,
        email,
        name,
        coords: geo ? [geo.lng, geo.lat] : undefined,
      });
      setResult(res);
      setMeasuring(false);
      setStep(3);
    });
  }

  const card = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm";

  // "Measuring" screen — aerial view of the customer's actual property.
  if (measuring) {
    return (
      <div className={`${card} text-center`}>
        <div className="relative mx-auto h-48 w-48">
          {/* Property imagery, circular-cropped */}
          <div className="absolute inset-2 overflow-hidden rounded-full bg-gray-100">
            {coords ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/property-preview?lng=${coords.lng}&lat=${coords.lat}&zoom=19`}
                alt="Aerial view of your property"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          {/* Sweeping arc */}
          <svg className="absolute inset-0 h-full w-full animate-spin" style={{ animationDuration: "1.4s" }} viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke={accent}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="80 210"
            />
          </svg>
        </div>
        <div className="mt-6 text-lg font-semibold">We&apos;re sizing your property</div>
        <p className="mx-auto mt-1 max-w-xs text-sm text-gray-500">
          Measuring your lawn and beds from the latest aerial imagery…
        </p>
      </div>
    );
  }

  // Step 3 — quote page (measured) or graceful lead-only fallback.
  if (step === 3) {
    if (result?.ok && result.measured) {
      const selected = FREQUENCIES.find((f) => f.key === freq) ?? FREQUENCIES[0];
      const monthlyLow = roundTo(result.perVisitLow * selected.visitsPerMonth, 5);
      const monthlyHigh = roundTo(result.perVisitHigh * selected.visitsPerMonth, 5);
      return (
        <div className={card}>
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-gray-400">Your instant estimate</div>
            <div className="mt-1 text-sm text-gray-500">{address}</div>
            <div className="mt-2 text-4xl font-bold" style={{ color: accent }}>
              {money(monthlyLow)}–{money(monthlyHigh)}
              <span className="text-lg font-medium text-gray-500">/mo</span>
            </div>
          </div>

          {/* Frequency options */}
          <div className="mt-5 space-y-2">
            <div className="text-sm font-medium text-gray-700">Choose a service frequency</div>
            {FREQUENCIES.map((f) => {
              const lo = roundTo(result.perVisitLow * f.visitsPerMonth, 5);
              const hi = roundTo(result.perVisitHigh * f.visitsPerMonth, 5);
              const active = f.key === freq;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFreq(f.key)}
                  className="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition"
                  style={
                    active
                      ? { borderColor: accent, backgroundColor: `${accent}0d` }
                      : { borderColor: "#e5e7eb" }
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{f.label}</span>
                    {f.recommended ? (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white" style={{ backgroundColor: accent }}>
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">
                    {money(lo)}–{money(hi)}<span className="font-normal text-gray-400">/mo</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* What's included */}
          <details className="mt-4 rounded-xl border border-gray-200 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">What&apos;s included?</summary>
            <ul className="mt-2 space-y-1 text-sm text-gray-600">
              {["Mowing & trimming", "Edging walkways & beds", "Blowing clippings off hard surfaces", "Licensed & insured crew"].map((i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span style={{ color: accent }}>✓</span> {i}
                </li>
              ))}
            </ul>
          </details>

          <p className="mt-4 text-center text-xs text-gray-500">
            Estimate from aerial measurements — we confirm the exact price at a quick, free
            walkthrough. A copy is in your inbox.
          </p>

          {result.bookingUrl ? (
            <a
              href={result.bookingUrl}
              className="mt-4 block rounded-lg px-6 py-3 text-center text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              Schedule my free walkthrough →
            </a>
          ) : (
            <p className="mt-4 text-center text-sm font-medium" style={{ color: accent }}>
              We&apos;ll email you to schedule your free walkthrough.
            </p>
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
