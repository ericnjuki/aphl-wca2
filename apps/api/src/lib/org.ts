// Organisational-hierarchy helpers shared by admin routes, survey completion,
// the startup backfill and report scoping.
//
// Hierarchy: Region → District → Facility → Department. facilities.region_id is
// a copy of districts.region_id maintained here (foreign keys are not enforced
// in this database, so these rules live in code).

import { query, execute } from '../db/database';

export interface OrgContext {
  facility_id: number | null;
  department_id: number | null;
  region_id: number | null;
  district_id: number | null;
}

/** The user's current org placement — snapshotted onto response rows. */
export function getOrgContext(userId: number): OrgContext | undefined {
  const [row] = query<OrgContext & Record<string, unknown>>(
    `SELECT u.facility_id, u.department_id, f.region_id, f.district_id
     FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
     WHERE u.id = ?`,
    [userId],
  );
  return row;
}

/** Look up a district by id (number or numeric string). Null if absent/unknown. */
export function resolveDistrict(raw: unknown): { id: number; region_id: number } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  const [row] = query<{ id: number; region_id: number }>(
    'SELECT id, region_id FROM districts WHERE id = ?',
    [id],
  );
  return row ?? null;
}

/** Invariant 2: facilities follow their district when it moves region. */
export function syncFacilitiesRegion(districtId: number, regionId: number): void {
  execute(
    `UPDATE facilities SET region_id = ?, updated_at = datetime('now') WHERE district_id = ?`,
    [regionId, districtId],
  );
}

/**
 * Attribute a facility's pre-district responses to its (new) district.
 * Only NULLs are filled — an existing snapshot is history and never rewritten,
 * including a `region_id` the row already has (even if it disagrees with the
 * district's own region — that mismatch is what makes it a legacy snapshot).
 */
export function backfillResponseDistrict(facilityId: number, districtId: number): void {
  const [district] = query<{ region_id: number }>('SELECT region_id FROM districts WHERE id = ?', [districtId]);
  execute(
    `UPDATE user_assessment_responses
     SET district_id = ?, region_id = COALESCE(region_id, ?)
     WHERE facility_id = ? AND district_id IS NULL`,
    [districtId, district?.region_id ?? null, facilityId],
  );
}
