// Bulk import/upsert from CSV or JSON. Idempotent and safe to re-run against the
// same records forever.
//
// The CSV parser is ported from scripts/import-residential-leads.ts, where a
// naive `split(",")` had silently corrupted every quoted field — a standard Excel
// export like `"123 Main St, Unit 4"` shifted every downstream column, producing
// garbage data and broken dedupe. It handles quoted fields, escaped quotes, CRLF,
// and a UTF-8 BOM.
//
// What changed from the source: its dedupe was SELECT-then-skip, which is racy
// (two concurrent runs both see "not found" and both insert) and also meant a
// re-import could never ENRICH an existing row. Here dedupe is the database's
// UNIQUE index via upsertCompany(), so re-running is both safe and additive.

import { db } from "../db";
import { importBatch } from "../db/schema";
import { companyKey, upsertCompany, upsertContact, type CompanyIdentity } from "./companies";
import { setFieldValue, listFieldDefs } from "./custom-fields";
import { logAudit } from "./audit";

// --- CSV parsing ------------------------------------------------------------

/** Parse one CSV line (RFC-4180-ish): quoted fields, "" escapes, commas inside
 *  quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parse a whole CSV into row objects keyed by header.
 *
 * Handles multi-line quoted fields by joining physical lines until quotes
 * balance — a genuine gap in the source parser, which split on "\n" first and
 * therefore mangled any address field containing a newline.
 */
export function parseCsv(content: string): Array<Record<string, string>> {
  const text = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const physical = text.split("\n");
  const logical: string[] = [];
  let buf = "";
  for (const line of physical) {
    buf = buf ? `${buf}\n${line}` : line;
    // A line is complete when its quote count is even.
    const quotes = (buf.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) {
      logical.push(buf);
      buf = "";
    }
  }
  if (buf) logical.push(buf);

  const nonEmpty = logical.filter((l) => l.trim().length > 0);
  if (!nonEmpty.length) return [];
  const header = parseCsvLine(nonEmpty[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return nonEmpty.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((col, i) => {
      row[col] = values[i] ?? "";
    });
    return row;
  });
}

// --- import -----------------------------------------------------------------

/** One incoming record. Company fields are flat; contacts and custom values are
 *  optional nested/prefixed extras. CSV callers get `cf_*` prefixed columns
 *  mapped to custom fields automatically. */
export type ImportRow = CompanyIdentity & {
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /** Custom field values by def key. */
  custom?: Record<string, unknown>;
};

export type ImportSummary = {
  batchId: string | null;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  contacts: number;
  customValues: number;
  errors: string[];
};

/** Map a raw CSV/JSON object onto an ImportRow. Unknown `cf_<key>` columns become
 *  custom-field values; everything else is ignored rather than fatal, so one
 *  stray column can't fail a 5,000-row file. */
export function toImportRow(raw: Record<string, unknown>): ImportRow | { error: string } {
  const pick = (k: string): string | null => {
    const v = raw[k];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  const name = pick("name") ?? pick("company") ?? pick("company_name");
  if (!name) return { error: "row has no name/company column" };

  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("cf_") && v !== "" && v !== null && v !== undefined) {
      custom[k.slice(3)] = v;
    }
  }

  return {
    name,
    legal_name: pick("legal_name"),
    website: pick("website") ?? pick("url"),
    phone: pick("phone"),
    email: pick("email"),
    address: pick("address"),
    city: pick("city"),
    state: pick("state"),
    postal_code: pick("postal_code") ?? pick("zip"),
    country: pick("country"),
    source: pick("source"),
    description: pick("description") ?? pick("notes"),
    contact_name: pick("contact_name"),
    contact_title: pick("contact_title"),
    contact_email: pick("contact_email"),
    contact_phone: pick("contact_phone"),
    custom: Object.keys(custom).length ? custom : undefined,
  };
}

