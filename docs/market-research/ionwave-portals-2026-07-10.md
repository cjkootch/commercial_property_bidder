# Ionwave RFP Portals — Deep Probe (Prep for One-Parser Feed)

**Date:** 2026-07-10
**Scope:** Read-only research on PUBLIC endpoints only (`/SourcingEvents.aspx?SourceType=1`, server-rendered HTML). No logins, no form submissions, no CAPTCHA/Turnstile bypass, no bulk scraping. Gated portals are FLAGGED, not worked around. All data is **UNVERIFIED research** — exact URLs, sample rows, and producing queries are included below.
**Method:** `curl -A "Mozilla/5.0 (research; read-only)"` single GETs, politely paced (≥11–15s spacing) to respect a per-IP rate limit shared across the `*.ionwave.net` tenants.

---

## 0. TL;DR verdict

- **One parser is safe.** All three known portals (and every live tenant probed) render a byte-identical Telerik RadGrid: same grid id, same 6 headers, same sort-field names, same `<td>` width/hidden styles. No divergence.
- **7 NEW live Ionwave tenants** found in/near the target metros (plus several 0-event or gated ones). None are the big-city/county targets — the naming convention did not expose City of Houston, City/County of San Antonio, Corpus Christi, etc. at guessable slugs; the hits skew to **ISDs**.
- **Grounds relevance is ~0%.** Of the ~29 live events across the 3 known portals, **0** are true landscaping/grounds/mowing/irrigation/tree services; 1 janitorial-*supplies* line item is the only keyword-adjacent hit (3.4% generous / 0% strict).

---

## 1. Table structure, sample rows, pagination, closed-event leakage

### 1a. Exact HTML skeleton (identical on all 3 portals)

The events table is a **Telerik RadGrid** (not a plain ASP.NET GridView), server-rendered into static HTML on the initial GET. All rows for the current page are present in the GET response (no XHR needed to read page 1).

Table element:
```html
<table class="rgMasterTable" id="ctl00_mainContent_rgBidList_ctl00" style="width:100%;table-layout:auto;empty-cells:show;">
  <thead> ... 7 <th scope="col" class="rgHeader"> ... </thead>
  <tfoot><tr class=" rgPager"><td colspan="6"> ...pager table... </td></tr></tfoot>
  <tbody>
    <tr class="rgRow"    valign="top" id="ctl00_mainContent_rgBidList_ctl00__0"> ...7 <td>... </tr>
    <tr class="rgAltRow" valign="top" id="ctl00_mainContent_rgBidList_ctl00__1"> ...7 <td>... </tr>
    ...
  </tbody>
</table>
```

Column skeleton (`<th>` text → underlying RadGrid sort field → `<td>` style):

| # | Header text | Sort field | `<td>` style | Notes |
|---|-------------|-----------|--------------|-------|
| 0 | `&nbsp;` | — | `width:1%;white-space:nowrap;` | icon cell: `<span class="flaticon-grid_View" title="View Bid">` |
| 1 | Bid Number | `BidNumber` | `width:25%;` | e.g. `26-18104 Addendum 1` |
| 2 | Bid Title | `Title` | `width:25%;` | |
| 3 | Bid Type | `TypeTitle` | `width:15%;` | code varies by tenant (see 2b) |
| 4 | Organization | `WorkGroupName` | `width:10%;display:none;` | **hidden by default** — present in HTML |
| 5 | Bid Issue Date | `OpenDate` | `width:5%;` | `M/D/YYYY` |
| 6 | Bid Close Date/Time | `CloseDate` | `width:15%;white-space:nowrap;` | `M/D/YYYY h:mm:ss AM/PM (TZ)` |

Header anchors carry the sort via `Telerik.Web.UI.Grid.Sort(...)` + `__doPostBack(...)`.

### 1b. One sanitized sample row per portal

