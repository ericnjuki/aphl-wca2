import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execute } from '../src/db/database';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { loadSetupSnapshot } from '../src/lib/workbook/setup-snapshot';
import { planOrgTabs, checkOrgRemovals, usersFromSnapshot, ORG_TABS } from '../src/lib/workbook/setup-org';
import { finalisePlan, ImportPlan, TabPlan } from '../src/lib/workbook/plan';
import {
  initTestDb, resetDb, buildWorkbook, SheetData, createRegion, createDistrict, createFacility, createDepartment,
  createUser, addResponse, assignRegions, createOrgRole,
} from './helpers';

async function planFor(sheets: SheetData): Promise<ImportPlan> {
  const parsed = await readSetupWorkbook(await buildWorkbook(sheets));
  const snap = loadSetupSnapshot();
  const org = planOrgTabs(parsed, snap);
  checkOrgRemovals(org, usersFromSnapshot(snap));
  return finalisePlan(ORG_TABS.map((t) => org[t].plan));
}
const tab = (plan: ImportPlan, name: string): TabPlan => plan.tabs.find((t) => t.tab === name) as TabPlan;

const REGIONS = ['region_code', 'region_name'];
const DISTRICTS = ['district_code', 'district_name', 'region_code'];
const DEPARTMENTS = ['department_code', 'department_name'];
const FACILITIES = ['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes'];
const ROLES = ['role_code', 'role_name'];

