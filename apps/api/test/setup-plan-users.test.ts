import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execute } from '../src/db/database';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { loadSetupSnapshot } from '../src/lib/workbook/setup-snapshot';
import { planSetupImport } from '../src/lib/workbook/setup-planner';
import { ImportPlan, TabPlan } from '../src/lib/workbook/plan';
import {
  initTestDb, resetDb, buildWorkbook, SheetData, createRegion, createDistrict, createFacility, createDepartment,
  createUser, createOrgRole, createTitle, createCounty, createSubcounty, USERS_HEADER, userSheetRow,
} from './helpers';

async function planFor(sheets: SheetData, actor: number): Promise<ImportPlan> {
  const parsed = await readSetupWorkbook(await buildWorkbook(sheets));
  return planSetupImport(parsed, loadSetupSnapshot(), actor).plan;
}
const tab = (plan: ImportPlan, name: string): TabPlan => plan.tabs.find((t) => t.tab === name) as TabPlan;

const FACILITIES = ['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes'];

describe('country setup plan — users', () => {
  let admin: number, staff: number, dsm: number, tmk: number, f1: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin', email: 'boss@example.test' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1]);
    createDepartment('MIC', 'Microbiology'); // not offered at F1
    staff = createUser({
      email: 'Amina@Example.test', firstName: 'Amina', lastName: 'Hassan', nationalId: '123', idType: 'NRC',
      facilityId: f1, departmentId: lab,
    });
  });

  // Header, the importing admin unchanged, then the given rows (from row 3).
  const users = (...rows: string[][]): SheetData => ({ Users: [USERS_HEADER, userSheetRow(admin), ...rows] });

  it('adds new users, matches existing ones by email case-insensitively and ignores username', async () => {
    const plan = await planFor({
      Users: [
        [...USERS_HEADER, 'username'],
        [...userSheetRow(admin), 'whatever'],
        ['amina@example.test', 'Amina', 'Hassan-Juma', '123', 'nrc', '', 'f1', 'lab', '', '', '', '', '', 'hacker'],
        ['new@example.test', 'New', 'Person', '999', 'Passport', 'staff', 'F1', 'LAB', '', '', '', '', 'active', ''],
      ],
    }, admin);
    const u = tab(plan, 'Users');
    expect(u.errors).toEqual([]);
    expect(u.counts).toMatchObject({ added: 1, updated: 1, unchanged: 1, disabled: 0 });
    expect(u.changes).toEqual([
      { row: 3, key: 'Amina@Example.test', kind: 'update', fields: [{ field: 'last_name', from: 'Hassan', to: 'Hassan-Juma' }] },
      {
        row: 4, key: 'new@example.test', kind: 'add',
        fields: [
          { field: 'first_name', from: '', to: 'New' },
          { field: 'last_name', from: '', to: 'Person' },
          { field: 'national_id', from: '', to: '999' },
          { field: 'id_type', from: '', to: 'Passport' },
          { field: 'system_role', from: '', to: 'staff' },
          { field: 'facility_code', from: '', to: 'F1' },
          { field: 'department_code', from: '', to: 'LAB' },
          { field: 'status', from: '', to: 'active' },
        ],
      },
    ]);
    expect(plan.canApply).toBe(true);
  });

  it('disables enabled users missing from the tab, with a warning, and leaves disabled ones alone', async () => {
    createUser({ email: 'gone@example.test' });
    createUser({ email: 'old@example.test', enabled: false });
    const plan = await planFor(users(userSheetRow(staff)), admin);
    const u = tab(plan, 'Users');
    expect(u.changes).toEqual([{ row: null, key: 'gone@example.test', kind: 'disable' }]);
    expect(u.warnings).toEqual(['1 user is not in the Users tab and will be disabled.']);
    expect(plan.confirmations.disabledUsers).toBe(1);
    expect(plan.canApply).toBe(true);
  });

  it('re-enables a disabled user whose row has no status', async () => {
    const off = createUser({ email: 'off@example.test', enabled: false });
    const row = userSheetRow(off);
    row[12] = '';
    const u = tab(await planFor(users(userSheetRow(staff), row), admin), 'Users');
    expect(u.changes).toEqual([
      { row: 4, key: 'off@example.test', kind: 'update', fields: [{ field: 'status', from: 'disabled', to: 'active' }] },
    ]);
  });

  it('warns when more than half of the active users would be disabled', async () => {
    createUser(); createUser(); createUser();
    const u = tab(await planFor(users(), admin), 'Users');
    expect(u.warnings).toContain('4 of 5 active users would be disabled — this usually means the wrong file.');
  });

  it('rejects values outside the allowed sets but accepts an unchanged legacy id_type', async () => {
    // The admin row keeps its legacy id_type "NIN" and is accepted.
    const u = tab(await planFor(users(['a@x.test', 'A', 'A', '1', 'Licence', 'boss', '', '', '', '', '', '', 'gone']), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'id_type', message: 'id_type must be one of NRC, Passport, Other' },
      {
        row: 3, column: 'system_role',
        message: 'system_role must be one of staff, admin, national, county, subcounty, facility_admin',
      },
      { row: 3, column: 'status', message: 'status must be one of active, disabled' },
    ]);
  });

  it('accepts every role value, case-insensitively, and rejects the retired monitor role', async () => {
    const u = tab(await planFor(users(
      ['n@x.test', 'N', 'N', 'n1', 'NRC', 'National', '', '', '', '', '', '', ''],
      ['c@x.test', 'C', 'C', 'c1', 'NRC', 'COUNTY', '', '', '', '', 'dsm', '', ''],
      ['s@x.test', 'S', 'S', 's1', 'NRC', 'subcounty', '', '', '', '', '', 'tmk', ''],
      ['f@x.test', 'F', 'F', 'f1', 'NRC', 'facility_admin', 'F1', '', '', '', '', '', ''],
      ['m@x.test', 'M', 'M', 'm1', 'NRC', 'monitor', '', '', '', '', 'DSM', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([{
      row: 7, column: 'system_role',
      message: 'system_role must be one of staff, admin, national, county, subcounty, facility_admin',
    }]);
    const adds = u.changes.filter((c) => c.kind === 'add');
    expect(adds.map((c) => c.fields?.find((f) => f.field === 'system_role')?.to)).toEqual(
      ['national', 'county', 'subcounty', 'facility_admin'],
    );
    expect(adds[1].fields).toContainEqual({ field: 'region_codes', from: '', to: 'DSM' });
    expect(adds[2].fields).toContainEqual({ field: 'district_codes', from: '', to: 'TMK' });
  });

  it('enforces coordinator placement: one region for county, one district for subcounty', async () => {
    createRegion('ARU', 'Arusha');
    const u = tab(await planFor(users(
      ['c1@x.test', 'C', 'One', 'c1', 'NRC', 'county', '', '', '', '', '', '', ''],
      ['c2@x.test', 'C', 'Two', 'c2', 'NRC', 'county', '', '', '', '', 'DSM;ARU', '', ''],
      ['c3@x.test', 'C', 'Three', 'c3', 'NRC', 'county', '', '', '', '', 'ZZZ', '', ''],
      ['s1@x.test', 'S', 'One', 's1', 'NRC', 'staff', '', '', '', '', 'DSM', '', ''],
      ['sc1@x.test', 'S', 'C1', 'sc1', 'NRC', 'subcounty', '', '', '', '', '', '', ''],
      ['sc2@x.test', 'S', 'C2', 'sc2', 'NRC', 'subcounty', '', '', '', '', 'DSM', 'TMK', ''],
      ['sc3@x.test', 'S', 'C3', 'sc3', 'NRC', 'subcounty', '', '', '', '', '', 'NOPE', ''],
      ['s2@x.test', 'S', 'Two', 's2', 'NRC', 'staff', '', '', '', '', '', 'TMK', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'region_codes', message: 'A county user needs exactly one region code in region_codes' },
      { row: 4, column: 'region_codes', message: 'A county user needs exactly one region code in region_codes' },
      {
        row: 5, column: 'region_codes',
        message: 'region_codes "ZZZ" is not an active region in the database (no Regions tab in this workbook)',
      },
      { row: 6, column: 'region_codes', message: 'Only county users can have region_codes' },
      { row: 7, column: 'district_codes', message: 'A subcounty user needs exactly one district code in district_codes' },
      { row: 8, column: 'region_codes', message: 'Only county users can have region_codes' },
      {
        row: 9, column: 'district_codes',
        message: 'district_codes "NOPE" is not an active district in the database (no Districts tab in this workbook)',
      },
      { row: 10, column: 'district_codes', message: 'Only subcounty users can have district_codes' },
    ]);
  });

  it('keeps national and coordinator users off facilities, and needs a facility for facility_admin', async () => {
    const u = tab(await planFor(users(
      ['n1@x.test', 'N', 'One', 'n1', 'NRC', 'national', 'F1', '', '', '', '', '', ''],
      ['c1@x.test', 'C', 'One', 'c1', 'NRC', 'county', 'F1', 'LAB', '', '', 'DSM', '', ''],
      ['sc1@x.test', 'S', 'C1', 'sc1', 'NRC', 'subcounty', 'F1', '', '', '', '', 'TMK', ''],
      ['fa1@x.test', 'F', 'One', 'fa1', 'NRC', 'facility_admin', '', '', '', '', '', '', ''],
    ), admin), 'Users');
    const offFacility = 'National, county and subcounty users cannot have a facility, department, org role or title';
    expect(u.errors).toEqual([
      { row: 3, column: null, message: offFacility },
      { row: 4, column: null, message: offFacility },
      { row: 5, column: null, message: offFacility },
      { row: 6, column: 'facility_code', message: 'A facility_admin user needs a facility_code' },
    ]);
  });

  it('checks references and that the department belongs to the facility', async () => {
    createFacility('F9', 'Old Clinic', { regionId: dsm, districtId: tmk });
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE code = 'F9'");
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', 'a1', 'NRC', 'staff', 'F1', 'MIC', '', '', '', '', ''],
      ['b@x.test', 'B', 'B', 'b1', 'NRC', 'staff', '', 'LAB', '', '', '', '', ''],
      ['c@x.test', 'C', 'C', 'c1', 'NRC', 'staff', 'F9', '', '', '', '', '', ''],
      ['d@x.test', 'D', 'D', 'd1', 'NRC', 'staff', 'F9', '', '', '', '', '', 'disabled'],
      ['e@x.test', 'E', 'E', 'e1', 'NRC', 'staff', 'F1', '', 'NOPE', '', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'department_code', message: 'Department "MIC" is not one of facility "F1"\'s departments' },
      { row: 4, column: 'department_code', message: 'department_code needs a facility_code' },
      {
        row: 5, column: 'facility_code',
        message: 'facility_code "F9" is not an active facility in the database (no Facilities tab in this workbook)',
      },
      {
        row: 7, column: 'org_role_code',
        message: 'org_role_code "NOPE" is not an active org role in the database (no Org Roles tab in this workbook)',
      },
    ]);
  });

  it('keeps national_id + id_type unique, including against users outside the workbook', async () => {
    createUser({ email: 'keep@example.test', nationalId: '555', idType: 'NRC', enabled: false });
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', '777', 'NRC', '', '', '', '', '', '', '', ''],
      ['b@x.test', 'B', 'B', '777', 'nrc', '', '', '', '', '', '', '', ''],
      ['c@x.test', 'C', 'C', '555', 'NRC', '', '', '', '', '', '', '', ''],
      ['d@x.test', 'D', 'D', '777', 'Passport', '', '', '', '', '', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 4, column: 'national_id', message: 'national_id "777" with id_type "NRC" is already used by row 3 (a@x.test)' },
      { row: 5, column: 'national_id', message: 'national_id "555" with id_type "NRC" is already used by existing user keep@example.test' },
    ]);
  });

  it('rejects duplicate emails', async () => {
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', 'a1', 'NRC', '', '', '', '', '', '', '', ''],
      ['A@X.test', 'A', 'B', 'a2', 'NRC', '', '', '', '', '', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([{ row: 4, column: 'email', message: 'Duplicate email "A@X.test" — first used on row 3' }]);
  });

  it('will not disable, drop or demote the importing admin', async () => {
    const missing = tab(await planFor({ Users: [USERS_HEADER, userSheetRow(staff)] }, admin), 'Users');
    expect(missing.errors).toContainEqual({
      row: 0, column: 'email',
      message: 'Your own account (boss@example.test) is not in the Users tab — the import would disable you',
    });

    const demotedRow = userSheetRow(admin);
    demotedRow[5] = 'staff';
    const demoted = tab(await planFor({ Users: [USERS_HEADER, demotedRow] }, admin), 'Users');
    expect(demoted.errors).toContainEqual({ row: 2, column: 'system_role', message: 'You cannot remove your own admin role' });

    const disabledRow = userSheetRow(admin);
    disabledRow[12] = 'disabled';
    const disabled = tab(await planFor({ Users: [USERS_HEADER, disabledRow] }, admin), 'Users');
    expect(disabled.errors).toContainEqual({ row: 2, column: 'status', message: 'You cannot disable your own account' });
  });

  it('must leave at least one active admin', async () => {
    const u = tab(await planFor({ Users: [USERS_HEADER, userSheetRow(staff)] }, 999999), 'Users');
    expect(u.errors).toContainEqual({ row: 0, column: 'system_role', message: 'The import must leave at least one active admin' });
  });

  it('lets the Users tab decide whether a removed facility is still in use', async () => {
    const sheets = { Facilities: [FACILITIES, ['F2', 'New Clinic', '', 'TMK', '']] };
    // Without a Users tab, Amina (active, at F1) blocks removing F1.
    const blocked = await planFor(sheets, admin);
    expect(tab(blocked, 'Facilities').errors).toEqual([{
      row: 0, column: null,
      message: 'Facility "F1" would be deleted, but user Amina@Example.test still uses it — keep it in the workbook or remove those too',
    }]);
    // With a Users tab that leaves Amina out she is disabled, so F1 can go.
    const allowed = await planFor({ ...sheets, ...users() }, admin);
    expect(allowed.canApply).toBe(true);
    expect(tab(allowed, 'Users').changes).toEqual([{ row: null, key: 'Amina@Example.test', kind: 'disable' }]);
  });

  it('returns the operations apply needs', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook(users(
      ['new@example.test', 'New', 'Person', '999', 'Passport', '', '', '', '', '', '', '', ''],
    )));
    const { ops } = planSetupImport(parsed, loadSetupSnapshot(), admin);
    expect(ops.users).toEqual([
      {
        kind: 'add', id: null,
        values: {
          email: 'new@example.test', first_name: 'New', last_name: 'Person', national_id: '999', id_type: 'Passport',
          system_role: 'staff', status: 'active', facility_code: '', department_code: '', org_role_code: '', title_code: '',
          region_codes: '', district_codes: '',
        },
      },
      expect.objectContaining({ kind: 'disable', id: staff }),
    ]);
  });
  it('plans enabled-to-disabled via status as a disable and counts it', async () => {
    const other = createUser({ email: 'other@example.test' });
    const row = userSheetRow(other);
    row[12] = 'disabled';
    const plan = await planFor(users(userSheetRow(staff), row), admin);
    const u = tab(plan, 'Users');
    expect(u.changes).toEqual([
      { row: 4, key: 'other@example.test', kind: 'disable', fields: [{ field: 'status', from: 'active', to: 'disabled' }] },
    ]);
    expect(u.counts).toMatchObject({ disabled: 1, updated: 0 });
    expect(plan.confirmations.disabledUsers).toBe(1);
    expect(u.warnings).toEqual([]);
  });

  it('warns when more than half of the users are disabled via status', async () => {
    const a = createUser(), b = createUser();
    const rowA = userSheetRow(a), rowB = userSheetRow(b);
    const rowS = userSheetRow(staff);
    rowA[12] = 'disabled'; rowB[12] = 'disabled'; rowS[12] = 'disabled';
    const u = tab(await planFor(users(rowS, rowA, rowB), admin), 'Users');
    expect(u.warnings).toContain('3 of 4 active users would be disabled — this usually means the wrong file.');
  });

  it('does not warn when exactly half of the users are disabled', async () => {
    const u = tab(await planFor(users(), admin), 'Users'); // staff absent: 1 of 2
    expect(u.changes).toHaveLength(1);
    expect(u.warnings.some((w) => w.includes('wrong file'))).toBe(false);
  });

  it('blocks apply on errors, orders the tabs and fingerprints deterministically', async () => {
    const bad = await planFor(users(['a@x.test', 'A', 'A', '1', 'Licence', '', '', '', '', '', '', '', '']), admin);
    expect(bad.canApply).toBe(false);
    expect(bad.tabs.map((t) => t.tab)).toEqual([
      'Regions', 'Districts', 'Departments', 'Facilities', 'Org Roles', 'Job Titles', 'Users',
    ]);
    const row = ['n@x.test', 'N', 'P', '9', 'NRC', '', '', '', '', '', '', '', ''];
    const one = await planFor(users(row), admin);
    const two = await planFor(users(row), admin);
    const changed = await planFor(users(['n@x.test', 'N', 'Q', '9', 'NRC', '', '', '', '', '', '', '', '']), admin);
    expect(two.fingerprint).toBe(one.fingerprint);
    expect(changed.fingerprint).not.toBe(one.fingerprint);
  });

  it('rejects a legacy id_type changed to a different unlisted value', async () => {
    const row = userSheetRow(admin);
    row[4] = 'Voter card';
    const u = tab(await planFor({ Users: [USERS_HEADER, row] }, admin), 'Users');
    expect(u.errors).toContainEqual({ row: 2, column: 'id_type', message: 'id_type must be one of NRC, Passport, Other' });
  });

  it('keeps coordinators free of org role and title, and leaves valid coordinators unchanged', async () => {
    createOrgRole('SUP', 'Supervisor');
    createTitle('MT', 'Med Tech');
    const bad = tab(await planFor(users(
      ['c1@x.test', 'C', 'One', 'c1', 'NRC', 'county', '', '', 'SUP', '', 'DSM', '', ''],
      ['s1@x.test', 'S', 'One', 's1', 'NRC', 'subcounty', '', '', '', 'MT', '', 'TMK', ''],
    ), admin), 'Users');
    const offFacility = 'National, county and subcounty users cannot have a facility, department, org role or title';
    expect(bad.errors).toEqual([
      { row: 3, column: null, message: offFacility },
      { row: 4, column: null, message: offFacility },
    ]);

    const county = createCounty(dsm);
    const sub = createSubcounty(tmk);
    const national = createUser({ role: 'national' });
    const fa = createUser({ role: 'facility_admin', facilityId: f1 });
    const ok = tab(await planFor(users(
      userSheetRow(staff), userSheetRow(county), userSheetRow(sub), userSheetRow(national), userSheetRow(fa),
    ), admin), 'Users');
    expect(ok.errors).toEqual([]);
    expect(ok.changes).toEqual([]);
    expect(ok.counts.unchanged).toBe(6);
  });

  it('moves a subcounty coordinator to another district and clears it when they become staff', async () => {
    createDistrict('KIN', 'Kinondoni', dsm);
    const sub = createSubcounty(tmk);
    const moved = userSheetRow(sub);
    moved[11] = 'KIN';
    const u = tab(await planFor(users(userSheetRow(staff), moved), admin), 'Users');
    expect(u.changes).toEqual([{
      row: 4, key: expect.any(String), kind: 'update', fields: [{ field: 'district_codes', from: 'TMK', to: 'KIN' }],
    }]);

    const demoted = userSheetRow(sub);
    demoted[5] = 'staff'; demoted[11] = '';
    const d = tab(await planFor(users(userSheetRow(staff), demoted), admin), 'Users');
    expect(d.errors).toEqual([]);
    expect(d.changes[0].fields).toEqual([
      { field: 'system_role', from: 'subcounty', to: 'staff' },
      { field: 'district_codes', from: 'TMK', to: '' },
    ]);
  });

  it('matches an email differing only in case from an existing user instead of adding it', async () => {
    const u = tab(await planFor(users(['AMINA@EXAMPLE.TEST', 'Amina', 'Hassan', '123', 'NRC', '', 'F1', 'LAB', '', '', '', '', '']), admin), 'Users');
    expect(u.counts.added).toBe(0);
    expect(u.errors).toEqual([]);
  });

  it('returns an update op keeping the database spelling of the email', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook(users(
      ['AMINA@example.test', 'Amina', 'Hassan-Juma', '123', 'NRC', '', 'F1', 'LAB', '', '', '', '', ''],
    )));
    const { ops } = planSetupImport(parsed, loadSetupSnapshot(), admin);
    expect(ops.users).toEqual([
      expect.objectContaining({ kind: 'update', id: staff, values: expect.objectContaining({ email: 'Amina@Example.test', last_name: 'Hassan-Juma' }) }),
    ]);
  });
});
