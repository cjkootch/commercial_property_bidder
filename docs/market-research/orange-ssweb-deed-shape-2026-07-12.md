# Orange County FL — Tyler "Self Service Web" (ssweb) Deed-Shape Research

**Date:** 2026-07-12
**Scope:** Read-only, PUBLIC records only. Operator-authorized: accept the public hold-harmless disclaimer; ≥10 s between requests; human-like, minimal volume.
**Hard rail honored:** `/ssweb/checkHuman` is a HARD STOP — no CAPTCHA/bot-check bypass, no header forgery, no account creation. This research stopped at the first control it hit and reports the trip point as the finding.
**Host:** `https://selfservice.or.occompt.com/ssweb/`

---

## VERDICT: NOT buildable within the rails — drop deeds, ship the other five legs

The deed leg **cannot** be built inside the operator rails. The public disclaimer — which the operator explicitly authorized us to accept — is **not** a simple "click Accept / POST a flag" page on this install. Acceptance is gated behind a **Google reCAPTCHA v2 challenge** whose token is validated server-side at **`POST /ssweb/checkHuman`**. Until `checkHuman` returns `true`, the "I Accept" button stays disabled and **every** search route redirects back to the disclaimer. There is no disclaimer-accepted, searchable session without solving that reCAPTCHA, and solving/defeating it is exactly the bot-check the rails forbid.

Because the checkHuman gate sits **in front of the disclaimer accept** (not deeper in the flow), we never reached the search form. Therefore items 1–4 below (search POST body, pagination, freshness, detail-page sub-type) are **UNKNOWN / not captured** — and cannot be captured within the rails. Recommend: **drop the deed leg for Orange County ssweb; ship the other five legs.**

---

## What was actually observed (verified, with exact requests)

All requests used a single cookie jar (one JSESSIONID), a normal desktop User-Agent (no header forgery), and ≥11 s spacing. Three GETs total — no bulk activity, no reCAPTCHA interaction attempted.

### Request 1 — entry (verified)
```
GET /ssweb/ HTTP/1.1
Host: selfservice.or.occompt.com
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/120.0 Safari/537.36
```
Response:
```
HTTP/1.1 302
Set-Cookie: JSESSIONID=<...>; Path=/ssweb; Secure; HttpOnly; SameSite=Lax
Location: /ssweb/user/disclaimer
```
Stateful session established; immediately redirected to the disclaimer.

### Request 2 — disclaimer page (verified) — THIS IS THE GATE
```
GET /ssweb/user/disclaimer HTTP/1.1
Host: selfservice.or.occompt.com
Cookie: JSESSIONID=<...>
```
Response: `200`, ~17.8 KB HTML. The **only** `<form>` on the page contains **just the reCAPTCHA widget** — the real submit button is commented out:
```html
<form class="center" method="POST">
  <script src="https://www.google.com/recaptcha/api.js" async defer></script>
  <div class="g-recaptcha center"
       data-sitekey="6LemVGAUAAAAAB_iW1wbaE4_s0Z5SoSakm6GI8St"
       data-callback="onReturnRecaptchaCallback"></div>
  <!-- <button id="submit" type="submit" ...>Submit</button> -->
</form>
```
The "I Accept" button (`#submitDisclaimerAccept`) is **disabled on load** and only enabled by the reCAPTCHA callback, which POSTs the token to **`/ssweb/checkHuman`**:
```javascript
var onReturnRecaptchaCallback = function(response) {
  $.ajax({ url: '/ssweb/checkHuman', type: "POST",
    data: {"g-recaptcha-response": grecaptcha.getResponse()},
    success: function(data) { if (data == true) {
      $("#submitDisclaimerAccept").prop('disabled', false);  // only now enabled
    }}
  });
};
```
The accept button's submit URL is read from a `disclaimerForm` element whose `action` is **not present** in the server-rendered HTML — i.e., the accept POST target is only wired after the reCAPTCHA path succeeds. There is no un-gated accept POST to hit.

### Request 3 — search entry without an accepted disclaimer (verified)
```
GET /ssweb/search/docsearch HTTP/1.1
Host: selfservice.or.occompt.com
Cookie: JSESSIONID=<...>
```
Response:
```
HTTP/1.1 302
Location: /ssweb/user/disclaimer
```
Confirms: **no search route is reachable** until the disclaimer is accepted, and the disclaimer cannot be accepted without passing the reCAPTCHA → `checkHuman` control.

---

## Answers to the four characterization items

1. **Search POST body (`POST /ssweb/searchPost/DOCSEARCH…`)** — **UNKNOWN.** Not captured. The search form is behind the disclaimer, which is behind the reCAPTCHA/checkHuman gate. Field names for recorded-date range and doc-type filter were never reached.
2. **Pagination** — **UNKNOWN.** Never reached the page-1 results markup.
3. **Freshness (newest recorded Deed date)** — **UNKNOWN.** No search could be run.
4. **Document-detail sub-type + legal description** — **UNKNOWN.** `/ssweb/document/…` is downstream of search; never reached.

---

## When/whether checkHuman appeared

`checkHuman` did **not** get "tripped" by our request pattern — it is a **structural, always-on control** on this install. It is wired into the **disclaimer page itself** as a Google reCAPTCHA v2 gate (`data-sitekey 6LemVGAUAAAAAB_iW1wbaE4_s0Z5SoSakm6GI8St`), present on the very first disclaimer view (Request 2), before any search. Accepting the disclaimer requires `POST /ssweb/checkHuman` to return `true`, which requires a valid human-solved reCAPTCHA token. Per the rails, this is a HARD STOP: we did not attempt to solve, spoof, or bypass it.

**Still unknown (and unobtainable within the rails):** the search-POST field names, pagination shape/page size, live freshness date, and detail-page deed sub-type/legal-description exposure. All sit behind the checkHuman-gated disclaimer.

## Recommendation for a human

If the deed leg is deemed worth pursuing, the only rails-compliant paths are **out of band**, not scraping: (a) Orange County Comptroller's bulk/API or subscription data service, (b) a public records data request, or (c) an official FTP/data feed. The interactive ssweb search is not automatable without defeating the reCAPTCHA, which is out of scope. Otherwise: **drop deeds for this county and ship the other five legs.**
