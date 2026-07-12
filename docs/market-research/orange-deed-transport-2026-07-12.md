# Orange County, FL — Deed-Fetcher Transport Portability Assessment

**Date:** 2026-07-12
**Scope:** Read-only research on PUBLIC endpoints only. Polite pacing (≥10s between requests, shape-only, a handful of requests). No logins, payments, registrations, or CAPTCHA/security-control evasion. Truthful headers only. Findings UNVERIFIED (single-session observation, not a validated adapter).

---

## VERDICT: Orange County needs its OWN deed adapter.

The verified Texas transport **does NOT port**. Texas counties run **PublicSearch/Kofile** (`<county>.tx.publicsearch.us`, same-origin `wss://.../ws` WebSocket carrying `@kofile/FETCH_DOCUMENTS` JSON frames, gated by the signed `authToken`+`authToken.sig` cookie pair plus `window.__ort`). **Orange County, FL runs a completely different platform: Tyler Technologies "Self Service Web" (ssweb).** Different vendor, different transport, different session model. None of the TX handshake primitives exist here.

- **Source to target:** `https://selfservice.or.occompt.com/ssweb/` (Orange County Comptroller, Phil Diamond, CPA — Official Records).
- **`orange.fl.publicsearch.us` does NOT resolve** (DNS failure). No `*.fl.publicsearch.us` / Kofile presence.
- **Transport shape needed:** server-rendered HTML forms + AJAX form-POST returning HTML fragments, over a **stateful JSESSIONID session** that must first POST-accept a disclaimer and select a search type. No REST/JSON API, no SOAP, no WebSocket.

A new adapter is required. It is a browser-flow / HTML-scrape adapter, not an API client. Good news: the search form natively supports a **recorded-date range filter**, so read-only date-windowed deed pulls are feasible.

---

## 1. Host Identification

| | Texas (verified) | Orange County, FL |
|---|---|---|
| Search host | `<county>.tx.publicsearch.us` | `selfservice.or.occompt.com/ssweb/` |
| Vendor/platform | PublicSearch / **Kofile** | **Tyler Technologies "Self Service Web" (ssweb)** |
| Front door | `occompt.com` links → `selfservice.or.occompt.com/ssweb/` |
| Version | — | `2025.1.32` (build strings in assets) |

Platform fingerprints (from live HTML/assets, `selfservice.or.occompt.com`):
- `JSESSIONID` cookie, `/ssweb/` context path, `302 → /ssweb/user/disclaimer` on first hit.
- Asset paths `/ssweb/controller/...`, class names `tylerProgress`, jQuery Mobile 1.4.5, `self.service.2025-1-32.js`.
- Homepage copy: "new and improved Official Records Search Website … legacy search website was discontinued 9/1/25." Index data back to **1843**, **25M+** document images viewable.

**NOT** PublicSearch/Kofile, NOT Granicus/Acclaim, NOT a county-custom SPA. It is standard Tyler Eagle Recorder self-service.

## 2. (PublicSearch/Kofile path) — N/A

Not applicable. Orange is not on Kofile. None of `__ort`, `authToken`/`authToken.sig`, or `wss://.../ws` FETCH_DOCUMENTS frames exist.

## 3. Transport characterization (DIFFERENT system)

- **Type:** Server-rendered HTML + AJAX **form-POST returning HTML** (`Content-Type: text/html;charset=UTF-8`). Results are injected into a DOM container (jQuery Mobile). No JSON payloads observed.
- **Session model (stateful, multi-step):**
  1. `GET /ssweb/` → `302 /ssweb/user/disclaimer`; sets `JSESSIONID`.
  2. `POST /ssweb/user/disclaimer` (accepts; returns literal `true`). A `/ssweb/checkHuman` endpoint also exists — a bot check to flag.
  3. Navigate to search-type menu → search page `GET /ssweb/search/DOCSEARCH2950S1`.
     - Note: hitting `/ssweb/search/1` cold redirects home with `?message=...+options+have+changed` — server session state is required; you cannot deep-link the search page statelessly.
  4. Search submit: **`POST /ssweb/searchPost/DOCSEARCH2950S1`** (the `<form>` action). Returns results HTML + a doc-type facet sidebar.
  5. Result rows link to detail: **`GET /ssweb/document/DOC4316S52577?search=DOCSEARCH2950S1`** (`text/html`).
