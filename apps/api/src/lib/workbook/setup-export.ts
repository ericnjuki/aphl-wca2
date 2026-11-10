// "Export setup": the current active organisation data and all users in the
// import format. On a system without organisation data this is the template.

import * as ExcelJS from 'exceljs';
import { TabSpec } from './reader';
import { SETUP_TABS, TAB, USERNAME_COLUMN, ID_TYPES, SYSTEM_ROLES, STATUSES } from './setup-format';
import { SetupSnapshot } from './setup-snapshot';
import { workbookToBuffer } from './xlsx';
import { writeReadme, writeTab, appVersion } from './writer';

function spec(name: string): TabSpec {
  const found = SETUP_TABS.find((t) => t.name === name);
  if (!found) throw new Error(`Unknown setup tab ${name}`);
  return found;
}

const README: [string, string][] = [
  ['How to use', 'One row per item on each tab. Shaded column headers are required; leave optional cells empty.'],
  ['Matching', 'Rows are matched by code (email for users), ignoring upper/lower case. To rename something, keep its code and change the name. Changing a code removes the old item and adds a new one.'],
  ['Full sync', 'Every tab you include is the complete list. Items missing from a tab are archived (if they have history) or deleted; users missing from Users are disabled. Delete a whole tab to leave that kind of data unchanged.'],
  ['Your account', 'Keep your own admin account on the Users tab — the import will not disable or demote you.'],
  ['Lists', 'department_codes and region_codes take several codes separated by ";".'],
  ['Allowed values', 'id_type: NRC, Passport, Other · system_role: staff, admin, monitor (default staff) · status: active, disabled (default active).'],
  ['Partners', 'monitor users need region_codes and no facility, department, org role or title. Other users must not have region_codes.'],
  ['Departments', "A user's department_code must be one of their facility's department_codes."],
  ['username', 'Shown for reference and ignored on import. New users get a generated username and temporary password, shown once after the import.'],
];

export async function writeSetupWorkbook(snap: SetupSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  writeReadme(wb, 'Country setup workbook', [
    ...README,
    ['Exported', new Date().toISOString()],
    ['App version', appVersion()],
  ]);
  const active = <T extends { archived: boolean }>(rows: T[]) => rows.filter((r) => !r.archived);
  writeTab(wb, spec(TAB.regions), active(snap.regions).map((r) => [r.code, r.name]));
  writeTab(wb, spec(TAB.districts), active(snap.districts).map((d) => [d.code, d.name, d.regionCode]));
  writeTab(wb, spec(TAB.departments), active(snap.departments).map((d) => [d.code, d.name]));
  writeTab(wb, spec(TAB.facilities), active(snap.facilities).map((f) => [
    f.code, f.name, f.facilityType, f.districtCode, f.departmentCodes.join(';'),
  ]));
  writeTab(wb, spec(TAB.orgRoles), active(snap.orgRoles).map((r) => [r.code, r.name]));
  writeTab(wb, spec(TAB.titles), active(snap.titles).map((t) => [t.code, t.name]));
  writeTab(
    wb,
    spec(TAB.users),
    snap.users.map((u) => [
      u.email, u.firstName, u.lastName, u.nationalId, u.idType, u.role, u.facilityCode, u.departmentCode,
      u.orgRoleCode, u.titleCode, u.regionCodes.join(';'), u.enabled ? 'active' : 'disabled', u.userName,
    ]),
    { readOnly: [USERNAME_COLUMN], lists: { id_type: ID_TYPES, system_role: SYSTEM_ROLES, status: STATUSES } },
  );
  return workbookToBuffer(wb);
}
