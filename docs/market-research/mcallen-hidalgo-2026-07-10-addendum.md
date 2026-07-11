# McAllen–Hidalgo addendum: TABC per-city split — 2026-07-10

_Run in-house by Claude (round-3 inbox task 5). One Socrata query, live._

Query: `data.texas.gov/resource/mxm5-tdpj.json` —
`$where=upper(county)='HIDALGO'`, `$select=upper(city),count(*)`,
`$group=upper(city)`.

## The 23 pending applications by city

| City | Pending | Covered by a full-schema parcel clip? |
|---|---|---|
| Edinburg | 7 | ✓ (COE_HCAD, 60.5k parcels, 2025 roll) |
| McAllen | 4 | ✗ |
| Mission | 4 | ✗ |
| Pharr | 2 | ✗ |
| Weslaco | 2 | ✓ (COW_HCAD, 30k parcels) |
| Alton | 2 | ✗ |
| Mercedes | 1 | ✗ |
| Donna | 1 | ✗ |

**Coverage math: the Edinburg + Weslaco clips gate 9 of 23 (39%)** of the
TABC signal. McAllen/Mission/Pharr venues (10 of 23) would resolve no parcel
→ the conservative class gates reject them (not cached; they retry free).

Address quality is good: full situs (`300 E University Dr, Edinburg, 78539`),
so geocoding and grass-screening work regardless of parcel coverage.

## Implication for the metro #10 decision

- **Launch-partial option:** open with the two city clips → roughly 9 TABC/
  cycle + LGBS tax sales county-wide (LGBS carries its own appraised values;
  class gates still need parcels, so tax-sale adds skew to Edinburg/Weslaco
  too). Real but thin.
- **Wait option:** the Hidalgo CAD data request (already flagged, human
  action) unlocks the full 23 + county-wide tax-sale gating in one step.

Recommendation stays: send the CAD request first; build metro #10 when it
lands or is refused (then launch partial).
