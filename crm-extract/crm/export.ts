// CSV export.
//
// Ported from lib/leads/package.ts (the escaping) and app/leads/export/route.ts
// (the discipline). The discipline is the valuable part and it came from a real
// incident: the export route originally STAMPED state on GET, and a link
// prefetcher — a Slack unfurl, an iMessage preview, a browser preloading a
// bookmark — silently destroyed sellable inventory by "visiting" the URL.
//
// Rule inherited: a GET export is read-only, always. If an export must record
// that it happened, that write goes behind POST.

/** RFC-4180 field escaping: quote when the value contains a comma, quote or
 *  newline; double any embedded quotes. */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text with a trailing newline. Column order is explicit, never
 *  Object.keys() of the first row (which silently drops fields when row 1
 *  happens to have a null). */
export function toCsv<T extends Record<string, unknown>>(columns: (keyof T & string)[], rows: T[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n") + "\n";
}

/** A download Response. `no-store` so a CSV is never served from a cache with
 *  stale contents. */
export function csvResponse(csv: string, filenameBase: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Excel-safe guard against CSV formula injection: a field starting with = + - @
 *  is executed as a formula by Excel/Sheets when the file is opened. Any export
 *  of user- or import-supplied text should pass through this. */
export function csvSafeText(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