**SAWS** (`https://sawsbid.ionwave.net/SourcingEvents.aspx?SourceType=1`)
```html
<tr class="rgRow" valign="top" id="ctl00_mainContent_rgBidList_ctl00__0">
  <td align="center" style="width:1%;white-space:nowrap;"><span class="flaticon-grid_View" title="View Bid"></span></td>
  <td style="width:25%;">26-18104 Addendum 1</td>
  <td style="width:25%;">Salesforce CRM</td>
  <td style="width:15%;">RFQ-DIR</td>
  <td style="width:10%;display:none;">Purchasing</td>
  <td style="width:5%;">7/3/2026</td>
  <td class="rgSorted" style="width:15%;white-space:nowrap;">7/13/2026 12:00:00 AM (CT)</td>
</tr>
```
Cells: `['', '26-18104 Addendum 1', 'Salesforce CRM', 'RFQ-DIR', 'Purchasing', '7/3/2026', '7/13/2026 12:00:00 AM (CT)']`

**City of El Paso** (`https://elpasotexas.ionwave.net/SourcingEvents.aspx?SourceType=1`)
Cells: `['', '2026-0302 Addendum 1', 'Light Duty Aftermarket Vehicle Parts', 'Low Bid- Formal', 'Purchasing', '6/16/2026', '7/15/2026 02:00:00 PM (MT)']`

**El Paso County** (`https://epcountypurchasing.ionwave.net/SourcingEvents.aspx?SourceType=1`)
Cells: `['', '26-018 Addendum 1', 'Sports Tourism Promotion Program Services for El Paso County, Texas', 'RFP', 'County of El Paso', '5/18/2026', '7/16/2026 02:00:00 PM (MT)']`

(Note El Paso is Mountain Time → `(MT)`; SAWS/San Antonio is `(CT)`. The timezone token is embedded in the close-date string — the parser must not assume Central.)

### 1c. Pagination behavior

- **Page-size control:** Telerik combobox, default **20** rows/page, selectable options **10 / 20 / 50**.
- **Pager type:** `NextPrevAndNumeric`. First/Prev/Next/Last are `<input type="submit">` and numeric pages are `<a href="javascript:__doPostBack(...)">` — i.e. **ASP.NET postbacks driven by `__VIEWSTATE`, not URL query params.** There is no `?page=N` / `?pageSize=N` GET parameter; deeper pages require an HTTP POST replaying `__VIEWSTATE` + the pager event target.
- **Total-count signal:** the pager info div is directly parseable: `<div class="rgInfoPart"> <strong>16</strong> items in <strong>1</strong> pages </div>` (regex `(\d+)\s*items`).
- **Practical implication for the feed:** all current portals have ≤20 live events, so a single GET returns the full set today. To be robust to future growth, the one parser should (a) read the `items` count from `rgInfoPart`, and (b) if `> pageSize`, either issue the ViewState POST to page through, or set page size to 50 via the same POST. `SourceType=1` is a GET query param and works, but paging is POST-only.

### 1d. Closed / awarded leakage into SourceType=1

**No leakage observed.** On all three portals every row's close date/time is **in the future** relative to today (2026-07-10) — earliest close is 7/13/2026. `SourceType=1` = open/current solicitations only. (Other SourceTypes exist in the app for closed/awarded/archived, but the nav on `SourceType=1` only links back to `SourceType=1`.) Parser can treat SourceType=1 as "currently biddable" without a client-side close-date filter, though filtering on `CloseDate >= now` is a cheap safety net.

---

## 2. Column identity across the 3 portals

**Identical — no divergence.** Byte-level comparison of the grid signature:

| Attribute | SAWS | El Paso City | El Paso County |
|-----------|------|--------------|----------------|
| grid id | `ctl00_mainContent_rgBidList_ctl00` | same | same |
| headers | Bid Number / Bid Title / Bid Type / Organization / Bid Issue Date / Bid Close Date/Time | same | same |
| sort fields | BidNumber / Title / TypeTitle / WorkGroupName / OpenDate / CloseDate | same | same |
| `<td>` styles | `1% / 25% / 25% / 15% / 10%(display:none) / 5% / 15%` | same | same |

