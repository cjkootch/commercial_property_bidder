# Fresh deed sources — Harris & Travis — 2026-07-10

_Run in-house by Claude (round-3 inbox task 6). Read-only public endpoints;
the only POSTs were date-range searches against the Harris clerk's own
public search form (the same read-only pattern as the El Paso hunt). Nothing
gated was bypassed. Sandbox caveat: this environment's headless browser
cannot reach the network, so client-side-rendered numbers (certified-through
dates, row counts) are flagged for attended verification rather than
measured._

> **CORRECTION (2026-07-10, ~9:30pm CST):** the operator ran the attended
> check. The Travis PublicSearch tenant is an **EMPTY SHELL** — the UI
> returns "No documents to search in department" for Land Records (and the
> app config's `departmentDateRanges` is `{}`, corroborating: platform
> deployed, index never loaded). The clerk's REAL system is
> **https://www.tccsearch.org/** (linked from the clerk's recording page),
> which is **Cloudflare-gated** ("Just a moment", 403 to non-browser
> clients) — the same posture as the El Paso clerk. **Travis verdict
> downgrades to BLOCKED-pending-attended-path**, exactly like El Paso: a
> human decision on an attended/real-browser route, or Austin residential
> stays parked. The section below is preserved for the record but its
> optimistic read is superseded.

## Travis County (Austin) — PLATFORM CONFIRMED, numbers need one attended look

- **`travis.tx.publicsearch.us` EXISTS** (HTTP 200) — the same GovOS/Kofile
  PublicSearch platform as Bexar/Tarrant/Dallas.
- Verified from the server-rendered app config (`window.__data`, no browser
  needed):
  - `countyName: "Travis County, Texas"`
  - departments include **`RP` = "Land Records"** — the deed department
  - certification machinery present (`isCertified`, `perCertification`,
    `denySearchAfterCertifiedDate`) — this tenant certifies its index like
    the other three
  - `searchDomain` is same-origin; search traffic rides a websocket, so row
    counts don't render without a real browser
- The proven deep-link shape applies:
  `https://travis.tx.publicsearch.us/results?department=RP&recordedDateRange=YYYYMMDD%2CYYYYMMDD&searchType=quickSearch&q=<term>`
- **Why this matters:** Travis CAD deed data is ~2 years frozen (verified
  2026-07-09) — the only blocker on Austin residential. A days-fresh clerk
  index here unblocks the entire Austin new-mover product.
- **FLAG (5-minute attended check):** open the URL above in a browser,
  read the "Certified through" date and a 10-day row count, and note whether
  a CAPTCHA appears (none of the other three Texas tenants gate the index
  search). If certified-through is days-fresh, Austin residential is GO on
  the same GovOS pattern as Dallas/Tarrant/Bexar — **four counties, one
  scraper**.

## Harris County (Houston) — own system; automated queries bounce, no CAPTCHA

- **No PublicSearch tenant**: `harris.tx.publicsearch.us` does not resolve
  (gateway 502 on CONNECT = no such host upstream).
- The clerk's own search: `https://www.cclerk.hctx.net/applications/websearch/RP.aspx`
  ("Real Property"). Server-rendered ASP.NET, public, **no CAPTCHA markers in
  the form**, and the form has exactly the right fields:
  - `txtFrom` / `txtTo` (file-date range)
  - `txtInstrument` (instrument/doc type)
  - `txtOR` / `txtEE` (grantor/grantee), `txtDesc`, `txtFileNo`, lot/block
- **But:** live read-only date-range POSTs (07/01–07/10/2026, instrument
  DEED, full field set with valid `__VIEWSTATE`/`__EVENTVALIDATION`,
  session cookies, referer) consistently bounce
  `302 → /applications/websearch/Maintenance.aspx`. Either the app was
  genuinely in maintenance at probe time (Friday ~9pm CST) or it silently
  rejects non-browser sessions.
- **FLAG (attended check):** run the same date-range search in a real
  browser. If it works there, the feed path is a headless-browser form
  replay (no CAPTCHA to contend with). If it's in maintenance, re-probe on a
  weekday. Fallback known-good alternative: Harris residential sourcing
  already runs on HCAD deed dates, which have been fresh enough in practice
  — Harris is the LEAST urgent county in this hunt.

## Bottom line

| County | Platform | Automated-friendly? | Freshness | Next step |
|---|---|---|---|---|
| Dallas | GovOS PublicSearch | headless browser, no CAPTCHA | certified 07/08 (2d) | export-limit check (human) |
| Tarrant | GovOS PublicSearch | headless browser, no CAPTCHA | certified 07/06 (4d) | export-limit check (human) |
| Bexar | GovOS PublicSearch | headless browser, no CAPTCHA | certified 07/07 (3d) | export-limit check (human) |
| **Travis** | PublicSearch shell EMPTY; real system = tccsearch.org | **NO — Cloudflare-gated** | unmeasured | human decision on an attended path (El Paso situation) |
| Harris | Clerk's own ASP.NET | bounced to maintenance page at probe time | unmeasured | attended re-check; HCAD fallback is acceptable |

The one-scraper prize is therefore **three counties** (Dallas, Tarrant,
Bexar — all verified open), upgrading DFW + SA residential to days-fresh.
Travis joins El Paso in the Cloudflare-gated column; Austin residential
stays parked pending a human call on an attended-browser path.
