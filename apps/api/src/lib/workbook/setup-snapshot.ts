// The current organisation + user data, in the workbook's terms (codes rather
// than ids), for planning and exporting the country setup workbook.

import { query } from '../../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapEntity { id: number; code: string; name: string; archived: boolean; hasHistory: boolean }
export interface SnapDistrict extends SnapEntity { regionCode: string }
export interface SnapFacility extends SnapEntity { facilityType: string; districtCode: string; departmentCodes: string[] }
export interface SnapUser {
  id: number; email: string; userName: string; firstName: string; lastName: string;
  nationalId: string; idType: string; role: string; enabled: boolean;
  facilityCode: string; departmentCode: string; orgRoleCode: string; titleCode: string; regionCodes: string[];
}
export interface SetupSnapshot {
  regions: SnapEntity[];
  districts: SnapDistrict[];
  departments: SnapEntity[];
  facilities: SnapFacility[];
  orgRoles: SnapEntity[];
  titles: SnapEntity[];
  users: SnapUser[];
}

const up = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim().toUpperCase());
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

// ── Loading ───────────────────────────────────────────────────────────────────

// History = referenced by a response (regions … departments) or by any user,
// enabled or not (org roles, titles). An entity with history is archived, not
// deleted, when the workbook drops it.
export const responseHistory = (col: string) => `EXISTS (SELECT 1 FROM user_assessment_responses x WHERE x.${col} = t.id)`;
export const userHistory = (col: string) => `EXISTS (SELECT 1 FROM users x WHERE x.${col} = t.id)`;

function entities(table: string, historySql: string): SnapEntity[] {
  return query<{ id: number; code: string; name: string; archived_at: string | null; has_history: number }>(
    `SELECT t.id, t.code, t.name, t.archived_at, (${historySql}) AS has_history FROM ${table} t ORDER BY t.code`,
  ).map((r) => ({
    id: r.id, code: up(r.code), name: txt(r.name), archived: r.archived_at !== null, hasHistory: Number(r.has_history) > 0,
  }));
}

function groupCodes(rows: { owner: number; code: string }[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of rows) out.set(r.owner, [...(out.get(r.owner) ?? []), up(r.code)]);
  for (const [k, v] of out) out.set(k, [...new Set(v)].sort());
  return out;
}

export function loadSetupSnapshot(): SetupSnapshot {
  const regions = entities('regions', responseHistory('region_id'));
  const departments = entities('departments', responseHistory('department_id'));
  const orgRoles = entities('org_roles', userHistory('org_role_id'));
  const titles = entities('user_titles', userHistory('title_id'));

  const districtRegion = new Map(
    query<{ id: number; region_code: string | null }>(
      'SELECT d.id, r.code AS region_code FROM districts d LEFT JOIN regions r ON r.id = d.region_id',
    ).map((r) => [r.id, up(r.region_code)]),
  );
  const districts = entities('districts', responseHistory('district_id'))
    .map((e) => ({ ...e, regionCode: districtRegion.get(e.id) ?? '' }));

  const facilityInfo = new Map(
    query<{ id: number; facility_type: string | null; district_code: string | null }>(
      'SELECT f.id, f.facility_type, d.code AS district_code FROM facilities f LEFT JOIN districts d ON d.id = f.district_id',
    ).map((r) => [r.id, r]),
  );
  const facilityDepts = groupCodes(query<{ owner: number; code: string }>(
    `SELECT fd.facility_id AS owner, dp.code
     FROM facility_departments fd JOIN departments dp ON dp.id = fd.department_id`,
  ));
  const facilities = entities('facilities', responseHistory('facility_id')).map((e) => ({
    ...e,
    facilityType: txt(facilityInfo.get(e.id)?.facility_type),
    districtCode: up(facilityInfo.get(e.id)?.district_code),
    departmentCodes: facilityDepts.get(e.id) ?? [],
  }));

  const userRegions = groupCodes(query<{ owner: number; code: string }>(
    'SELECT ur.user_id AS owner, rg.code FROM user_regions ur JOIN regions rg ON rg.id = ur.region_id',
  ));
  const users = query<{
    id: number; email: string; user_name: string; first_name: string; last_name: string;
    national_id: string; id_type: string; role: string; is_enabled: number;
    facility_code: string | null; department_code: string | null; org_role_code: string | null; title_code: string | null;
  }>(
    `SELECT u.id, u.email, u.user_name, u.first_name, u.last_name, u.national_id, u.id_type, u.role, u.is_enabled,
            f.code AS facility_code, d.code AS department_code, r.code AS org_role_code, t.code AS title_code
     FROM users u
     LEFT JOIN facilities  f ON f.id = u.facility_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN org_roles   r ON r.id = u.org_role_id
     LEFT JOIN user_titles t ON t.id = u.title_id
     ORDER BY u.last_name, u.first_name, u.id`,
  ).map((u) => ({
    id: u.id,
    email: txt(u.email),
    userName: txt(u.user_name),
    firstName: txt(u.first_name),
    lastName: txt(u.last_name),
    nationalId: txt(u.national_id),
    idType: txt(u.id_type),
    role: txt(u.role),
    enabled: Boolean(u.is_enabled),
    facilityCode: up(u.facility_code),
    departmentCode: up(u.department_code),
    orgRoleCode: up(u.org_role_code),
    titleCode: up(u.title_code),
    regionCodes: userRegions.get(u.id) ?? [],
  }));

  return { regions, districts, departments, facilities, orgRoles, titles, users };
}
