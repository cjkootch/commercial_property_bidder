# Lob Residential Mail Fulfillment Foundation

This module provides the foundation for fulfilling residential direct mail campaigns using [Lob](https://www.lob.com/).

## Overview

The residential landscaping lead marketplace sells high-intent property event packages (recently sold, new construction, etc.). This module enables the operator to:

1. Create a direct mail campaign draft from a residential package.
2. Validate recipient addresses.
3. Review proof HTML for postcards or letters.
4. Export test payloads for review before future API integration.

## Current State: Foundation Phase

Real mail is **not** sent yet. The current implementation includes:
- Database schema for campaigns and recipients.
- Preparatory helper logic (address formatting, cost estimation, etc.).
- Safe stubs for the Lob provider.
- Management scripts for draft creation and payload export.
- Operator UI for reviewing campaign details and proofs.

## Future Lob Integration Path

To wire real mail fulfillment:
1. Set the `LOB_API_KEY` environment variable (use a `test_` key first).
2. Implement the `lobProvider` in `lib/residential/lob-provider.ts` to call the Lob REST API.
3. Add server actions to the operator detail page to trigger `createTestPostcard` and `createLivePostcard`.

## Usage

### 1. Create a Campaign Draft
Run the following script to create a campaign from a residential package:
```bash
npm run residential:lob:draft <package_id> [--format postcard_6x9|postcard_6x11|letter]
```

### 2. Export a Test Payload
Review what will be sent to Lob by exporting a JSON payload:
```bash
npm run residential:lob:export-test-payload <campaign_id>
```
The payload will be saved in the `lob-payloads/` directory (gitignored).

## Compliance & Safety

- **Data Privacy**: Homeowner addresses should not be exposed on public-facing pages. They are only visible in the authenticated operator dashboard.
- **Proof Approval**: A campaign should always be reviewed and approved by the operator/client before submission.
- **Tone**: Use soft, welcoming language ("Welcome to the neighborhood") rather than invasive language ("We saw you just moved").
- **No Scraping**: Do not use data from restricted portals (Zillow, MLS, etc.).