- **Search form fields (live):** Recording Date Start, Recording Date End, Either Party Name, Grantor, Grantee, Book, Page, Document Types, "Use Advanced Name Searching." So a **recorded-date-range-only query returns rows** — the exact pattern the fetcher needs.
- **Deeds pullable READ-ONLY with a recorded-date filter:** YES for the **index/metadata** (party names, doc type, date, legal, book/page, instrument #). Image/certified-copy retrieval routes through a cart/purchase flow — out of scope (paid), do not pursue.
- **Volume/freshness (UNVERIFIED sample):** A single day, **07/10/2026 (Fri)**, returned **20 pages** of results across all doc types (e.g. Deed 360, Mortgage 438 for that day). Recorded index appears current to within ~2 days of real time. Certified-through/max-record date not separately confirmed; needs a dedicated freshness probe.

### Sanitized live sample (one result row, 07/10/2026)
```
Document #:  20260385183
Type:        Mortgage
Recorded:    07/10/2026 03:51 PM
Grantor:     HVOJNIK IVAN S
Grantee (2): GUARANTEED RATE AFFINITY LLC; MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC
Legal:       Lot 87, Parcel 04-2330-5873-00-870, "MYSTIC AT MARINERS VILLAGE"
Book/Page:   (present in row)
Detail URL:  /ssweb/document/<DOCxxxxSxxxxx>?search=DOCSEARCH2950S1
```
Field vocabulary (Grantor / Grantee / DocType / RecordedDate / instrument #) is conceptually the same as TX; only the **transport and session model differ**.

## 4. Doc-type vocabulary & deed-adjacent signals

FL uses a **generic top-level "Deed"** facet — it does NOT split WARRANTY DEED / SPECIAL WARRANTY DEED at the facet level the way TX Kofile does. Sub-types (warranty vs quitclaim) would live in the document detail, not the facet. Full facet list with same-day (07/10/2026) counts:

| Doc Type (facet label) | 07/10 count | Relevance |
|---|---|---|
| **Deed** | 360 | conveyances (primary target) |
| **Deed Mortgage** | 2 | conveyance+mortgage combo |
| **Mortgage** | 438 | deed-adjacent (financing) |
| Assignment | 25 | mortgage assignments |
| Satisfaction | 192 | mortgage satisfactions |
| Modification | 13 | mortgage mods |
| **Lien** | 91 | deed-adjacent |
| **Lis Pendens** | 9 | deed-adjacent (foreclosure signal) |
| Judgment / Certified Copy of Judgment | 132 / 23 | |
| Notice of Commencement | 162 | construction |
| Financing Statement UCC | 29 | |
| Easement | 9 | |
| Affidavit, Agreement, Certificate, Court Paper, Death Certificate, Order, Power of Attorney, Notice, Termination, Void, Probate/Juvenile/Mental Health/Domestic Relations Court Paper | various | |

**Tax deeds are NOT in this system.** The homepage routes "Tax Deed Sales" to a **separate external website** (distinct search). If tax deeds are in scope, that is a third source needing its own assessment.

Mortgages, liens, lis pendens: **all present in the same ssweb search**, filterable by the same date range + doc-type facet. That is a plus over needing separate systems.

---

## FLAG for human before any sustained pull

1. **ToS / disclaimer:** every session requires POST-accepting an indemnification disclaimer ("index is like a library card catalog," hold-harmless). Automated repeated acceptance should get a human/legal sign-off.
2. **Bot check:** a `/ssweb/checkHuman` endpoint exists in the app. Behavior under automation is untested; do not attempt to defeat it. If it gates programmatic access, that is the finding — escalate.
3. **Throttling:** unknown rate limits. Only a handful of paced (≥10s) requests were made here. Any real ingest must throttle conservatively and STOP on 401/403/429.
4. **Stateful session cost:** each pull requires disclaimer-accept + search-type selection before the date-range POST — more fragile and slower than the TX WebSocket. Adapter should be a resilient headless-browser or careful session-cookie curl flow, with retry on the "options have changed" home-redirect.

## What's still needed to fully characterize (not done here, read-only limits)
- Exact `POST /ssweb/searchPost/DOCSEARCH2950S1` body params (field names for date range / doc-type filter) — capture via a paced form submit with network logging.
- Pagination mechanics (how "Page 2..20" are requested).
- Certified-through / true max recorded date (freshness probe over the most recent business days).
- Whether the document-detail page (`/ssweb/document/...`) exposes the deed **sub-type** (warranty vs quitclaim) and full legal description for matching.
