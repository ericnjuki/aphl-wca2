import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility,
  createUser, assignRegions, createDepartment, addResponse,
} from './helpers';

const app = testApp();
const get = (path: string, userId: number) => request(app).get(path).set(asUser(userId));
const row = <T extends Record<string, unknown>>(items: T[], key: string, value: unknown) =>
  items.find((i) => i[key] === value) as T;

const HIDDEN = {
  suppressed: true, respondents: 0, total_responses: 0, avg_level: null,
  count_na: 0, count_beginner: 0, count_competent: 0, count_proficient: 0, count_expert: 0,
};

// Partners only see aggregates; a row built from 1–2 people would expose them.
describe('small-group suppression for partner users', () => {
  let admin: number, monitor: number;
  let dsm: number, tmk: number, ila: number, f1: number, lab: number, mic: number, xry: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    ila = createDistrict('ILA', 'Ilala', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const f2 = createFacility('F2', 'Ilala Clinic', { regionId: dsm, districtId: ila });
    lab = createDepartment('LAB', 'Laboratory', [f1, f2]);
    mic = createDepartment('MIC', 'Microbiology', [f1]);
    xry = createDepartment('XRY', 'X-Ray', [f1]);

    const respond = (facilityId: number, districtId: number, departmentId: number, level: number) =>
      addResponse({ userId: createUser({ facilityId }), facilityId, regionId: dsm, districtId, departmentId, level });
    // Temeke Hospital: Laboratory 3 people, Microbiology 2 people, X-Ray nobody.
    respond(f1, tmk, lab, 2); respond(f1, tmk, lab, 3); respond(f1, tmk, lab, 4);
    respond(f1, tmk, mic, 1); respond(f1, tmk, mic, 4);
    // Ilala Clinic: 2 people in total.
    respond(f2, ila, lab, 2); respond(f2, ila, lab, 3);

    admin = createUser({ role: 'admin' });
    monitor = createUser({ role: 'monitor' });
    assignRegions(monitor, [dsm]);
  });

  it('hides departments with fewer than 3 respondents in the facility report', async () => {
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(res.status).toBe(200);
    expect(row(res.body.items, 'department_id', mic)).toMatchObject(HIDDEN);
    expect(row(res.body.items, 'department_id', lab)).toMatchObject({ respondents: 3, count_expert: 1 });
    expect(row(res.body.items, 'department_id', lab).suppressed).toBeUndefined();
  });

  it('leaves rows with no respondents alone', async () => {
    const res = await get(`/reports/facilities/${f1}`, monitor);
    const empty = row(res.body.items, 'department_id', xry);
    expect(empty.respondents).toBe(0);
    expect(empty.suppressed).toBeUndefined();
  });

  it('hides small facilities in the district report and small districts in the region report', async () => {
    const district = await get(`/reports/districts/${ila}`, monitor);
    expect(district.body.items[0]).toMatchObject({ facility_name: 'Ilala Clinic', ...HIDDEN });

    const region = await get(`/reports/regions/${dsm}`, monitor);
    expect(row(region.body.items, 'district_id', ila)).toMatchObject(HIDDEN);
    expect(row(region.body.items, 'district_id', tmk)).toMatchObject({ respondents: 5 });
  });

  it('does not hide anything from admins', async () => {
    const res = await get(`/reports/facilities/${f1}`, admin);
    expect(row(res.body.items, 'department_id', mic))
      .toMatchObject({ respondents: 2, count_beginner: 1, count_expert: 1 });
    expect(row(res.body.items, 'department_id', mic).suppressed).toBeUndefined();
  });

  it('does not hide anything from staff', async () => {
    const staff = createUser({ facilityId: f1 });
    const res = await get(`/reports/facilities/${f1}`, staff);
    expect(row(res.body.items, 'department_id', mic)).toMatchObject({ respondents: 2 });
  });
});
