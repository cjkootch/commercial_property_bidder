// Server-side PDF of a lead's job-intelligence sheet — a real, vector PDF with
// controlled pagination (no browser, so it runs on Vercel serverless and looks
// identical for every buyer). Rendered on demand by the /pdf route.

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Dossier } from "./dossier";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export type SheetPdfInput = {
  dossier: Dossier;
  brand: string;
  accent: string;
  companyName: string;
  kind: string; // "exclusive" | other
  cap: number;
  /** The intro letter, already personalized from the buyer's profile. */
  letter: string;
};

function styles(accent: string) {
  return StyleSheet.create({
    page: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 40, fontSize: 10, color: "#1f2937", fontFamily: "Helvetica", lineHeight: 1.4 },
    brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 2, borderBottomColor: accent, paddingBottom: 8, marginBottom: 14 },
    brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#111827" },
    brandSub: { fontSize: 8, color: "#9ca3af", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 2 },
    metaRight: { textAlign: "right", fontSize: 8, color: "#6b7280" },
    metaRef: { fontFamily: "Helvetica-Bold", color: "#374151", fontSize: 9 },
    badge: { alignSelf: "flex-start", color: "#fff", fontSize: 7, fontFamily: "Helvetica-Bold", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
    h1: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827" },
    addr: { fontSize: 10, color: "#4b5563", marginTop: 2 },
    drive: { color: accent, fontFamily: "Helvetica-Bold" },
    // Fixed banner height so the aerial fits under the title on page 1 (a tall
    // natural-height image would bump to the next page, leaving page 1 blank).
    aerial: { width: "100%", height: 250, borderRadius: 6, marginTop: 12, objectFit: "cover" },
    statRow: { flexDirection: "row", gap: 10, marginTop: 14 },
    stat: { flex: 1, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, padding: 8 },
    statVal: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#111827" },
    statLabel: { fontSize: 7, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
    section: { marginTop: 16 },
    sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#374151", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
    row: { flexDirection: "row", marginBottom: 3 },
    rowLabel: { width: 130, color: "#6b7280" },
    rowVal: { flex: 1, color: "#111827" },
    letterBox: { marginTop: 6, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, padding: 12, backgroundColor: "#f9fafb" },
    letter: { fontSize: 9.5, lineHeight: 1.5, color: "#374151" },
    footer: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#9ca3af", borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingTop: 6 },
  });
}

export async function renderSheetPdf(input: SheetPdfInput): Promise<Buffer> {
  const { dossier: d, brand, accent, companyName, kind, cap, letter } = input;
  const s = styles(accent);

  const info: Array<[string, string | null]> = [
    ["Work type", d.work_type],
    ["Est. construction start", d.est_start],
    ["Est. completion", d.est_completion],
    ["Engage owner by", d.engage_by],
    ["Project cost", d.project_cost],
    ["Scope", d.scope],
  ];

  const doc = (
    <Document title={`Greenkeep — ${d.name} — job sheet`} author={brand}>
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.brandRow} fixed>
          <View>
            <Text style={s.brand}>{brand}</Text>
            <Text style={s.brandSub}>Job intelligence sheet</Text>
          </View>
          <View style={s.metaRight}>
            <Text style={s.metaRef}>{d.gk_ref}</Text>
            <Text>Prepared for {companyName}</Text>
            <Text>{d.prepared_at}</Text>
          </View>
        </View>

        <Text style={[s.badge, { backgroundColor: kind === "exclusive" ? "#b45309" : accent }]}>
          {kind === "exclusive" ? "Exclusively yours" : `Capped at ${cap} companies`}
        </Text>
        <Text style={s.h1}>{d.name}</Text>
        <Text style={s.addr}>
          {[d.address, d.city, d.zip].filter(Boolean).join(", ")}
          {d.county ? ` · ${d.county} County` : ""}
          {d.drive ? <Text style={s.drive}>{`  ·  ${d.drive.minutes} min drive (${d.drive.miles} mi)`}</Text> : null}
        </Text>

        {d.aerial?.image ? <Image style={s.aerial} src={d.aerial.image} /> : null}

        <View style={s.statRow}>
          <View style={s.stat}>
            <Text style={s.statVal}>{`${usd(d.annual_lo)}–${usd(d.annual_hi)}`}</Text>
            <Text style={s.statLabel}>Est. annual contract</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statVal}>{`${usd(d.monthly)}/mo`}</Text>
            <Text style={s.statLabel}>Monthly</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statVal}>{d.turf_sqft.toLocaleString()}</Text>
            <Text style={s.statLabel}>{`Turf sq ft${d.projected ? " (projected)" : ""}`}</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statVal}>{`${d.visits_per_year}/yr`}</Text>
            <Text style={s.statLabel}>Visits</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Project</Text>
          {info
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <View style={s.row} key={k}>
                <Text style={s.rowLabel}>{k}</Text>
                <Text style={s.rowVal}>{v}</Text>
              </View>
            ))}
        </View>

        {d.contacts.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Decision contacts</Text>
            {d.contacts.map((c, i) => (
              <View style={s.row} key={i}>
                <Text style={s.rowLabel}>{c.role}</Text>
                <Text style={s.rowVal}>{c.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {d.route_intel || d.guidance ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>How to win it</Text>
            {d.route_intel ? <Text style={{ marginBottom: 4 }}>{d.route_intel}</Text> : null}
            {d.guidance ? <Text style={{ color: "#4b5563" }}>{d.guidance}</Text> : null}
          </View>
        ) : null}

        {letter ? (
          <View style={s.section} wrap>
            <Text style={s.sectionTitle}>Ready-to-send intro letter</Text>
            <View style={s.letterBox}>
              <Text style={s.letter}>{letter}</Text>
            </View>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{`${brand} · Prepared for ${companyName}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
