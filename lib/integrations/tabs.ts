// TDLR TABS (Texas Architectural Barriers) project registry — every Texas
// commercial construction project over $50k must register, and the registry is
// public: project name, facility, location, OWNER, ESTIMATED COST, work type,
// timeline, and a scope-of-work paragraph. That's a statewide feed of
// big-ticket commercial construction with perfect timing (registration happens
// months before occupancy — i.e., before the landscape install is bought).
//
// Endpoints (no auth):
//   POST /TABS/Search/SearchProjects  — DataTables JSON (list + EstimatedCost)
//   GET  /TABS/Search/Details?id=&dataVersionId= — HTML with address/owner/scope

const BASE = "https://www.tdlr.texas.gov/TABS/Search";
const DATA_VERSION = 900001; // "tabs" dataset

export const TABS_COUNTIES = { Harris: 2101, Montgomery: 2167, Waller: 2237, "Fort Bend": 2079 } as const;

export const TABS_WORK_TYPES: Record<number, string> = {
  9001: "New Construction",
  9002: "Renovation/Alteration",
  9003: "Additions to Existing Building",
  9004: "Historic Preservation",
  9005: "Public Right of Way",
};

export type TabsProject = {
  project_id: string;
  project_number: string;
  project_name: string;
  facility_name: string | null;
  county_id: number;
  work_type: number;
  estimated_cost: number;
  registered_on: string; // ISO
  est_start: string | null;
  est_end: string | null;
};

export type TabsDetails = {
  address: string | null;
  city: string | null;
  zip: string | null;
  owner: string | null;
  scope: string | null;
};

type RawRow = {
  ProjectId: string;
  ProjectNumber: string;
  ProjectName: string;
  FacilityName?: string | null;
  County: number;
  TypeOfWork: number;
  EstimatedCost: number;
  ProjectCreatedOn: string;
  EstimatedStartDate?: string | null;
  EstimatedEndDate?: string | null;
};

const mmddyyyy = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

/**
 * Search TABS registrations for a county since a date. Paginates the
 * DataTables endpoint; caller filters/sorts (EstimatedCost is in the rows).
 */
export async function searchTabsProjects(opts: {
  countyId: number;
  registeredSince: Date;
  maxPages?: number;
}): Promise<TabsProject[]> {
  const out: TabsProject[] = [];
  const pageLen = 100;
  const maxPages = opts.maxPages ?? 10;
  for (let page = 0; page < maxPages; page++) {
    const body = new URLSearchParams({
      draw: String(page + 1),
      start: String(page * pageLen),
      length: String(pageLen),
      LocationCounty: String(opts.countyId),
      RegistrationDateBegin: mmddyyyy(opts.registeredSince),
      RegistrationDateEnd: mmddyyyy(new Date()),
      DataVersionId: String(DATA_VERSION),
    });
    const res = await fetch(`${BASE}/SearchProjects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    });
    if (!res.ok) break;
    const data = (await res.json()) as { recordsFiltered?: number; data?: RawRow[] };
    for (const r of data.data ?? []) {
      out.push({
        project_id: r.ProjectId,
        project_number: r.ProjectNumber,
        project_name: r.ProjectName,
        facility_name: r.FacilityName?.trim() || null,
        county_id: r.County,
        work_type: r.TypeOfWork,
        estimated_cost: Number(r.EstimatedCost) || 0,
        registered_on: r.ProjectCreatedOn,
        est_start: r.EstimatedStartDate ?? null,
        est_end: r.EstimatedEndDate ?? null,
      });
    }
    if ((page + 1) * pageLen >= (data.recordsFiltered ?? 0)) break;
  }
  return out;
}

/** Pull one labeled value from the details page: the first non-empty text line
 *  after the label line (the page is label/value pairs once tags are stripped). */
function afterLabel(lines: string[], label: string): string | null {
  const i = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
  if (i === -1) return null;
  const v = lines[i + 1]?.trim() ?? "";
  return v && v !== "Not Assigned" ? v : null;
}

/** Fetch + parse a project's details page (address, owner, scope). */
export async function fetchTabsDetails(projectId: string): Promise<TabsDetails | null> {
  try {
    const res = await fetch(`${BASE}/Details?id=${encodeURIComponent(projectId)}&dataVersionId=${DATA_VERSION}`);
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ");
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      address: afterLabel(lines, "Location Address"),
      city: afterLabel(lines, "Location City"),
      zip: afterLabel(lines, "Location Zip Code"),
      owner: afterLabel(lines, "Owner"),
      scope: afterLabel(lines, "Scope of Work"),
    };
  } catch {
    return null;
  }
}