describe('country setup plan — organisation tabs', () => {
  let dsm: number, mwz: number, tmk: number, f1: number, lab: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    lab = createDepartment('LAB', 'Laboratory', [f1]);
    // F1, TMK, DSM and LAB have history; the respondent is disabled so they block nothing.
    const respondent = createUser({ facilityId: f1, departmentId: lab, enabled: false });
    addResponse({ userId: respondent, facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab });
  });

  it('snapshots codes in upper case with history flags, links and user codes', () => {
    const partner = createUser({ role: 'monitor' });
    assignRegions(partner, [mwz]);
    const snap = loadSetupSnapshot();
    expect(snap.facilities.find((f) => f.code === 'F1')).toMatchObject({
      districtCode: 'TMK', departmentCodes: ['LAB'], hasHistory: true, archived: false,
    });
    expect(snap.facilities.find((f) => f.code === 'F2')).toMatchObject({ hasHistory: false, departmentCodes: [] });
    expect(snap.districts[0]).toMatchObject({ code: 'TMK', regionCode: 'DSM', hasHistory: true });
    expect(snap.regions.find((r) => r.code === 'MWZ')).toMatchObject({ hasHistory: false });
    expect(snap.users.find((u) => u.role === 'monitor')).toMatchObject({ regionCodes: ['MWZ'], enabled: true });
    expect(snap.users.find((u) => u.facilityCode === 'F1')).toMatchObject({ departmentCode: 'LAB', enabled: false });
  });

  it('adds, updates and counts unchanged rows; absent tabs change nothing', async () => {
    const plan = await planFor({ Regions: [REGIONS, ['dsm', 'Dar es Salaam City'], ['MWZ', 'Mwanza'], ['ARU', 'Arusha']] });
    const regions = tab(plan, 'Regions');
    expect(regions.counts).toMatchObject({ added: 1, updated: 1, unchanged: 1, archived: 0, deleted: 0 });
    expect(regions.changes).toEqual([
      { row: 2, key: 'DSM', kind: 'update', fields: [{ field: 'region_name', from: 'Dar es Salaam', to: 'Dar es Salaam City' }] },
      { row: 4, key: 'ARU', kind: 'add', fields: [{ field: 'region_name', from: '', to: 'Arusha' }] },
    ]);
    expect(tab(plan, 'Districts')).toMatchObject({ present: false, changes: [], errors: [] });
    expect(plan.canApply).toBe(true);
  });

  it('archives removed rows with history, deletes those without, and warns above 50%', async () => {
    const plan = await planFor({ Facilities: [FACILITIES, ['F3', 'New Clinic', '', 'TMK', '']] });
    const facilities = tab(plan, 'Facilities');
    expect(facilities.changes).toEqual([
      {
        row: 2, key: 'F3', kind: 'add',
        fields: [{ field: 'facility_name', from: '', to: 'New Clinic' }, { field: 'district_code', from: '', to: 'TMK' }],
      },
      { row: null, key: 'F1', kind: 'archive' },
      { row: null, key: 'F2', kind: 'delete' },
    ]);
    expect(facilities.warnings).toEqual([
      '2 of 2 existing facilities would be archived or deleted — this usually means the wrong file.',
    ]);
    expect(plan.confirmations).toEqual({ archived: 1, deleted: 1, disabledUsers: 0 });
    expect(plan.canApply).toBe(true);
  });

  it('does not warn when at most half is removed', async () => {
    const regions = tab(await planFor({ Regions: [REGIONS, ['DSM', 'Dar es Salaam']] }), 'Regions');
    expect(regions.changes).toEqual([{ row: null, key: 'MWZ', kind: 'delete' }]);
    expect(regions.warnings).toEqual([]);
  });

  it('restores an archived entity whose code is back, and leaves archived ones that stay out alone', async () => {
    execute("UPDATE regions SET archived_at = datetime('now') WHERE id = ?", [mwz]);
    const back = await planFor({ Regions: [REGIONS, ['DSM', 'Dar es Salaam'], ['MWZ', 'Mwanza Region']] });
    expect(tab(back, 'Regions').changes).toEqual([
      { row: 3, key: 'MWZ', kind: 'restore', fields: [{ field: 'region_name', from: 'Mwanza', to: 'Mwanza Region' }] },
    ]);
    const out = await planFor({ Regions: [REGIONS, ['DSM', 'Dar es Salaam']] });
    expect(tab(out, 'Regions').changes).toEqual([]);
  });

  it('rejects references to codes that are not active in the workbook or the database', async () => {
    const plan = await planFor({
      Regions: [REGIONS, ['DSM', 'Dar es Salaam']],
      Districts: [DISTRICTS, ['TMK', 'Temeke', 'DSM'], ['NYA', 'Nyamagana', 'mwz']],
      Facilities: [FACILITIES, ['F1', 'Temeke Hospital', '', 'tmk', 'LAB;XRAY'], ['F2', 'Temeke Clinic', '', 'ZZZ', '']],
    });
    expect(tab(plan, 'Districts').errors).toEqual([
      { row: 3, column: 'region_code', message: 'region_code "MWZ" is not an active region in the Regions tab' },
    ]);
    expect(tab(plan, 'Facilities').errors).toEqual([
      {
        row: 2, column: 'department_codes',
        message: 'department_codes "XRAY" is not an active department in the database (no Departments tab in this workbook)',
      },
      { row: 3, column: 'district_code', message: 'district_code "ZZZ" is not an active district in the Districts tab' },
    ]);
    expect(plan.canApply).toBe(false);
  });

  it('blocks removing an entity still used by an unchanged active entity or an active user', async () => {
    const partner = createUser({ role: 'monitor' });
    assignRegions(partner, [mwz]);
    createUser({ facilityId: createFacility('F9', 'Busy Clinic', { regionId: dsm, districtId: tmk }) });
    const plan = await planFor({
      Regions: [REGIONS, ['ARU', 'Arusha']],
      Facilities: [FACILITIES, ['F1', 'Temeke Hospital', '', 'TMK', 'LAB'], ['F2', 'Temeke Clinic', '', 'TMK', '']],
    });
    expect(tab(plan, 'Regions').errors).toEqual([
      {
        row: 0, column: null,
        message: 'Region "DSM" would be archived, but district "TMK" still uses it — keep it in the workbook or remove those too',
      },
      {
        row: 0, column: null,
        message: expect.stringMatching(/^Region "MWZ" would be deleted, but user u\d+@example\.test still uses it/),
      },
    ]);
    expect(tab(plan, 'Facilities').errors).toEqual([
      {
        row: 0, column: null,
        message: expect.stringMatching(/^Facility "F9" would be deleted, but user u\d+@example\.test still uses it/),
      },
    ]);
    expect(plan.canApply).toBe(false);
  });

  it('rejects duplicate codes and department names', async () => {
    const plan = await planFor({
      Departments: [DEPARTMENTS, ['LAB', 'Laboratory'], ['lab', 'Lab again'], ['MIC', 'Laboratory']],
    });
    expect(tab(plan, 'Departments').errors).toEqual([
      { row: 3, column: 'department_code', message: 'Duplicate department_code "LAB" — first used on row 2' },
      { row: 4, column: 'department_name', message: 'department_name "Laboratory" is already used by department "LAB"' },
    ]);
  });

  it('archives an org role used by any user and deletes an unused one', async () => {
    createUser({ orgRoleId: createOrgRole('MLS', 'Scientist'), enabled: false });
    createOrgRole('TECH', 'Technician');
    const plan = await planFor({ 'Org Roles': [ROLES, ['DIR', 'Director']] });
    expect(tab(plan, 'Org Roles').changes).toEqual([
      { row: 2, key: 'DIR', kind: 'add', fields: [{ field: 'role_name', from: '', to: 'Director' }] },
      { row: null, key: 'MLS', kind: 'archive' },
      { row: null, key: 'TECH', kind: 'delete' },
    ]);
  });

  it('reports a tab with a missing required column and plans no changes for it', async () => {
    const plan = await planFor({ Regions: [['region_code'], ['DSM']] });
    expect(tab(plan, 'Regions')).toMatchObject({
      present: true,
      changes: [],
      errors: [{ row: 1, column: 'region_name', message: 'Missing required column "region_name"' }],
    });
  });

  it('fingerprints the change list deterministically', async () => {
    const a = await planFor({ Regions: [REGIONS, ['DSM', 'X'], ['MWZ', 'Mwanza']] });
    const b = await planFor({ Regions: [REGIONS, ['DSM', 'X'], ['MWZ', 'Mwanza']] });
    const c = await planFor({ Regions: [REGIONS, ['DSM', 'Y'], ['MWZ', 'Mwanza']] });
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});
