// Access-control scoping for report endpoints.
//
// Policy:
//   - admin   → unrestricted.
//   - staff   → may only view reports covering their own facility / department.
//               Requests for national or a different facility/region return 403.
//               Their own individual report is always allowed.

import { query } from '../db/database';

export interface Scope {
  role: 'staff' | 'admin';
  userId: number;
  facilityId: number | null;
  departmentId: number | null;
  regionId: number | null;
}

export function getScope(userId: number): Scope {
  const [row] = query<{
    role: 'staff' | 'admin';
    facility_id: number | null;
    department_id: number | null;
    region_id: number | null;
  }>(
    `SELECT u.role, u.facility_id, u.department_id, f.region_id
     FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
     WHERE u.id = ?`,
    [userId],
  );
  return {
    role: row?.role ?? 'staff',
    userId,
    facilityId: row?.facility_id ?? null,
    departmentId: row?.department_id ?? null,
    regionId: row?.region_id ?? null,
  };
}

/**
 * Returns null if the caller is allowed to view the requested level;
 * returns a string reason if they are not (use to emit 403).
 */
export function denyReason(
  scope: Scope,
  requested:
    | { level: 'national' }
    | { level: 'region'; regionId: number }
    | { level: 'facility'; facilityId: number }
    | { level: 'department'; departmentId: number }
    | { level: 'user'; targetUserId: number },
): string | null {
  if (scope.role === 'admin') return null;

  switch (requested.level) {
    case 'national':
      return 'Staff users may not view the national report';
    case 'region':
      return scope.regionId === requested.regionId
        ? null
        : 'Staff users may not view reports for other regions';
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
