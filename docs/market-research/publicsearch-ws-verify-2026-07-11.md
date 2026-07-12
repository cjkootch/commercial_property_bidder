# GovOS / Kofile PublicSearch WebSocket — Non-Browser Handshake Verification

**Date:** 2026-07-11 (probes run 2026-07-12)
**Scope:** READ-ONLY research on PUBLIC county deed-record endpoints. Polite client: >=10s between requests, shape-only, no bulk pulls (a few frames per tenant, max). No logins, payments, registrations, CAPTCHA/Turnstile handling, or evasion. No header spoofing to defeat a server security control. All findings **UNVERIFIED** in the sense of "not officially sanctioned" — they are direct empirical observations from live probes, reproducible with the examples below.
**Tenants:** dallas, tarrant, bexar, cameron, jefferson, nueces, hidalgo (all `.tx.publicsearch.us`).

---

## VERDICT: **YES — a no-browser fetcher is feasible.** (No headless browser required.)

A plain Python `websocket-client` (and equally curl/node) socket reached `wss://<tenant>.tx.publicsearch.us/ws` and pulled real Property-Records (`RP`) result rows from **all 7 tenants**, using only:

1. a normal non-browser HTTP GET of the tenant homepage (any UA — `curl/8.0 recon` worked) to obtain `__ort` **and** the two Set-Cookie values, then
2. forwarding those cookies on the WS upgrade and echoing `__ort` as `authToken` inside each JSON frame.

The Round-6 model was **mostly correct but incomplete**: results do ride a same-origin `wss://.../ws` carrying `@kofile/FETCH_DOCUMENTS` JSON frames, and `__ort` is involved — **but `__ort` alone is NOT the gate.** The real gate is the **signed cookie pair** `authToken` + `authToken.sig` that the SSR page sets, and each frame's `authToken` must match that session. The server does **NOT** enforce an `Origin` check. No CAPTCHA/Turnstile/login is in the path for search. No rate-limiting seen at >=10s pacing.

Every tenant returned HTTP 200 to a non-browser UA and a `FETCH_DOCUMENTS_FULFILLED/v6` frame with a live `meta.numRecords`:

| tenant | `__ort` in raw HTML | sig cookie issued | dept | result | numRecords |
|---|---|---|---|---|---|
| dallas    | YES | YES | RP | FULFILLED, 50 rows | 265,307 |
| tarrant   | YES | YES | RP | FULFILLED, 50 rows | 233,653 |
| bexar     | YES | YES | RP | FULFILLED, 50 rows | 238,599 |
| cameron   | YES | YES | RP | FULFILLED, 50 rows | 44,885 |
| jefferson | YES | YES | RP | FULFILLED, 50 rows | 32,638 |
| nueces    | YES | YES | RP | FULFILLED, 50 rows | 44,567 |
| hidalgo   | YES | YES | RP | FULFILLED, 50 rows | 99,651 |

(numRecords is the count for `searchValue:""` + `recordedDateRange=2024-01-01,2024-12-31`, dept `RP`.)

---

## 1. `__ort` extraction (all 7 present in RAW HTML)

Plain `curl -A "curl/8.0 recon" https://<tenant>.tx.publicsearch.us/` returns 200 with `__ort` inline in the SSR HTML for **all 7** tenants. It rotates on **every page load** (per-page-load UUID confirmed: two dallas GETs 11s apart gave different UUIDs).

**Exact regex:** `window\.__ort="([0-9a-f-]{36})"`
It also appears (same value) inside `window.__data` as `"authToken":"<uuid>"`.

**Sanitized sample values (rotate every load — illustrative only):**

```
dallas    18e60845-1763-4ac6-b8f4-142e62f58dd7
tarrant   ed574147-8210-414e-94f2-0e707690f3db
bexar     dc3e49e4-f3a8-492f-bbbe-b4f0c3a89464
cameron   3bff15a8-7720-440b-84c3-b460bb25c52f
jefferson c3681146-323e-425c-9b94-131d07aea127
nueces    fd30775d-cd14-4c7c-ad45-5052a0f03246
hidalgo   662ef1ad-dd97-4cec-aa0c-b760b68ac649
```

**IMPORTANT — the cookies, not just `__ort`:** the same GET that returns `__ort` also returns two cookies:

```
Set-Cookie: authToken=<same-uuid-as-__ort>
Set-Cookie: authToken.sig=<HMAC signature>
```