/**
 * Import companies (+ optional contact and custom values) idempotently.
 *
 * RE-RUN SAFETY comes from three places, all database-enforced:
 *   - company.dedupe_key UNIQUE + ON CONFLICT  → one company row per name
 *   - contact (company_id, email) partial UNIQUE + ON CONFLICT → one contact row
 *   - custom_field_value (def_id, record_id) UNIQUE + ON CONFLICT → one value
 * No in-memory "seen" set is involved, so two importers running at once, or the
 * same file loaded twice, converge instead of duplicating.
 *
 * Per-row try/catch: one malformed row must never abort the batch (the source app
 * had a whole sourcing run die on a single bad date).
 */
export async function importCompanies(
  rows: Array<Record<string, unknown>>,
  opts: {
    source: string;
    fileName?: string | null;
    actorUserId?: string | null;
    brandId?: string | null;
    ownerUserId?: string | null;
    /** Parse and report without writing. */
    dryRun?: boolean;
  }
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    batchId: null,
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    contacts: 0,
    customValues: 0,
    errors: [],
  };

  // Resolve custom-field defs once so `cf_*` columns can be mapped by key.
  const defs = await listFieldDefs("company").catch(() => []);
  const defByKey = new Map(defs.map((d) => [d.key, d]));

  for (const [i, raw] of rows.entries()) {
    const lineNo = i + 2; // +1 for zero-index, +1 for the header row
    try {
      const mapped = toImportRow(raw);
      if ("error" in mapped) {
        summary.skipped++;
        summary.errors.push(`line ${lineNo}: ${mapped.error}`);
        continue;
      }
      if (!companyKey(mapped.name)) {
        summary.skipped++;
        summary.errors.push(`line ${lineNo}: name "${mapped.name}" normalizes to an empty key`);
        continue;
      }
      if (opts.dryRun) {
        summary.created++; // "would touch"
        continue;
      }

      const { id, created } = await upsertCompany({
        ...mapped,
        brand_id: mapped.brand_id ?? opts.brandId ?? null,
        owner_user_id: mapped.owner_user_id ?? opts.ownerUserId ?? null,
        source: mapped.source ?? opts.source,
      });
      if (created) summary.created++;
      else summary.updated++;

      if (mapped.contact_name) {
        await upsertContact({
          companyId: id,
          full_name: mapped.contact_name,
          title: mapped.contact_title,
          email: mapped.contact_email,
          phone: mapped.contact_phone,
        });
        summary.contacts++;
      }

      if (mapped.custom) {
        for (const [key, value] of Object.entries(mapped.custom)) {
          const def = defByKey.get(key);
          if (!def) {
            summary.errors.push(`line ${lineNo}: unknown custom field "${key}" (skipped)`);
            continue;
          }
          try {
            await setFieldValue({ defId: def.id, recordId: id, raw: value, expectEntity: "company" });
            summary.customValues++;
          } catch (e) {
            summary.errors.push(
              `line ${lineNo}: ${key} — ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
      }
    } catch (e) {
      summary.skipped++;
      summary.errors.push(`line ${lineNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!opts.dryRun) {
    try {
      const [batch] = await db
        .insert(importBatch)
        .values({
          source: opts.source,
          file_name: opts.fileName ?? null,
          actor_user_id: opts.actorUserId ?? null,
          rows_total: summary.total,
          rows_created: summary.created,
          rows_updated: summary.updated,
          rows_skipped: summary.skipped,
          // Cap the stored error list: a pathological file shouldn't write a
          // megabyte of jsonb.
          errors: summary.errors.slice(0, 200),
        })
        .returning({ id: importBatch.id });
      summary.batchId = batch.id;
      await logAudit({
        actorUserId: opts.actorUserId ?? null,
        action: "import.run",
        entity: "import_batch",
        recordId: batch.id,
        after: {
          source: opts.source,
          total: summary.total,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
        },
      });
    } catch (e) {
      summary.errors.push(`batch record failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}

/** Convenience: CSV text → import. */
export async function importCompaniesCsv(
  csv: string,
  opts: Parameters<typeof importCompanies>[1]
): Promise<ImportSummary> {
  return importCompanies(parseCsv(csv), opts);
}