**Only non-structural variances (data, not schema):**
1. **Bid Type vocabulary differs by tenant** — SAWS uses `IFB / RFP / RFQ / RFQ-DIR / INFBI`; El Paso City uses long labels `Low Bid- Formal / Competitive Sealed Proposal- Formal Construction / Best Value`; El Paso County uses `RFP / SB / CSB`. The **column position is identical**; only the string content varies. A one-parser feed should treat Bid Type as a free-text string (optionally normalized downstream), not an enum.
2. **Organization column is populated but hidden** (`display:none`) on all three; value is the tenant work-group name (`Purchasing`, `County of El Paso`). Parse it from HTML regardless of visibility.
3. **Timezone token** in the close-date string is CT for SAWS, MT for El Paso — parse the `(XX)` suffix, don't hardcode.

Verdict: **ONE parser handles all three** with zero structural branching.

---

## 3. Texas Ionwave tenant sweep (9 metros)

Method: probed `<slug>.ionwave.net/SourcingEvents.aspx?SourceType=1` for ~140 candidate slugs (cities, counties, ISDs, transit, utilities, colleges, ports) across Houston, DFW, San Antonio, Austin, El Paso, Corpus Christi, Waco, Brownsville, Beaumont. DNS non-resolution (`HTTP 000`) = not an Ionwave tenant. Tenant identity taken from the page `<title>`.

### 3a. NEW confirmed live tenants (beyond the 3 known)

| Slug | Tenant (from `<title>`) | Metro bucket | SourceType=1 count |
|------|-------------------------|--------------|--------------------|
| `houstonisd` | Houston ISD Purchasing Services | Houston | **7** |
| `ccisd` | Clear Creek ISD | Houston (League City) | **1** |
| `planotx` | City of Plano Purchasing | DFW | **3** |
| `aisd` | Arlington ISD | DFW | **4** |
| `mckinney` | City of McKinney (eBid) | DFW | 0 |
| `dentoncounty` | Denton County (eBid) | DFW | 0 |
| `bisd` | Belton ISD | Waco/Killeen corridor | **6** |
| `episd` | El Paso ISD (eBid) | El Paso | 0 |
| `hisd` | Hallsville ISD | E TX (Longview, not a target metro) | 1 |
| `saisd` | San Angelo ISD | W TX (not a target metro) | 0 |

**Tenant count:** 3 known + **7 new live tenants inside the target metros** (`houstonisd`, `ccisd`, `planotx`, `aisd`, `mckinney`, `dentoncounty`, `bisd`) + 2 out-of-metro bonus tenants (`hisd` Hallsville, `saisd` San Angelo) + `episd` El Paso ISD (0 events, El Paso metro → arguably an 8th in-metro tenant). Net new **usable** feed sources with live events right now: **houstonisd (7), bisd (6), aisd (4), planotx (3), ccisd (1)** = 5 tenants, 21 additional live events.

### 3b. Gated / broken — FLAGGED for human, NOT bypassed

| Slug | Observed | Disposition |
|------|----------|-------------|
| `saisd` (San Angelo ISD) | intermittently served `<title>Just a moment...</title>` (Cloudflare challenge) before a clean 200 on retry | Behind Cloudflare interstitial at times — **do not auto-bypass**; feed should back off on challenge pages |
| `sisd` | persistent `<title>Just a moment...</title>` (Cloudflare Turnstile) — never resolved to a grid | **GATED — FLAG.** Identity unconfirmed (candidate: Socorro ISD El Paso, or another `sisd`). Do not attempt bypass. |
| `mclennan` | HTTP 302 → `/Error.aspx` | Subdomain exists but no valid public sourcing page; treat as **not usable** (decommissioned/misconfigured) |
| Shared infra 429s | Rapid multi-tenant requests from one IP returned `429 Too Many Requests` across *all* `*.ionwave.net` | Rate limit is **per-IP, platform-wide**. Feed must throttle globally, not per-tenant. |

