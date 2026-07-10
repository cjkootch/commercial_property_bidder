# Email Automation Roadmap

This document outlines recommendations for evolving the current manual email system into a fully functioning email automation system.

## Current State

- **Integration**: Resend API is integrated in `lib/integrations/resend.ts`.
- **Campaigns**: Manual campaign generation and sending scripts (`scripts/campaign-kit.ts`, `scripts/campaign-send.ts`).
- **Tracking**: Webhook sink in `app/api/webhooks/resend/route.ts` records opens, clicks, and bounces.
- **Suppression**: Centralized `suppression` table for opt-outs.

## Recommendations for Automation

### 1. Trigger-Based Automations

Instead of manual scripts, implement listeners for specific database events:

- **New Lead Alert**: When a new property reaches `proposal_ready` or a new `residential_package` is published, automatically notify matching buyers based on their city/zip preferences.
- **Abandoned Checkout**: If a `stripe_session_id` is generated but no `lead_unlock` is completed within 2 hours, send a follow-up email with a direct link to complete the purchase.
- **Welcome Sequence**: When a new buyer signs up, trigger a 3-part educational sequence over 7 days.

### 2. Job Queue Implementation

The serverless environment (Next.js/Vercel) has execution limits. Use a background job processor (like Upstash QStash or Inngest) to handle:

- Rate-limiting outbound sends.
- Retrying failed deliveries.
- Scheduling delayed follow-ups.

### 3. Templating System

Move away from manual HTML generation in scripts.

- Use a library like **React Email** or **MJML** to build responsive, brand-consistent templates.
- Store template definitions in the codebase and use a renderer to inject dynamic data (e.g., property name, estimated value).

### 4. Dynamic Segmentation

Automate the "kit" generation logic:

- Create a `campaign_segments` table to define buyer groups (e.g., "Houston Commercial", "Residential Only").
- Periodically refresh segment memberships based on buyer activity and attributes.

### 5. Enhanced Tracking & Analytics

- **Drip Logic**: Track which emails in a sequence a buyer has received to avoid duplicates.
- **Heatmaps**: Leverage Resend click tracking to identify which parts of the "Job Sheet" teaser are most engaging.

## Proposed Claude Task: "Phase 2 - Automated Alerts"

1. Create a `lib/automation/` directory.
2. Implement a `notifyBuyersOfNewPackage` function that:
   - Finds buyers who have `notify: true` and match the package zip.
   - Generates personalized emails using the existing `sendEmail` helper.
   - Records the send in the `outreach` table for tracking.
3. Hook this function into the `scripts/build-residential-packages.ts` script (or a new admin API endpoint).
