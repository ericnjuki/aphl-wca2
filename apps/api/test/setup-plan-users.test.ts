import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execute } from '../src/db/database';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { loadSetupSnapshot } from '../src/lib/workbook/setup-snapshot';
import { planSetupImport } from '../src/lib/workbook/setup-planner';
import { ImportPlan, TabPlan } from '../src/lib/workbook/plan';
import {
  initTestDb, resetDb, buildWorkbook, SheetData, createRegion, createDistrict, createFacility, createDepartment,
  createUser, USERS_HEADER, userSheetRow,
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
        ['amina@example.test', 'Amina', 'Hassan-Juma', '123', 'nrc', '', 'f1', 'lab', '', '', '', '', 'hacker'],
        ['new@example.test', 'New', 'Person', '999', 'Passport', 'staff', 'F1', 'LAB', '', '', '', 'active', ''],
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
    row[11] = '';
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
    const u = tab(await planFor(users(['a@x.test', 'A', 'A', '1', 'Licence', 'boss', '', '', '', '', '', 'gone']), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'id_type', message: 'id_type must be one of NRC, Passport, Other' },
      { row: 3, column: 'system_role', message: 'system_role must be one of staff, admin, monitor' },
      { row: 3, column: 'status', message: 'status must be one of active, disabled' },
    ]);
  });

  it('enforces partner (monitor) placement rules', async () => {
    const u = tab(await planFor(users(
      ['m1@x.test', 'M', 'One', 'm1', 'NRC', 'monitor', '', '', '', '', '', ''],
      ['m2@x.test', 'M', 'Two', 'm2', 'NRC', 'monitor', 'F1', '', '', '', 'DSM', ''],
      ['s1@x.test', 'S', 'One', 's1', 'NRC', 'staff', '', '', '', '', 'DSM', ''],
      ['m3@x.test', 'M', 'Three', 'm3', 'NRC', 'monitor', '', '', '', '', 'dsm;ZZZ', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'region_codes', message: 'A partner (monitor) user needs at least one region in region_codes' },
      { row: 4, column: null, message: 'Partner (monitor) users cannot have a facility, department, org role or title' },
      { row: 5, column: 'region_codes', message: 'Only partner (monitor) users can have region_codes' },
      {
        row: 6, column: 'region_codes',
        message: 'region_codes "ZZZ" is not an active region in the database (no Regions tab in this workbook)',
      },
    ]);
  });

  it('checks references and that the department belongs to the facility', async () => {
    createFacility('F9', 'Old Clinic', { regionId: dsm, districtId: tmk });
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE code = 'F9'");
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', 'a1', 'NRC', 'staff', 'F1', 'MIC', '', '', '', ''],
      ['b@x.test', 'B', 'B', 'b1', 'NRC', 'staff', '', 'LAB', '', '', '', ''],
      ['c@x.test', 'C', 'C', 'c1', 'NRC', 'staff', 'F9', '', '', '', '', ''],
      ['d@x.test', 'D', 'D', 'd1', 'NRC', 'staff', 'F9', '', '', '', '', 'disabled'],
      ['e@x.test', 'E', 'E', 'e1', 'NRC', 'staff', 'F1', '', 'NOPE', '', '', ''],
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
      ['a@x.test', 'A', 'A', '777', 'NRC', '', '', '', '', '', '', ''],
      ['b@x.test', 'B', 'B', '777', 'nrc', '', '', '', '', '', '', ''],
      ['c@x.test', 'C', 'C', '555', 'NRC', '', '', '', '', '', '', ''],
      ['d@x.test', 'D', 'D', '777', 'Passport', '', '', '', '', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 4, column: 'national_id', message: 'national_id "777" with id_type "NRC" is already used by row 3 (a@x.test)' },
      { row: 5, column: 'national_id', message: 'national_id "555" with id_type "NRC" is already used by existing user keep@example.test' },
    ]);
  });

  it('rejects duplicate emails', async () => {
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', 'a1', 'NRC', '', '', '', '', '', '', ''],
      ['A@X.test', 'A', 'B', 'a2', 'NRC', '', '', '', '', '', '', ''],
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
    disabledRow[11] = 'disabled';
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
      ['new@example.test', 'New', 'Person', '999', 'Passport', '', '', '', '', '', '', ''],
    )));
    const { ops } = planSetupImport(parsed, loadSetupSnapshot(), admin);
    expect(ops.users).toEqual([
      {
        kind: 'add', id: null,
        values: {
          email: 'new@example.test', first_name: 'New', last_name: 'Person', national_id: '999', id_type: 'Passport',
          system_role: 'staff', status: 'active', facility_code: '', department_code: '', org_role_code: '', title_code: '',
          region_codes: '',
        },
      },
      expect.objectContaining({ kind: 'disable', id: staff }),
    ]);
  });
});
