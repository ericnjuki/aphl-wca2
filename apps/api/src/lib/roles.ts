// The role model (plans/2026-11-12-role-model.md).
//
//   admin          all-powerful: users, setup, catalogue, any review, every report.
//                  Does not take assessments.
//   national       national report only, summary-only.
//   county         one county (region, user_regions); county report and below, summary-only.
//   subcounty      one sub-county (district, user_districts); sub-county report + its
//                  facilities, summary-only. Reviews any submission from its facilities.
//   facility_admin one facility; takes assessments; reviews its facility's submissions
//                  (never its own); facility/department/individual reports in its
//                  facility; creates staff and facility admins in its facility.
//   staff          one facility; takes assessments; sees only its own results.

export const ROLES = ['admin', 'national', 'county', 'subcounty', 'facility_admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** Aggregates only: approved submissions, small-group suppression, no individuals. */
export const SUMMARY_ONLY_ROLES: readonly Role[] = ['national', 'county', 'subcounty'];
export const isSummaryOnlyRole = (role: string) => (SUMMARY_ONLY_ROLES as readonly string[]).includes(role);

/** Roles placed in a facility; the only ones that take assessments. */
export const FACILITY_ROLES: readonly Role[] = ['facility_admin', 'staff'];
export const isFacilityRole = (role: string) => (FACILITY_ROLES as readonly string[]).includes(role);

/** Roles that see the review queue. */
export const REVIEWER_ROLES: readonly Role[] = ['admin', 'subcounty', 'facility_admin'];

/** Roles that may manage users (facility admins only within their facility). */
export const USER_MANAGER_ROLES: readonly Role[] = ['admin', 'facility_admin'];
