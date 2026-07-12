# Orange County FL — RealAuction / Grant Street Group (GSG) ColdFusion AJAX Handshake

**Date:** 2026-07-12
**Scope:** READ-ONLY research on PUBLIC auction-listing endpoints only. No logins, payments,
registrations, form submissions, or CAPTCHA/security bypass. Polite/paced client: browser
`User-Agent` set (host 403s empty-UA), ≥10s between requests, handful of requests, no bulk pulls.
STOP on 401/403/429. All requests below returned **HTTP 200** — no auth wall, no CAPTCHA, no rate
block encountered. Findings are VERIFIED against real responses captured on this date.

---

## VERDICT: fetch-based adapter is BUILDABLE — no headless browser required.

A plain cookie-jar `fetch`/`curl` client reproduces the entire flow. The three-request sequence:

1. **`GET …zaction=USER&zmethod=CALENDAR`** → enumerate upcoming sale dates (`dayid="MM/DD/YYYY"`).
2. **`GET …zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=MM/DD/YYYY`** → seeds `cfid`/`cftoken`
   session cookies AND binds the selected auction date to that ColdFusion session.
3. **`GET …zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W&…`** (same cookie jar) → returns JSON
   `{"retHTML":"…","rlist":"…"}` whose `retHTML` is a token-compressed HTML fragment of the
   parcel rows (Case #, Opening Bid, Parcel ID w/ appraiser link, Property Address, Assessed Value).

**`AREA` is a FIXED single-letter constant, NOT a per-date token.** Values are `R` / `C` / `W`
(see §2). No token needs to be scraped from the preview HTML — the date is carried in the CF
session, not in the AREA param.

**Statefulness is the only gotcha:** a cold `FNC=LOAD` with no cookies returns valid JSON but an
**empty** `retHTML` (0 rows). You MUST do the `PREVIEW` GET first, on the same cookie jar, to
populate the session with the target `AUCTIONDATE`. The `X-Requested-With: XMLHttpRequest` header
is **NOT required** (verified: PREVIEW→LOAD without it returned 10 rows).

**Host:** `https://orange.realtaxdeed.com` (tax deed). Foreclosure sibling
`https://orange.realforeclose.com` uses the **identical handshake** (§5) — one adapter covers both
distress signals.

---

## 1. Session establishment

The session is seeded by any GET to `index.cfm`; the **PREVIEW** GET is what both seeds cookies
*and* selects the auction date, so use it as the seed step.

```
GET https://orange.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=08/06/2026
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36
```

Response `Set-Cookie` (sanitized):

```
set-cookie: AWSALB=<REDACTED>; Path=/
set-cookie: AWSALBCORS=<REDACTED>; Path=/; SameSite=None; Secure
set-cookie: cfid=<UUID>;   Path=/; Domain=.realtaxdeed.com; HTTPOnly
set-cookie: cftoken=<TOKEN>; Path=/; Domain=.realtaxdeed.com; HTTPOnly
set-cookie: CF_CLIENT_ORANGE_REALTAXDEED_LV=<VAL>; Path=/
set-cookie: CF_CLIENT_ORANGE_REALTAXDEED_TC=<VAL>; Path=/
set-cookie: CF_CLIENT_ORANGE_REALTAXDEED_HC=<VAL>; Path=/
```

Required to carry forward into the `FNC=LOAD` call: **`cfid` + `cftoken`** (the ColdFusion session
identity) and the **`AWSALB`/`AWSALBCORS`** load-balancer stickiness cookies. There is no
`JSESSIONID` (this CF instance uses `cfid`/`cftoken`, not a servlet session). A single shared
cookie jar across all requests satisfies everything.

The PREVIEW response body (~24 KB HTML) contains the three area containers and cross-links to
other dates — no per-request nonce/CSRF token is embedded or required for the public LOAD path.

---

## 2. The `FNC=LOAD` request (+ AREA derivation, pagination)

Source of truth: `/CORE/System/JS/auction.js`, function `loadArea(Area, pagedir, doRefresh, bypassPage)`:

```js
loadUrl = "/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=" + Area
        + "&PageDir=" + pagedir + "&doR=" + doRefresh + "&tx=" + f.getTime()
        + "&bypassPage=" + bypassPage;
$.getJSON(loadUrl, {test:1}, function(data){ LoadNewArea(Area, data); });
```

**AREA derivation:** `changePage()` reads `area = $(obj).parent('div').attr('area')`. The preview
HTML hard-codes the containers `<div id="Area_R">`, `<div id="Area_C" area="C">`,
`<div id="Area_W" area="W">`. So AREA is one of three fixed letters — **no scraping of a per-date
token needed**:

| AREA | Meaning (GSG convention)              | Use for the adapter |
|------|---------------------------------------|---------------------|
| `R`  | Running / live (auction in progress)  | live-day only       |
| `C`  | Closed / already-sold on the day      | post-sale results   |
| `W`  | Waiting / upcoming (the preview list) | **primary pull** — full upcoming parcel roster |

For an upcoming-auction distress-signal feed, pull **`AREA=W`**.

**Params:** `PageDir` (paging direction, `0` initial), `doR` (doRefresh flag, `0`),
`tx` (cache-buster = epoch ms), `bypassPage` (target page for `keyPage`, `0`), plus the harmless
`test=1` that jQuery appends. **Pagination:** the preview page exposes `curPWA` (current page) and
`maxWA` (max pages) for area W; `keyPage()` calls `loadArea(area, 0, 1, newPage)` i.e. set
`doR=1` and `bypassPage=<pageNumber>` to fetch a specific page. Row window (`FROM`/`TO`) is
server-managed per page — there is no explicit FROM/TO param; you page via `bypassPage`.

**`X-Requested-With: XMLHttpRequest` is NOT required** (verified). Setting it is harmless.

Exact working request (after the PREVIEW seed on the same jar):

```
GET https://orange.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W&PageDir=0&doR=0&tx=1783890300000&bypassPage=0&test=1
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 … Chrome/126.0 Safari/537.36
Cookie: cfid=…; cftoken=…; AWSALB=…; AWSALBCORS=…
```

Reproducible curl sequence (paced ≥10s between calls):

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
J=/tmp/jar.txt; D=08/06/2026
# 1. seed session + select date
curl -s -c $J -b $J -A "$UA" \
  "https://orange.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=$D" -o /dev/null
sleep 10
# 2. load the upcoming (W) roster as JSON
TX=$(python3 -c 'import time;print(int(time.time()*1000))')
curl -s -c $J -b $J -A "$UA" \
  "https://orange.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W&PageDir=0&doR=0&tx=$TX&bypassPage=0&test=1"
```

---

## 3. Response shape + sample row

`FNC=LOAD` returns **JSON**, content-type `text/html;charset=UTF-8`, shape:

```json
{ "retHTML": "<div id=\"AITEM_1507225\" … >…</div>…", "rlist": "…" }
```

`retHTML` is an **HTML fragment with token substitutions** you must expand (from `LoadNewArea()`
in auction.js) before parsing. The substitution table:

```
@A → <div class="     @B → </div>            @C → class="
@D → <div>            @E → AUCTION           @F → </td><td
@G → </td></tr>       @H → <tr><td           @I → table
@J → p_back="NextCheck=   @K → style="Display:none"
@L → /index.cfm?zaction=auction&zmethod=details&AID=
```

After expansion each parcel is a `<div class="AUCTION_ITEM PREVIEW" id="AITEM_<AID>" aid="<AID>">`
containing a `<table class="ad_tab">` of label/value cells (`AD_LBL` / `AD_DTA`).

**One real row — tax deed, Orange County, sale 08/06/2026 (sanitized/verbatim field values):**

```
AID:               1507225
Auction Type:      TAXDEED
Case #:            2019-225
Certificate #:     (blank in W-preview)
Opening Bid:       $1,474.71
Parcel ID:         212027278400080
                   → https://ocpaweb.ocpafl.org/parcelsearch/Parcel%20ID/212027278400080
Property Address:  WHITNEY ST
                   MOUNT DORA, FL- 32757
Assessed Value:    $387.00
```

Raw item HTML (post-token-expansion, whitespace-collapsed):

```html
<div id="AITEM_1507225" class="AUCTION_ITEM PREVIEW" aid="1507225" rem="0" isset="0">
 <div class="AUCTION_STATS"> … status msgs empty until FNC=UPDATE polling … </div>
 <div class="AUCTION_DETAILS"><table class="ad_tab"><tbody>
  <tr><td class="AD_LBL">Auction Type:</td><td class="AD_DTA">TAXDEED </td></tr>
  <tr><td class="AD_LBL" aria-label="Case Number">Case #:</td><td class="AD_DTA"> 2019-225</td></tr>
  <tr><td class="AD_LBL">Certificate #:</td><td class="AD_DTA"></td></tr>
  <tr><td class="AD_LBL">Opening Bid:</td><td class="AD_DTA">$1,474.71</td></tr>
  <tr><td class="AD_LBL">Parcel ID:</td><td class="AD_DTA"> <a href="https://ocpaweb.ocpafl.org/parcelsearch/Parcel%20ID/212027278400080" target="_blank">212027278400080</a></td></tr>
  <tr><td class="AD_LBL">Property Address:</td><td class="AD_DTA">WHITNEY ST</td></tr>
  <tr><td class="AD_LBL"></td><td class="AD_DTA">MOUNT DORA, FL- 32757</td></tr>
  <tr><td class="AD_LBL">Assessed Value:</td><td class="AD_DTA">$387.00</td></tr>
 </tbody></table></div>
</div>
```

Notes:
- **Sale datetime** is NOT in the LOAD fragment. The `ASTAT_MSGA/B` slots are empty in the static
  preview and are filled by a separate polling call `FNC=UPDATE` (only meaningful on live sale day).
  The fixed **sale date + time comes from the calendar** (§4) — e.g. `08/06/2026 10:00 AM ET`.
- **Certificate #** was blank for W-preview tax-deed items on this date (populated closer to sale /
  in the details view `zaction=auction&zmethod=details&AID=<AID>`).
- The W call returned **10 items** for 08/06/2026; page via `bypassPage` for the rest
  (`maxWA` on the preview page gives the page count).

---

## 4. Enumerating sale dates (calendar)

```
GET https://orange.realtaxdeed.com/index.cfm?zaction=USER&zmethod=CALENDAR
GET …?zaction=user&zmethod=calendar&selCalDate={ts '2026-08-01 00:00:00'}   ← navigate months
```
(URL-encode the `selCalDate` value: `%7Bts%20%272026-08-01%2000%3A00%3A00%27%7D`.)

Per `/CORE/System/JS/Calendar.js`, a **sale day** is any calendar cell with a `dayid` attribute
and CSS class `CALSELT`; clicking it navigates to
`index.cfm?zaction=AUCTION&Zmethod=<CALMODE>&AUCTIONDATE=<dayid>` where `CALMODE="PREVIEW"` for
upcoming dates. To list programmatically, regex the month HTML for:

```
class='CALBOX … CALSELT …' … dayid='MM/DD/YYYY'
```

Verified — August 2026 (tax deed) sale days:

```
dayid='08/06/2026'  Tax Deed  11 active / 28 scheduled  10:00 AM ET
dayid='08/13/2026'  Tax Deed  13 active / 16 scheduled  10:00 AM ET
dayid='08/20/2026'  Tax Deed  18 active / 20 scheduled  10:00 AM ET
dayid='08/27/2026'  Tax Deed  16 active / 16 scheduled  10:00 AM ET
```

(July 2026 had zero tax-deed sale days — walk months forward via `selCalDate` until `CALSELT`
cells appear. Cell text also carries the per-day active/scheduled counts + `TD`/`FC` type tag +
sale time.)

Adapter loop: CALENDAR (per month) → collect `dayid`s → for each, PREVIEW seed → FNC=LOAD (W).

---

## 5. Foreclosure parity — `orange.realforeclose.com`

**Same GSG platform, identical handshake — confirmed HTTP 200 end-to-end.** Same cookie set
(`cfid`/`cftoken`/`AWSALB`), same `index.cfm` verbs, same `CALMODE="PREVIEW"`, same
`zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W` JSON `retHTML` shape, same `Area_R/C/W`
containers, same token-substitution table, same `dayid` calendar. Foreclosure sale days run
near-daily (July 2026 calendar showed many `dayid` cells), vs. weekly for tax deed.

**Field differences in the LOAD fragment (mortgage foreclosure vs. tax deed):**

| Tax deed (realtaxdeed) | Mortgage foreclosure (realforeclose)                     |
|------------------------|----------------------------------------------------------|
| Auction Type: TAXDEED  | (no Auction Type row)                                    |
| Certificate #          | **Proof of Publication:** (e.g. "Pending")               |
| Opening Bid            | **Final Judgment Amount:** (e.g. `$2,086,132.82`)        |
| Assessed Value         | **Plaintiff Max Bid:** (e.g. "Hidden")                   |
| Case # (plain text)    | Case # → hyperlink to Orange County Clerk selfservice doc portal (`selfservice.or.occompt.com`) |
| Parcel ID → OCPA link  | Parcel ID → OCPA link (sometimes label-only "Property Appraiser" when parcel not yet mapped) |
| Property Address        | Property Address (same)                                  |

Real foreclosure sample row (sale 07/16/2026, sanitized):

```
AID:                   1505906
Case #:                2025-CA-000355-O  → selfservice.or.occompt.com/…/document/20260320724
Final Judgment Amount: $2,086,132.82
Parcel ID:             (appraiser link; parcel not populated for this item)
Property Address:      8514 PALM HARBOUR DR, KISSIMMEE, 34747
Plaintiff Max Bid:     Hidden
```

Adapter should parse by `AD_LBL` label text (not fixed column order) since the two sites differ.
Structural note: tax-deed items use `<table class="ad_tab"><tr><td>` rows; foreclosure items use
`<div class="ad_tab"><div class="AD_LBL"/><div class="AD_DTA"/>` float pairs — parse both, keyed
on label string.

---

## Throttle posture / operational notes

- All calls this session returned **HTTP 200**; no 401/403/429, no CAPTCHA/Turnstile/Cloudflare
  challenge on any public endpoint. Empty-UA does 403 → always send a normal browser `User-Agent`.
- **Statefulness is mandatory:** cold `FNC=LOAD` (no session) → valid JSON, **empty** `retHTML`.
  Always PREVIEW-seed the date first on the shared jar, then LOAD.
- Keep ≥10s between requests; per date it's exactly 2 requests (PREVIEW + LOAD, + 1 per extra page).
  A full upcoming-dates sweep = 1 calendar GET/month + 2 GETs/sale-date. No bulk pulls.
- Cache-bust `tx` with epoch-ms each call (server tolerates any value). `cfid`/`cftoken` are
  long-lived (expiry year 2056) but treat each run with a fresh jar to avoid stale ALB stickiness.
- **Nothing gated was touched.** Bidding/registration/login paths were not exercised and are
  out of scope (would require auth → FLAG for human).
```
