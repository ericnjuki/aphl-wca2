import type { AuthUser } from "@/store/auth";
import type { Role } from "@/lib/roles";
import type { ReportLevel } from "@/types/reports";

export type LandingUser = Pick<AuthUser, "id" | "role" | "facility_id" | "regions" | "districts">;

const ORDER: ReportLevel[] = ["national", "region", "district", "facility", "department", "individual"];

/** The highest report level each role may open (the API's report-scope enforces it). */
export const TOP_LEVEL: Record<Role, ReportLevel> = {
  admin: "national",
  national: "national",
  county: "region",
  subcounty: "district",
  facility_admin: "facility",
  staff: "individual",
};

/** The lowest level each role may open: summary-only roles never see departments or individuals. */
const BOTTOM_LEVEL: Record<Role, ReportLevel> = {
  admin: "individual",
  national: "region",
  county: "facility",
  subcounty: "facility",
  facility_admin: "individual",
  staff: "individual",
};

/**
 * Whether `role` may open a report at `level`. Used to stop links, breadcrumbs and
 * drill-downs at the role's limits, so nothing renders that would 403. National
 * users see the per-county list only (no drill-down below it).
 */
export function canOpenLevel(role: Role | null | undefined, level: ReportLevel): boolean {
  if (!role) return false;
  if (role === "national") return level === "national";
  const i = ORDER.indexOf(level);
  return i >= ORDER.indexOf(TOP_LEVEL[role]) && i <= ORDER.indexOf(BOTTOM_LEVEL[role]);
}

/**
 * Where a user lands when they open /reports (the national level). Admins and
 * national users stay; everyone else goes to their own unit:
 *   county → their county, subcounty → their sub-county,
 *   facility_admin → their facility, staff → their own report.
 * A coordinator or facility admin with no assignment gets the "not assigned" notice.
 */
export function reportsLanding(
  user: LandingUser | null,
  level: ReportLevel,
  baseUrl: string,
): { redirect: string | null; unassigned: boolean } {
  const none = { redirect: null, unassigned: false };
  if (!user || level !== "national") return none;
  const go = (path: string) => ({ redirect: `${baseUrl}reports/${path}`, unassigned: false });
  const notAssigned = { redirect: null, unassigned: true };

  switch (user.role) {
    case "admin":
    case "national":
      return none;
    case "county":
      return user.regions.length > 0 ? go(`regions/${user.regions[0].id}`) : notAssigned;
    case "subcounty":
      return user.districts.length > 0 ? go(`districts/${user.districts[0].id}`) : notAssigned;
    case "facility_admin":
      return user.facility_id != null ? go(`facilities/${user.facility_id}`) : notAssigned;
    case "staff":
      return go(`users/${user.id}`);
  }
}
