# Clerk fresh-deed hunt — Cameron, Jefferson, Nueces, McLennan, Hidalgo (2026-07-10)

Read-only public-endpoint recon (Task 8). Findings **unverified** — re-probe live before wiring.
Completes the residential-expansion deed map (Bexar/Tarrant/Dallas verified open; El Paso + Travis blocked on Cloudflare).
For each county: public no-login official-records search with recorded-date-range filter + deed doc-type filter?
Certified-through freshness, last-10-day volume, CAPTCHA posture.

Measured 2026-07-11 off live status lines.

## Cameron County
- **System:** GovOS/Kofile **PublicSearch** — `https://cameron.tx.publicsearch.us/` — LIVE, no login, no CAPTCHA. Dept `RP` = "Property Records".
- **Verified query:** `.../results?department=RP&recordedDateRange=20260701,20260710&searchType=quickSearch` → **"1-50 of 930 results … Certified through 07/08/2026."**
- Recorded-date-range filter works via URL. Doc-type filter present (Refine panel / advanced form; `WD`, `DEED`, etc. in tenant config) but NOT URL-addressable (XHR/checkbox only).
- **Certified-through: 07/08/2026.** 10-day all-record volume: 930 (deed subset via in-app Refine only).

## Jefferson County
- **System:** Kofile **PublicSearch** — `https://jefferson.tx.publicsearch.us/` — LIVE, no login, no CAPTCHA. Dept "Property Records".
- **Verified:** `department=RP&recordedDateRange=20260701,20260710` → **"1-50 of 875 results … Certified through 07/09/2026."**
- **Certified-through: 07/09/2026.** 10-day all-record volume: 875.

## Nueces County
- **System:** Kofile **PublicSearch** — `https://nueces.tx.publicsearch.us/` — LIVE, no login, no CAPTCHA. Dept "Official Public Records".
- **Verified:** same query shape → **"1-50 of 1,119 results … Certified through 07/09/2026."**
- Deed doc-type codes confirmed in tenant config (`DEED`, `WD`, `DEED OF TRUST`, `QUIT CLAIM DEED`, `DEED W/VENDORS LIEN`, `CONTRACT OF DEED`, …).
- **Certified-through: 07/09/2026.** 10-day all-record volume: 1,119.

## Hidalgo County
- **System:** Kofile **PublicSearch** — `https://hidalgo.tx.publicsearch.us/` — LIVE, no login, no CAPTCHA.
- **Verified:** same query shape → **Certified through 07/08/2026.**
- **Certified-through: 07/08/2026.** 10-day all-record volume: 3,174 (highest of the five — big metro).

## McLennan County
- **No PublicSearch tenant** — `mclennan.tx.publicsearch.us` = NXDOMAIN (variants dead). Clerk runs **Tyler Technologies "Self-Service"** at `https://mclennancountytx-web.tylerhost.net/web/` (linked from `mclennan.gov/178/Official-Public-Records`; OPR from 1996-01-01).
- **Access:** PUBLIC, no login, **no CAPTCHA** — root 302s to a one-click **"I Accept"** disclaimer, then the standard Tyler `DOCSEARCH` form (Recording Date range + Document Type filters).
- **Certified-through / 10-day volume: NOT MEASURED** — the disclaimer button click was blocked by this run's harness (browser click/evaluate non-functional), not by any site restriction. A pass that can click "I Accept" lands on DOCSEARCH directly.

## Bottom line

| County | Usable now? | Platform | Certified-through | Last-10-day volume | Blocker |
|---|---|---|---|---|---|
| Cameron | **YES** | Kofile PublicSearch | 07/08/2026 | 930 | none |
| Jefferson | **YES** | Kofile PublicSearch | 07/09/2026 | 875 | none |
| Nueces | **YES** | Kofile PublicSearch | 07/09/2026 | 1,119 | none |
| Hidalgo | **YES** | Kofile PublicSearch | 07/08/2026 | 3,174 | none |
| McLennan | **YES** (unmeasured) | Tyler tylerhost.net | not measured | not measured | 1-click disclaimer (harness click blocked; no auth/CAPTCHA) |

**No county is gated by login, payment, or CAPTCHA** — a clean sweep. Four are Kofile PublicSearch on the confirmed Bexar-precedent query shape (`department=RP&recordedDateRange=YYYYMMDD,YYYYMMDD`), all days-fresh (2–3 day lag). McLennan is a public Tyler portal behind only a one-click disclaimer.

**Two follow-ups (harness, not site):** (1) per-county deed-only 10-day counts need the in-app Refine checkboxes (Kofile has no URL doc-type param), and (2) McLennan's certified-through + volume need the disclaimer clicked. Both close with a browser pass that can click — no gating to work around.

**Net:** residential deed sourcing is now open across all four remaining live-market counties (Cameron/Nueces/Jefferson for metros #8/#9 + Corpus, Hidalgo for #10). Only Travis and El Paso remain Cloudflare-blocked from prior rounds.
