# Residential Landscaping Leads

The residential landscaping lead module provides a foundation for selling high-intent homeowner opportunity reports to local landscapers.

## Overview

Unlike the commercial product which relies on precise turf measurement, the residential product focuses on **property events** and **high-intent signals**. Residential parcels are often too complex for reliable automated turf measurement (due to tree cover, fences, and structures), but homeowner transitions are strong predictors of new landscaping spend.

## Core Concepts

### Signals

We track various signals that indicate a likely need for landscaping services:

- **Very High Value**: New construction, Certificate of Occupancy, Permit completion (e.g., pools, decks).
- **High Value**: Recently sold homes (new movers).
- **Medium Value**: New listings, price reductions, stale listings.

### Scoring

Leads are scored based on the **Signal Type** and **Confidence** level:
- **Signal Weight**: 100 for New Construction, 80 for Recently Sold, 60 for Listings, 20 for Manual.
- **Confidence Multiplier**: High (1.0), Med (0.7), Low (0.4).

### Packages

Leads are bundled into **Residential Opportunity Reports** (Packages) based on Geography (Zip Code or Subdivision).

## Usage

### Importing Leads

Import leads from a CSV file:

```bash
npm run residential:import -- path/to/leads.csv
```

CSV columns should include: `address, city, state, zip, subdivision_name, builder_name, signal_type, signal_date, source, estimated_home_value, lot_size_sqft, year_built, confidence, notes`.

### Building Packages

Group "sourced" or "qualified" leads into draft packages:

```bash
npm run residential:package
```

This groups leads by Zip + Subdivision and creates draft packages in the database.

## UI Sections

- **Buyer Marketplace**: `/buyers/residential` - Landscapers can view and unlock residential opportunity reports.
- **Operator Dashboard**: `/dashboard/residential` - Admins can manage packages, view lead counts, and track status.

## Future Integration

- **Automated Sourcing**: Integration with public records or partner feeds.
- **Payments**: Wire the "Unlock" button to Stripe using the existing pattern in `app/buyers/page.tsx`.
- **Dossier Generation**: Create detailed PDF or web-based reports for unlocked packages.
