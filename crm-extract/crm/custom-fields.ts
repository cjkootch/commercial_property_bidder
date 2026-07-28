// Arbitrary custom fields, typed and queryable.
//
// NOTHING in the source app covered this — it had ~20 purpose-built jsonb columns
// (attom, dossier, teaser, signal_summary) and the consequence was that its own
// enrichment data could not be filtered or sorted in SQL. Reports had to fetch
// rows and reduce them in Node.
//
// So: a definition table + a value table with one typed column per type. Costs a
// join; buys `where num_value > 7 order by num_value desc` with an index.
//
// The record_id column is intentionally NOT a foreign key — one value table
// serves companies, contacts and deals. Integrity is enforced here (the def
// carries `entity`, and setValue checks it) rather than by the database. The
// alternative, three near-identical value tables, was worse. Flagged in
// PACKET.md as a known trade-off.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { customFieldDef, customFieldValue, type CustomFieldDef } from "../db/schema";
// One definition of "is this a real calendar day", shared with revisit.ts. This
// used to be a local Date.parse() check and it accepted 2027-02-30, because V8
// rolls an impossible date forward instead of rejecting it — the stored value then
// disagreed with what the user typed. Caught by custom-fields.test.ts.
import { isValidDateStr } from "./revisit";

export type FieldType = "number" | "text" | "enum" | "boolean" | "date";
export type EntityKind = "company" | "contact" | "deal";

/** A value in app terms — exactly one shape, discriminated by the def's type. */
export type FieldValue = number | string | boolean | null;

export async function listFieldDefs(entity: EntityKind, includeArchived = false): Promise<CustomFieldDef[]> {
  return db
    .select()
    .from(customFieldDef)
    .where(
      includeArchived
        ? eq(customFieldDef.entity, entity)
        : and(eq(customFieldDef.entity, entity), isNull(customFieldDef.archived_at))
    )
    .orderBy(customFieldDef.sort_order, customFieldDef.label);
}

export async function createFieldDef(o: {
  entity: EntityKind;
  key: string;
  label: string;
  type: FieldType;
  options?: string[] | null;
  helpText?: string | null;
  sortOrder?: number;
}): Promise<string> {
  if (o.type === "enum" && (!o.options || o.options.length === 0)) {
    throw new Error("An enum field needs at least one option");
  }
  const key = o.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
  if (!key) throw new Error("createFieldDef: key normalizes to empty");
  const [row] = await db
    .insert(customFieldDef)
    .values({
      entity: o.entity,
      key,
      label: o.label.trim(),
      type: o.type,
      options: o.options ?? null,
      help_text: o.helpText ?? null,
      sort_order: o.sortOrder ?? 0,
    })
    .returning({ id: customFieldDef.id });
  return row.id;
}

/** PURE. Validate + normalize a raw form value against a definition. Returns the
 *  column patch to write, or an error message. Pure so it is unit-testable and
 *  usable for client-side validation too. */