You MUST keep a cookie jar on that GET and forward both cookies to the socket. Fetching `__ort` from HTML text alone (discarding cookies) does not work.

---

## 2. WS handshake from a non-browser client

**Endpoint (from the client JS bundle, verbatim):** `wss://${window.location.host}/ws` — i.e. `wss://<tenant>.tx.publicsearch.us/ws`.
Transport is a **plain WebSocket sending JSON text frames** (a reconnecting-WS wrapper in the vendor bundle; NOT socket.io/engine.io — no `EIO=`/`/socket.io/` polling). Server is `openresty`.

**Which headers matter:**
- **Cookies: REQUIRED.** `authToken` + `authToken.sig` must be forwarded on the upgrade. Without them the socket upgrades (101) then the server **immediately closes it** (bare TCP close, no WS close code).
- **`Origin`: NOT enforced.** Handshake succeeds and returns rows with **no Origin header at all**, and identically with the correct `Origin: https://<tenant>.tx.publicsearch.us`. (Tested truthfully; the server does not gate on Origin, so there was nothing to circumvent.)
- **`User-Agent`: not enforced.** Default python/curl UA worked everywhere.

**Handshake auth model (two checks, both derive from the same `__ort`):**
1. Socket accepted only if the signed `authToken`/`authToken.sig` cookie pair validates (fake/unsigned cookie → immediate close).
2. Each frame's `"authToken"` field must equal the session's token. A frame carrying a random (never-issued) `authToken` over a valid cookie session is **silently ignored** (no response, no error frame).

