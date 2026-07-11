# CivicEngage bid-board sweep — 2026-07-10

_Run in-house by Claude (round-3 inbox task 4; OpenClaw busy). Read-only: one
GET per candidate domain (`/Bids.aspx`), 2s pacing, no forms, nothing gated
touched. Verdict-grade evidence below; raw HTML snapshots discarded after
title extraction._

## Verdict: DO NOT build the CivicEngage feed — same death as Ionwave

**0 of 35 unique open bids across every live board are grounds-relevant**
(keyword set identical to the Ionwave probe: landscap, grounds, mow,
irrigation, tree/arbor, janitorial/custodial, lawn, turf, vegetation, weed,
brush, right-of-way, median, park/athletic-field maintenance, pest,
herbicide). The content is water/sewer construction, road materials,
chemicals supply, audit/underwriting services, and fire-station construction.
Two RFP-platform sweeps (Ionwave 0/29, CivicEngage 0/35) now point the same
way: in these metros, actual grounds solicitations concentrate on Bonfire —
which we already parse.

## Sweep coverage

49 candidate agency domains across the nine metros (core cities, counties,
major suburbs), detection = `GET https://{www.,}<domain>/Bids.aspx` returning
a page with `bids.aspx?bidID=` anchors.

### Live CivicEngage boards found (6)

| Agency | Metro | Unique open bids | Grounds hits |
|---|---|---|---|
| City of League City (`leaguecitytx.gov`) | Houston | 5 | 0 |
| City of Galveston (`galvestontx.gov`) | Houston | 2 | 0 |
| City of San Marcos (`sanmarcostx.gov`) | Austin | 4 | 0 |
| City of Portland (`portlandtx.com`) | Corpus | 3 | 0 |
| City of San Benito (`cityofsanbenito.com`) | Brownsville | 15* | 0 |
| City of Port Arthur (`portarthurtx.gov`) | Beaumont | 6 | 0 |

*San Benito's board does not prune: entries from FY2021–22 are still listed
as "bids" — any future parser would need a posted/close-date filter, and the
true open count is far lower than 15.

### Not CivicEngage (43)

Houston, Dallas (all domains 404/000), Fort Worth, Arlington, San Antonio,
Bexar, Austin, Travis, El Paso city+county, Corpus, Nueces, Waco, McLennan,
Brownsville, Cameron, Beaumont, Jefferson, and every other probed suburb
either 404s on `/Bids.aspx` or serves a non-CivicEngage page. The big
cities/counties in our metros do not use CivicEngage bid boards.

## Parser notes (recorded in case content ever appears)

One parser would cover all six boards: server-rendered HTML, bid rows are
`<a href="bids.aspx?bidID=N">title</a>`, no login, no CAPTCHA, no JS
required. If a future re-probe shows grounds content, the build is an
afternoon. Re-probe trigger: quarterly, or when a new metro opens.
