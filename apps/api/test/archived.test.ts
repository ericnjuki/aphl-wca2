import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  createOrgRole, createTitle, addResponse,
} from './helpers';

const app = testApp();
const archive = (table: string, id: number) =>
  execute(`UPDATE ${table} SET archived_at = datetime('now') WHERE id = ?`, [id]);

describe('archived organisation rows', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
  });
  const get = (path: string) => request(app).get(path).set(asUser(admin));

  it('hides archived rows from admin lists unless include_archived=1', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    archive('regions', createRegion('OLD', 'Old Region'));
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    archive('districts', createDistrict('OLDD', 'Old District', dsm));
    createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    archive('facilities', createFacility('F9', 'Closed Clinic', { regionId: dsm, districtId: tmk }));
    createDepartment('LAB', 'Laboratory');
    archive('departments', createDepartment('OLDP', 'Old Department'));
    createOrgRole('MLS', 'Scientist');
    archive('org_roles', createOrgRole('OLDR', 'Old Role'));
    createTitle('DR', 'Dr.');
    archive('user_titles', createTitle('OLDT', 'Old Title'));

    const cases: [string, string, string, string][] = [
      ['/admin/regions', 'regions', 'DSM', 'OLD'],
      ['/admin/districts', 'districts', 'TMK', 'OLDD'],
      ['/admin/facilities', 'facilities', 'F1', 'F9'],
      ['/admin/departments', 'departments', 'LAB', 'OLDP'],
      ['/admin/org-roles', 'org_roles', 'MLS', 'OLDR'],
      ['/admin/user-titles', 'user_titles', 'DR', 'OLDT'],
    ];
    for (const [path, key, active, archived] of cases) {
      const codes = async (url: string) => ((await get(url)).body[key] as { code: string }[]).map((r) => r.code).sort();
      expect(await codes(path)).toEqual([active]);
      expect(await codes(`${path}?include_archived=1`)).toEqual([active, archived].sort());
    }
    // Facility counts on districts ignore archived facilities.
    expect((await get('/admin/districts')).body.districts[0].facility_count).toBe(1);
  });

  it('lists an archived report child only when it has respondents, flagged archived', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const oldRegion = createRegion('OLDR', 'Old Region');
    const emptyRegion = createRegion('EMPR', 'Empty Region');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const oldDistrict = createDistrict('OLDD', 'Old District', dsm);
    const emptyDistrict = createDistrict('EMPD', 'Empty District', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const oldFacility = createFacility('F8', 'Old Clinic', { regionId: dsm, districtId: tmk });
    const emptyFacility = createFacility('F9', 'Empty Clinic', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1]);
    const mic = createDepartment('MIC', 'Microbiology');      // archived, no longer linked, has history at F1
    const xry = createDepartment('XRY', 'X-Ray', [f1]);       // archived, still linked, no responses

    const respond = (o: { facilityId?: number; regionId?: number; districtId?: number; departmentId?: number }) =>
      addResponse({ userId: createUser(), ...o });
    respond({ facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab });
    respond({ facilityId: f1, regionId: dsm, districtId: tmk, departmentId: mic });
    respond({ facilityId: oldFacility, regionId: dsm, districtId: tmk });
    respond({ regionId: dsm, districtId: oldDistrict });
    respond({ regionId: oldRegion });

    archive('regions', oldRegion);
    archive('regions', emptyRegion);
    archive('districts', oldDistrict);
    archive('districts', emptyDistrict);
    archive('facilities', oldFacility);
    archive('facilities', emptyFacility);
    archive('departments', mic);
    archive('departments', xry);

    const rows = (items: Record<string, unknown>[], key: string) => items.map((i) => [i[key], i.archived ?? false]);

    const national = await get('/reports/national');
    expect(rows(national.body.items, 'region_name')).toEqual([['Dar es Salaam', false], ['Old Region', true]]);
    expect(national.body.items[0]).not.toHaveProperty('archived_at');

    const region = await get(`/reports/regions/${dsm}`);
    expect(rows(region.body.items, 'district_name')).toEqual([['Old District', true], ['Temeke', false]]);

    const district = await get(`/reports/districts/${tmk}`);
    expect(rows(district.body.items, 'facility_name')).toEqual([['Old Clinic', true], ['Temeke Hospital', false]]);

    const facility = await get(`/reports/facilities/${f1}`);
    expect(rows(facility.body.items, 'department_name')).toEqual([['Laboratory', false], ['Microbiology', true]]);
  });
});
