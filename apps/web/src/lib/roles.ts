// The role model (plans/2026-11-12-role-model.md). Mirrors apps/api/src/lib/roles.ts;
// the API enforces every rule, these only shape the UI.

export const ROLES = ["admin", "national", "county", "subcounty", "facility_admin", "staff"] as const;
export type Role = (typeof ROLES)[number];

const has = (list: readonly Role[], role: string | null | undefined) =>
  role != null && (list as readonly string[]).includes(role);

/** Aggregates only: approved submissions, small-group suppression, no individuals. */
export const SUMMARY_ONLY_ROLES: readonly Role[] = ["national", "county", "subcounty"];
export const isSummaryOnlyRole = (role: string | null | undefined) => has(SUMMARY_ONLY_ROLES, role);

/** Roles placed in a facility; the only ones that take assessments. */
export const FACILITY_ROLES: readonly Role[] = ["facility_admin", "staff"];
export const isFacilityRole = (role: string | null | undefined) => has(FACILITY_ROLES, role);

/** Roles that see the review queue. */
export const REVIEWER_ROLES: readonly Role[] = ["admin", "subcounty", "facility_admin"];

/** Roles that may manage users (facility admins only within their facility). */
export const USER_MANAGER_ROLES: readonly Role[] = ["admin", "facility_admin"];

/** Roles a caller may give in the Users form. */
export function assignableRoles(callerRole: Role | null | undefined): readonly Role[] {
  if (callerRole === "admin") return ROLES;
  if (callerRole === "facility_admin") return FACILITY_ROLES;
  return [];
}
