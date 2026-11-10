// Access-control scoping for report endpoints.
//
// Policy:
//   - admin   → unrestricted.
//   - staff   → may only view reports covering their own facility / department / district / region.
//               Requests for national or a different facility/region return 403.
//               Their own individual report is always allowed.
//   - monitor → partner user scoped to the regions in user_regions. May view
//               region / district / facility reports inside those regions only
//               (by the entity's current region). Never national, department
//               (per-person grid) or individual reports.

import { query } from '../db/database';

export interface Scope {
  role: 'staff' | 'admin' | 'monitor';
  userId: number;
  facilityId: number | null;
  departmentId: number | null;
  regionId: number | null;
  districtId: number | null;
  /** Assigned regions — monitors only; empty for everyone else. */
  regionIds: number[];
}

export function getScope(userId: number): Scope {
  const [row] = query<{
    role: 'staff' | 'admin' | 'monitor';
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
  const regionIds = role === 'monitor'
    ? query<{ region_id: number }>('SELECT region_id FROM user_regions WHERE user_id = ?', [userId])
        .map((r) => r.region_id)
    : [];
  return {
    role,
    userId,
    facilityId: row?.facility_id ?? null,
    departmentId: row?.department_id ?? null,
    regionId: row?.region_id ?? null,
    districtId: row?.district_id ?? null,
    regionIds,
  };
}

type ReportRequest =
  | { level: 'national' }
  | { level: 'region'; regionId: number }
  | { level: 'district'; districtId: number }
  | { level: 'facility'; facilityId: number }
  | { level: 'department'; departmentId: number }
  | { level: 'user'; targetUserId: number };

const OUT_OF_REGION = 'Partner users may only view reports for their assigned regions';

function monitorDenyReason(scope: Scope, requested: ReportRequest): string | null {
  const assigned = (regionId: number | null | undefined) =>
    regionId != null && scope.regionIds.includes(regionId);

  switch (requested.level) {
    case 'national':
      return 'Partner users may not view the national report';
    case 'region':
      return assigned(requested.regionId) ? null : OUT_OF_REGION;
    case 'district': {
      const [d] = query<{ region_id: number | null }>(
        'SELECT region_id FROM districts WHERE id = ?', [requested.districtId],
      );
      return assigned(d?.region_id) ? null : OUT_OF_REGION;
    }
    case 'facility': {
      const [f] = query<{ region_id: number | null }>(
        'SELECT region_id FROM facilities WHERE id = ?', [requested.facilityId],
      );
      return assigned(f?.region_id) ? null : OUT_OF_REGION;
    }
    case 'department':
      return 'Partner users may not view department reports';
    case 'user':
      return 'Partner users may not view individual reports';
  }
}

/**
 * Returns null if the caller is allowed to view the requested level;
 * returns a string reason if they are not (use to emit 403).
 */
export function denyReason(
  scope: Scope,
  requested: ReportRequest,
): string | null {
  if (scope.role === 'admin') return null;
  if (scope.role === 'monitor') return monitorDenyReason(scope, requested);

  switch (requested.level) {
    case 'national':
      return 'Staff users may not view the national report';
    case 'region':
      return scope.regionId === requested.regionId
        ? null
        : 'Staff users may not view reports for other regions';
    case 'district':
      return scope.districtId === requested.districtId
        ? null
        : 'Staff users may not view reports for other districts';
    case 'facility':
      return scope.facilityId === requested.facilityId
        ? null
        : 'Staff users may not view reports for other facilities';
    case 'department': {
      // Staff may view any department within their own facility.
      const [row] = query<{ facility_id: number | null }>(
        `SELECT fd.facility_id
         FROM facility_departments fd
         WHERE fd.department_id = ? AND fd.facility_id = ?
         LIMIT 1`,
        [requested.departmentId, scope.facilityId ?? 0],
      );
      return row ? null : 'Staff users may not view reports for other facilities';
    }
    case 'user':
      if (requested.targetUserId === scope.userId) return null;
      // NULL === NULL would otherwise let facility-less users see each other.
      if (scope.facilityId == null) return 'Staff users may only view reports for users in their facility';
      // Staff may view users within their own facility.
      const [u] = query<{ facility_id: number | null }>(
        'SELECT facility_id FROM users WHERE id = ?',
        [requested.targetUserId],
      );
      return u && u.facility_id === scope.facilityId
        ? null
        : 'Staff users may only view reports for users in their facility';
  }
}
