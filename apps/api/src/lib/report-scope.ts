// Access-control scoping for report endpoints (plans/2026-11-12-role-model.md).
//
// Policy:
//   - admin          → unrestricted.
//   - national       → national report only (summary-only).
//   - county         → its county (region) and the districts / facilities in it,
//                      by the entity's current region (summary-only).
//   - subcounty      → its sub-county (district) and the facilities in it, by the
//                      facility's current district (summary-only).
//   - facility_admin → its facility, that facility's departments, and individual
//                      reports of users in it.
//   - staff          → its own individual report only.
// Summary-only roles never see department (per-person grid) or individual reports.

import { query } from '../db/database';
import { isSummaryOnlyRole, type Role } from './roles';

export interface Scope {
  role: Role;
  userId: number;
  facilityId: number | null;
  departmentId: number | null;
  regionId: number | null;
  districtId: number | null;
  /** Assigned regions — county coordinators only; empty for everyone else. */
  regionIds: number[];
  /** Assigned districts — sub-county coordinators only; empty for everyone else. */
  districtIds: number[];
}

/** Aggregates only: approved submissions, small-group suppression. */
export const isSummaryOnly = (scope: Scope) => isSummaryOnlyRole(scope.role);

export function getScope(userId: number): Scope {
  const [row] = query<{
    role: Role;
    facility_id: number | null;
    department_id: number | null;
    region_id: number | null;
    district_id: number | null;
  }>(
    `SELECT u.role, u.facility_id, u.department_id, f.region_id, f.district_id
     FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
     WHERE u.id = ?`,
    [userId],
  );
  const role = row?.role ?? 'staff';
  const regionIds = role === 'county'
    ? query<{ region_id: number }>('SELECT region_id FROM user_regions WHERE user_id = ?', [userId])
        .map((r) => r.region_id)
    : [];
  const districtIds = role === 'subcounty'
    ? query<{ district_id: number }>('SELECT district_id FROM user_districts WHERE user_id = ?', [userId])
        .map((r) => r.district_id)
    : [];
  return {
    role,
    userId,
    facilityId: row?.facility_id ?? null,
    departmentId: row?.department_id ?? null,
    regionId: row?.region_id ?? null,
    districtId: row?.district_id ?? null,
    regionIds,
    districtIds,
  };
}

type ReportRequest =
  | { level: 'national' }
  | { level: 'region'; regionId: number }
  | { level: 'district'; districtId: number }
  | { level: 'facility'; facilityId: number }
  | { level: 'department'; departmentId: number }
  | { level: 'user'; targetUserId: number };

const districtRegion = (id: number) =>
  query<{ region_id: number | null }>('SELECT region_id FROM districts WHERE id = ?', [id])[0]?.region_id ?? null;
const facilityPlace = (id: number) =>
  query<{ region_id: number | null; district_id: number | null }>(
    'SELECT region_id, district_id FROM facilities WHERE id = ?', [id],
  )[0];

const NO_DEPARTMENT = 'Your role may not view department reports';
const NO_INDIVIDUAL = 'Your role may not view individual reports';

function nationalDeny(requested: ReportRequest): string | null {
  return requested.level === 'national' ? null : 'National users may only view the national report';
}

function countyDeny(scope: Scope, requested: ReportRequest): string | null {
  const assigned = (regionId: number | null | undefined) => regionId != null && scope.regionIds.includes(regionId);
  const OUT = 'County coordinators may only view reports for their county';
  switch (requested.level) {
    case 'national':   return 'County coordinators may not view the national report';
    case 'region':     return assigned(requested.regionId) ? null : OUT;
    case 'district':   return assigned(districtRegion(requested.districtId)) ? null : OUT;
    case 'facility':   return assigned(facilityPlace(requested.facilityId)?.region_id) ? null : OUT;
    case 'department': return NO_DEPARTMENT;
    case 'user':       return NO_INDIVIDUAL;
  }
}

function subcountyDeny(scope: Scope, requested: ReportRequest): string | null {
  const assigned = (districtId: number | null | undefined) => districtId != null && scope.districtIds.includes(districtId);
  const OUT = 'Sub-county coordinators may only view reports for their sub-county';
  switch (requested.level) {
    case 'national':
    case 'region':     return OUT;
    case 'district':   return assigned(requested.districtId) ? null : OUT;
    case 'facility':   return assigned(facilityPlace(requested.facilityId)?.district_id) ? null : OUT;
    case 'department': return NO_DEPARTMENT;
    case 'user':       return NO_INDIVIDUAL;
  }
}

function facilityAdminDeny(scope: Scope, requested: ReportRequest): string | null {
  const OUT = 'Facility admins may only view reports for their facility';
  if (scope.facilityId == null) return OUT;
  switch (requested.level) {
    case 'national':
    case 'region':
    case 'district':
      return OUT;
    case 'facility':
      return scope.facilityId === requested.facilityId ? null : OUT;
    case 'department': {
      const [row] = query<{ facility_id: number }>(
        'SELECT facility_id FROM facility_departments WHERE department_id = ? AND facility_id = ? LIMIT 1',
        [requested.departmentId, scope.facilityId],
      );
      return row ? null : OUT;
    }
    case 'user': {
      if (requested.targetUserId === scope.userId) return null;
      const [u] = query<{ facility_id: number | null }>('SELECT facility_id FROM users WHERE id = ?', [requested.targetUserId]);
      return u && u.facility_id === scope.facilityId ? null : OUT;
    }
  }
}

function staffDeny(scope: Scope, requested: ReportRequest): string | null {
  return requested.level === 'user' && requested.targetUserId === scope.userId
    ? null
    : 'Staff may only view their own results';
}

/**
 * Returns null if the caller is allowed to view the requested level;
 * returns a string reason if they are not (use to emit 403).
 */
export function denyReason(scope: Scope, requested: ReportRequest): string | null {
  switch (scope.role) {
    case 'admin':          return null;
    case 'national':       return nationalDeny(requested);
    case 'county':         return countyDeny(scope, requested);
    case 'subcounty':      return subcountyDeny(scope, requested);
    case 'facility_admin': return facilityAdminDeny(scope, requested);
    default:               return staffDeny(scope, requested);
  }
}