export function coerceValue(
  def: Pick<CustomFieldDef, "type" | "options" | "label">,
  raw: unknown
):
  | { ok: true; patch: { num_value: number | null; text_value: string | null; bool_value: boolean | null; date_value: string | null } }
  | { ok: false; error: string } {
  const empty = { num_value: null, text_value: null, bool_value: null, date_value: null };
  // Clearing a field is always legal.
  if (raw === null || raw === undefined || raw === "") return { ok: true, patch: empty };

  switch (def.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, $]/g, ""));
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number` };
      return { ok: true, patch: { ...empty, num_value: n } };
    }
    case "text":
      return { ok: true, patch: { ...empty, text_value: String(raw).slice(0, 4000) } };
    case "enum": {
      const v = String(raw);
      const allowed = def.options ?? [];
      if (!allowed.includes(v)) {
        return { ok: false, error: `${def.label} must be one of: ${allowed.join(", ")}` };
      }
      return { ok: true, patch: { ...empty, text_value: v } };
    }
    case "boolean": {
      const v =
        typeof raw === "boolean" ? raw : ["true", "1", "yes", "on"].includes(String(raw).toLowerCase());
      return { ok: true, patch: { ...empty, bool_value: v } };
    }
    case "date": {
      const s = String(raw).slice(0, 10);
      if (!isValidDateStr(s)) {
        return { ok: false, error: `${def.label} must be a date (YYYY-MM-DD)` };
      }
      return { ok: true, patch: { ...empty, date_value: s } };
    }
  }
}

/** PURE. Read the populated column back out as a single app-level value. */
export function readValue(
  def: Pick<CustomFieldDef, "type">,
  row: { num_value: number | null; text_value: string | null; bool_value: boolean | null; date_value: string | null } | undefined
): FieldValue {
  if (!row) return null;
  switch (def.type) {
    case "number":
      return row.num_value;
    case "text":
    case "enum":
      return row.text_value;
    case "boolean":
      return row.bool_value;
    case "date":
      return row.date_value;
  }
}

/** Set (or clear) one field on one record. Upsert on the (def, record) unique —
 *  so this is idempotent and safe to call from a bulk import. */
export async function setFieldValue(o: {
  defId: string;
  recordId: string;
  raw: unknown;
  /** Guard: the def must belong to the entity the caller thinks it is writing. */
  expectEntity?: EntityKind;
}): Promise<void> {
  const [def] = await db
    .select()
    .from(customFieldDef)
    .where(eq(customFieldDef.id, o.defId))
    .limit(1);
  if (!def) throw new Error(`setFieldValue: no such field def ${o.defId}`);
  if (o.expectEntity && def.entity !== o.expectEntity) {
    throw new Error(`setFieldValue: field "${def.key}" is for ${def.entity}, not ${o.expectEntity}`);
  }
  const coerced = coerceValue(def, o.raw);
  if (!coerced.ok) throw new Error(coerced.error);

  await db
    .insert(customFieldValue)
    .values({ def_id: o.defId, record_id: o.recordId, ...coerced.patch })
    .onConflictDoUpdate({
      target: [customFieldValue.def_id, customFieldValue.record_id],
      set: { ...coerced.patch, updated_at: new Date() },
    });
}

export type FieldWithValue = { def: CustomFieldDef; value: FieldValue };

/** All custom fields for one record, definitions included (so a form can render
 *  labels, types and enum options without a second query). */
export async function fieldsForRecord(entity: EntityKind, recordId: string): Promise<FieldWithValue[]> {
  const rows = await db
    .select({ def: customFieldDef, val: customFieldValue })
    .from(customFieldDef)
    .leftJoin(
      customFieldValue,
      and(eq(customFieldValue.def_id, customFieldDef.id), eq(customFieldValue.record_id, recordId))
    )
    .where(and(eq(customFieldDef.entity, entity), isNull(customFieldDef.archived_at)))
    .orderBy(customFieldDef.sort_order, customFieldDef.label);
  return rows.map((r) => ({ def: r.def, value: readValue(r.def, r.val ?? undefined) }));
}

/** Values for MANY records at once — for a list view with custom columns. */
export async function fieldValuesForRecords(
  entity: EntityKind,
  recordIds: string[]
): Promise<Map<string, Map<string, FieldValue>>> {
  const out = new Map<string, Map<string, FieldValue>>();
  if (!recordIds.length) return out;
  const rows = await db
    .select({ def: customFieldDef, val: customFieldValue })
    .from(customFieldValue)
    .innerJoin(customFieldDef, eq(customFieldValue.def_id, customFieldDef.id))
    .where(and(eq(customFieldDef.entity, entity), inArray(customFieldValue.record_id, recordIds)));
  for (const r of rows) {
    const perRecord = out.get(r.val.record_id) ?? new Map<string, FieldValue>();
    perRecord.set(r.def.key, readValue(r.def, r.val));
    out.set(r.val.record_id, perRecord);
  }
  return out;
}

/**
 * Record ids matching a numeric custom-field threshold — the "score > 7" query
 * that a jsonb blob cannot serve. Returns ids for the caller to join.
 */
export async function recordsWhereNumber(o: {
  entity: EntityKind;
  key: string;
  op: ">" | ">=" | "<" | "<=" | "=";
  value: number;
  limit?: number;
}): Promise<string[]> {
  const rows = await db
    .select({ recordId: customFieldValue.record_id })
    .from(customFieldValue)
    .innerJoin(customFieldDef, eq(customFieldValue.def_id, customFieldDef.id))
    .where(
      and(
        eq(customFieldDef.entity, o.entity),
        eq(customFieldDef.key, o.key),
        // op is from a closed union above, never user input — safe to inline.
        sql`${customFieldValue.num_value} ${sql.raw(o.op)} ${o.value}`
      )
    )
    .limit(o.limit ?? 500);
  return rows.map((r) => r.recordId);
}
