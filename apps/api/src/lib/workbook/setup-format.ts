// The country setup workbook (country-setup.xlsx): tab names, columns and
// allowed values. Spec: docs/superpowers/specs/2026-10-06-workbook-import-design.md §1.

import { loadWorkbook } from './xlsx';
import { ParsedTab, TabSpec, readTabs, req, opt } from './reader';

export const TAB = {
  regions: 'Regions',
  districts: 'Districts',
  departments: 'Departments',
  facilities: 'Facilities',
  orgRoles: 'Org Roles',
  titles: 'Job Titles',
  users: 'Users',
} as const;
export type SetupTabName = typeof TAB[keyof typeof TAB];

export const README_TAB = 'Read me';
export const USERNAME_COLUMN = 'username';

export const ID_TYPES = ['NRC', 'Passport', 'Other'] as const;
export const SYSTEM_ROLES = ['staff', 'admin', 'monitor'] as const;
export const STATUSES = ['active', 'disabled'] as const;

export const USERS_COLUMNS = [
  'email', 'first_name', 'last_name', 'national_id', 'id_type', 'system_role', 'facility_code',
  'department_code', 'org_role_code', 'title_code', 'region_codes', 'status',
];
const USERS_REQUIRED = new Set(['email', 'first_name', 'last_name', 'national_id', 'id_type']);

// `username` is deliberately not listed: it is written on export and ignored on import.
export const SETUP_TABS: TabSpec[] = [
  { name: TAB.regions, columns: [req('region_code'), req('region_name')] },
  { name: TAB.districts, columns: [req('district_code'), req('district_name'), req('region_code')] },
  { name: TAB.departments, columns: [req('department_code'), req('department_name')] },
  {
    name: TAB.facilities,
    columns: [req('facility_code'), req('facility_name'), opt('facility_type'), req('district_code'), opt('department_codes')],
  },
  { name: TAB.orgRoles, columns: [req('role_code'), req('role_name')] },
  { name: TAB.titles, columns: [req('title_code'), req('title_name')] },
  { name: TAB.users, columns: USERS_COLUMNS.map((c) => (USERS_REQUIRED.has(c) ? req(c) : opt(c))) },
];

export type ParsedSetup = Record<SetupTabName, ParsedTab | null>;

export async function readSetupWorkbook(buffer: Buffer): Promise<ParsedSetup> {
  return readTabs(await loadWorkbook(buffer), SETUP_TABS) as ParsedSetup;
}