**Frame shape (reverse-engineered from the bundle's remote-action middleware + confirmed live).** The Redux middleware augments every outbound action with `authToken` (= `globalThis.__ort`) and `ip`, and the send path adds a `correlationId`. The request type is `@kofile/FETCH_DOCUMENTS/v4`; the reply is `@kofile/FETCH_DOCUMENTS_FULFILLED/v6` (or `..._REJECTED/v0..1`), echoing the same `correlationId`.

**Copy-pasteable working example (dallas; identical for other tenants, swap host + dept):**

```python
import json, uuid, re, urllib.request, websocket
from websocket._abnf import ABNF

tenant = "dallas"
base   = f"https://{tenant}.tx.publicsearch.us"

# 1) GET homepage with a cookie jar (non-browser UA is fine)
cj = urllib.request.HTTPCookieProcessor()
op = urllib.request.build_opener(cj)
html = op.open(urllib.request.Request(base + "/",
        headers={"User-Agent": "curl/8.0 recon"}), timeout=20).read().decode()
ort     = re.search(r'window\.__ort="([0-9a-f-]{36})"', html).group(1)
cookies = "; ".join(f"{c.name}={c.value}" for c in cj.cookiejar)   # authToken + authToken.sig

# 2) open the socket, forwarding the cookies (NO Origin needed)
ws = websocket.create_connection(f"wss://{tenant}.tx.publicsearch.us/ws",
        timeout=20, header=[f"Cookie: {cookies}"])

# 3) send a FETCH_DOCUMENTS/v4 frame
frame = {
  "type": "@kofile/FETCH_DOCUMENTS/v4",
  "correlationId": str(uuid.uuid4()),
  "authToken": ort,          # MUST match the cookie session
  "sync": True,
  "payload": {
    "workspaceID": str(uuid.uuid4()),
    "query": {
      "limit": 50, "offset": 0,
      "department": "RP",            # RP = Property Records (deeds) on all 7 tenants
      "searchType": "quickSearch",
      "searchValue": "",             # empty value + a date range == browse-all
      "recordedDateRange": "2024-01-01,2024-12-31",
      "legals": []
    }
  }
}
ws.send(json.dumps(frame))
op_, data = ws.recv_data(control_frame=True)
resp = json.loads(data.decode() if isinstance(data, bytes) else data)
print(resp["type"], resp["payload"]["meta"]["numRecords"])   # FETCH_DOCUMENTS_FULFILLED/v6 265307
```

**The `searchValue:"" + recordedDateRange` query DID return rows over the non-browser socket.** Response payload shape:

```
payload = { workspaceID, meta:{ numRecords, statistics:{recorded-years[], docTypes[]} },
            data:{ byOrder:[<id>,...], byHash:{ "<id>": {row}, ... } } }
```

Rows are in `payload.data.byHash` keyed by ids in `payload.data.byOrder` (50 per page). Row fields include: `docNumber`, `instrumentNumber`, `docType`, `docTypeCode`, `recordedDate`, `recordedTime`, `instrumentDate`, `pageCount`, `bookVolumePage`, `grantor`, `grantee`, `parties`, `downloadLink`, `imageId`, `docId`, `year`.

**Sanitized sample rows (structural metadata only; party names omitted):**

```
dallas  {"docNumber":"202400049958","docType":"RELEASE","docTypeCode":"REL",
         "recordedDate":"3/12/2024","instrumentDate":"03/05/2024","pageCount":2,
         "bookVolumePage":"--/--/--","recordedTime":"3:52 PM"}

tarrant {"docNumber":"D224028446","docType":"RELEASE","docTypeCode":"R",
         "recordedDate":"2/20/2024","instrumentDate":"02/12/2024","pageCount":2,
         "book":"OPR","bookVolumePage":"OPR/--/--","recordedTime":"3:09 PM"}
```

---

## 3. Token / session lifetime

- **One `__ort` + cookie session survives many queries.** In a single socket with the same token I ran offsets **0, 50, 500, 1000** — all returned `FULFILLED` with 50 rows each. **Pagination to offset >=500 works with one token.** No per-query token rotation needed.
- **The SOCKET (not the token) is dropped after ~90s idle.** After a 90s idle hold the server closed the connection (bare TCP close, no WS close code). This matches the bundle: the client keeps the socket alive with a `{"type":"PING",...}` frame every 30s (server replies `{"type":"PONG",...}`), and a `stableMs:30000` reconnect window. **A fetcher must send a PING every ~30s during a long paginated pull, or just reconnect (cheap: re-GET homepage for a fresh token+cookies).**
- **"Expired"/invalid-token error shape:** there is no explicit expiry error frame. The failure modes observed are:
  - real token, **no cookie** → immediate WS **CLOSE** (no code/reason).
  - real token, **fake/unsigned cookie** → immediate WS **CLOSE** (the `.sig` HMAC is validated server-side).
  - **wrong `authToken` in the frame** over a valid cookie session → **no response at all** (silently ignored; socket stays open until it times out).
  So: cookie failures = hard close; frame-token mismatch = silent drop. Neither returns a structured error code. Practical rule: if you stop getting `FULFILLED` frames, re-GET the homepage for a fresh token+cookie pair.

---

## 4. Rate posture / Origin posture

- **No throttling observed at >=10s pacing.** Across ~30 total probes (7 homepage GETs x2 rounds + 7 authenticated WS queries + a multi-offset pagination run), spaced >=10s, **zero** 401/403/429 and no rate-limit close frames. Sequential per-offset queries at 10s spacing on one socket all succeeded.
- **This was a deliberately light probe** (a few frames per tenant). Real throttling behavior at higher volume is untested — the fetcher should keep conservative pacing and a keepalive PING, and back off on any close/silence.
- **Origin posture:** server does **not** enforce Origin. It relies entirely on the signed cookie + matching frame token. No CSRF/Origin wall to work around.

---

## Recommendation for the in-house 7-county deed fetcher

- **No headless browser needed.** Per tenant: (1) HTTP GET homepage with a cookie jar → capture `__ort` + `authToken`/`authToken.sig` cookies; (2) open `wss://<tenant>.tx.publicsearch.us/ws` forwarding those cookies; (3) send `@kofile/FETCH_DOCUMENTS/v4` frames with `authToken=__ort`, paginate via `offset` (limit 50).
- **Keepalive:** send `{"type":"PING","correlationId":<uuid>,"authToken":<__ort>,"sync":true}` every ~25-30s on long pulls, or re-establish the session (fresh GET) between pages — both are cheap.
- **Politeness:** stay at the >=10s cadence used here; treat any WS CLOSE or silent frame as "reauth + back off," and stop-on-403/429. `RP` = Property Records (deeds) on all 7 tenants. Confirm each county's actual deed-relevant `docTypeCode`s from the `meta.statistics.docTypes` histogram returned in every FULFILLED frame.
- **Caveat:** this validates feasibility and mechanics only, on a light probe. Volume/anti-abuse behavior and the county terms-of-use posture are out of scope and should be checked before any sustained pull.