### 3c. Slugs that did NOT resolve (not Ionwave tenants at guessable names)

City of Houston, Harris County, City of Dallas, Dallas County, City of Fort Worth, Tarrant County, City of San Antonio, Bexar County, San Antonio ISD (`saisd`=San Angelo, not San Antonio), City of Austin, Travis County, CapMetro/VIA/DART transit, Corpus Christi (city/county/`cctexas`/`nueces`/CCRTA/port), City of Waco, McLennan County, City of Brownsville, Cameron County, City of Beaumont, Jefferson County, and ~90 other city/county/utility/college variants — all `HTTP 000` (no DNS). **The big cities and counties of the 9 target metros are largely NOT on Ionwave** (they use Bonfire and other platforms per the existing metro sweep); Ionwave's Texas footprint in these metros is dominated by **school districts** plus a few cities (Plano, McKinney) and El Paso city/county + SAWS utility.

> Caveat: absence of DNS at guessed slugs is not proof of absence on the platform — a tenant could exist under a non-obvious slug. This sweep covered the standard naming patterns (`city`, `cityof<x>`, `<x>tx`, `<county>county`, `<x>isd`, agency acronyms). A definitive tenant list would require Ionwave's own directory (not probed here — no public directory endpoint used).

---

## 4. Grounds / landscaping relevance (3 known portals)

Keyword set: landscap, grounds, mow(ing), irrigation, tree/arbor, janitor/custodial, lawn, turf, vegetation, weed, brush, right-of-way, median, park maintenance, sports/athletic field, pest, herbicide.

**Live events across the 3 known portals: 29** (SAWS 16 + El Paso City 7 + El Paso County 6).

**Grounds-relevant hits:**
- **1 keyword-adjacent (janitorial):** SAWS `26-6034` — *ANNUAL CONTRACT FOR JANITORIAL SUPPLIES, AIR FRESHENERS & ODOR CONTROL* — but this is **supplies/materials, not a services contract**, so it is not a real grounds/janitorial-services opportunity.
- **0 true landscaping/grounds/mowing/irrigation/tree services.**

**Hit rate:**
- Strict (true grounds/janitorial *services*): **0 / 29 = 0.0%**
- Generous (any keyword match, incl. the supplies line): **1 / 29 = 3.4%**

The 29 events are dominated by water/wastewater utility procurement (SAWS), fleet parts, construction/road (El Paso City), and county tourism/facilities/software (El Paso County). Nearest-but-not-qualifying items: El Paso County `26-020` (construction of a park restroom — construction, not grounds maintenance) and `26-017` (coliseum operation).

**New-tenant note:** the 5 new tenants with live events are ISDs + City of Plano, whose current solicitations are education/facilities/re-roof/concrete — also no explicit grounds. However, several ISD RFPs (Belton, Arlington) are **broad multi-category vendor pools** ("All-Purpose Supplies, Equipment and Services") that can carry grounds/landscaping as a line category; worth a manual look but not machine-classifiable from the title alone.

---

## Appendix — exact reproducing commands

```bash
UA="Mozilla/5.0 (research; read-only)"
# Known portals (all return HTTP 200, full grid in the GET body):
curl -s -A "$UA" "https://sawsbid.ionwave.net/SourcingEvents.aspx?SourceType=1"
curl -s -A "$UA" "https://elpasotexas.ionwave.net/SourcingEvents.aspx?SourceType=1"
curl -s -A "$UA" "https://epcountypurchasing.ionwave.net/SourcingEvents.aspx?SourceType=1"

# Total count for any tenant (parse rgInfoPart):
#   grep -oE '<div class="rgInfoPart">.*?</div>' | grep -oE '[0-9]+ items'

# Tenant discovery: HTTP 200 + <title> = live; HTTP 000 = no such tenant;
#   "Just a moment..." title = Cloudflare gate (FLAG, do not bypass).
# NOTE: *.ionwave.net enforces a per-IP, platform-wide 429 rate limit —
#   pace requests ≥11s apart.
```
