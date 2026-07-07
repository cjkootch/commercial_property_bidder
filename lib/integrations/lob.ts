// Lob integration (print + mail) over raw REST. Sends a branded postcard to a
// lead's owner on the buyer's behalf — the buyer is the sender (their return
// address + logo), so this is their outreach, not ours. Test keys (test_...)
// run in Lob's sandbox: address verification always returns "undeliverable"
// for real addresses, so we only HARD-BLOCK undeliverable on live_ keys.

export function getLobKey(): string | null {
  const k = process.env.LOB_API_KEY;
  return k && k.length > 0 ? k : null;
}
export function isLobLive(): boolean {
  return (getLobKey() ?? "").startsWith("live_");
}

function auth(): string {
  return "Basic " + Buffer.from(`${getLobKey()}:`).toString("base64");
}

export type LobAddress = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
};

/** Split a one-line mailing address ("PO BOX 1562, HOUSTON, TX 77251-1562")
 *  into Lob parts. Best-effort; Lob verification/cleansing does the rest. */
export function parseAddress(oneLine: string, fallbackName: string): LobAddress | null {
  const parts = oneLine.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]; // "TX 77251-1562"
  const m = last.match(/([A-Z]{2})\s+(\d{5})(?:-\d{4})?/i);
  if (!m) return null;
  const state = m[1].toUpperCase();
  const zip = m[2];
  const city = parts.length >= 3 ? parts[parts.length - 2] : "";
  const line1 = parts.slice(0, parts.length - 2).join(", ") || parts[0];
  if (!line1 || !city) return null;
  return { name: fallbackName, line1, city, state, zip };
}

export type VerifyResult = { deliverable: boolean; note: string; cleansed: LobAddress | null };

/** Verify + cleanse an address. Returns deliverable=true when Lob is confident,
 *  OR on a test key (sandbox can't validate real addresses). `cleansed` carries
 *  Lob's corrected components (incl. the real ZIP) when available. Never throws. */
export async function verifyDeliverable(a: LobAddress): Promise<VerifyResult> {
  const key = getLobKey();
  if (!key) return { deliverable: false, note: "Mailing not configured.", cleansed: null };
  try {
    const res = await fetch("https://api.lob.com/v1/us_verifications", {
      method: "POST",
      headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        primary_line: a.line1,
        secondary_line: a.line2 ?? "",
        city: a.city,
        state: a.state,
        zip_code: a.zip,
      }),
    });
    const d = (await res.json()) as {
      deliverability?: string;
      primary_line?: string;
      secondary_line?: string;
      components?: { city?: string; state?: string; zip_code?: string; zip_code_plus_4?: string };
    };
    const c = d.components;
    const cleansed: LobAddress | null =
      c?.zip_code && d.primary_line
        ? {
            name: a.name,
            line1: d.primary_line,
            line2: d.secondary_line || null,
            city: c.city ?? a.city,
            state: c.state ?? a.state,
            zip: c.zip_code_plus_4 ? `${c.zip_code}-${c.zip_code_plus_4}` : c.zip_code,
          }
        : null;
    const ok = ["deliverable", "deliverable_unnecessary_unit", "deliverable_incorrect_unit", "deliverable_missing_unit"].includes(
      d.deliverability ?? ""
    );
    if (ok) return { deliverable: true, note: "Address verified.", cleansed };
    // On a test key the sandbox marks real addresses undeliverable — allow it.
    if (!isLobLive()) return { deliverable: true, note: "Test mode — verification skipped.", cleansed };
    return { deliverable: false, note: "That mailing address doesn't verify as deliverable.", cleansed: null };
  } catch {
    // Best-effort; don't block the send on a transient verification failure.
    return { deliverable: true, note: "Verification unavailable — proceeding.", cleansed: null };
  }
}

export type PostcardResult =
  | { ok: true; id: string; expectedDelivery: string | null }
  | { ok: false; error: string };

/** Create (and, on a live key, mail) a 6x9 postcard. front/back are HTML. */
export async function createPostcard(opts: {
  to: LobAddress;
  from: LobAddress;
  frontHtml: string;
  backHtml: string;
  description: string;
}): Promise<PostcardResult> {
  const key = getLobKey();
  if (!key) return { ok: false, error: "Mailing not configured (LOB_API_KEY)." };
  const body = new URLSearchParams({
    description: opts.description.slice(0, 255),
    use_type: "marketing",
    size: "6x9",
    front: opts.frontHtml,
    back: opts.backHtml,
    "to[name]": opts.to.name.slice(0, 40),
    "to[address_line1]": opts.to.line1,
    "to[address_city]": opts.to.city,
    "to[address_state]": opts.to.state,
    "to[address_zip]": opts.to.zip,
    "from[name]": opts.from.name.slice(0, 40),
    "from[address_line1]": opts.from.line1,
    "from[address_city]": opts.from.city,
    "from[address_state]": opts.from.state,
    "from[address_zip]": opts.from.zip,
  });
  if (opts.to.line2) body.set("to[address_line2]", opts.to.line2);
  try {
    const res = await fetch("https://api.lob.com/v1/postcards", {
      method: "POST",
      headers: { Authorization: auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const d = (await res.json()) as { id?: string; expected_delivery_date?: string; error?: { message?: string } };
    if (!res.ok || !d.id) return { ok: false, error: d.error?.message ?? `Lob error (${res.status}).` };
    return { ok: true, id: d.id, expectedDelivery: d.expected_delivery_date ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lob request failed." };
  }
}
