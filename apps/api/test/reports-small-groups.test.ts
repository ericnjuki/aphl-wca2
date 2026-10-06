import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility,
  createUser, assignRegions, createDepartment, addResponse,
} from './helpers';

const app = testApp();
const get = (path: string, userId: number) => request(app).get(path).set(asUser(userId));
const row = <T extends Record<string, unknown>>(items: T[], key: string, value: unknown) =>
  items.find((i) => i[key] === value) as T;

const HIDDEN = {
  suppressed: 'small', respondents: 0, total_responses: 0, avg_level: null,
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

  it('hides small departments, plus a second row so the hidden one cannot be subtracted out', async () => {
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(res.status).toBe(200);
    expect(row(res.body.items, 'department_id', mic)).toMatchObject(HIDDEN);
    expect(row(res.body.items, 'department_id', lab)).toMatchObject({ ...HIDDEN, suppressed: 'complementary' });
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
    expect(row(region.body.items, 'district_id', tmk)).toMatchObject({ ...HIDDEN, suppressed: 'complementary' });
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

  it('hides nothing extra when two or more rows are already small', async () => {
    // Add a second small department (Pharmacy, 1 person) to Temeke Hospital.
    const pha = createDepartment('PHA', 'Pharmacy', [f1]);
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: pha, level: 2 });
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(row(res.body.items, 'department_id', mic).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', pha).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', lab).suppressed).toBeUndefined();
    expect(row(res.body.items, 'department_id', lab).respondents).toBe(3);
  });

  it('picks the smallest remaining row as the complementary one', async () => {
    // Give Laboratory more people than a new 4-person Radiology department.
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab, level: 3 });
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab, level: 3 });
    const rad = createDepartment('RAD', 'Radiology', [f1]);
    for (let i = 0; i < 4; i++) {
      addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: rad, level: 2 });
    }
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(row(res.body.items, 'department_id', mic).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', rad).suppressed).toBe('complementary');
    expect(row(res.body.items, 'department_id', lab).respondents).toBe(5);
  });

  it('reports the true average for the whole view in meta.avg_level', async () => {
    // Temeke Hospital: levels 2,3,4 (Laboratory) + 1,4 (Microbiology) -> 14 / 5 = 2.8
    const asAdmin = await get(`/reports/facilities/${f1}`, admin);
    expect(asAdmin.body.meta.avg_level).toBeCloseTo(2.8);
    const asPartner = await get(`/reports/facilities/${f1}`, monitor);
    expect(asPartner.body.meta.avg_level).toBeCloseTo(2.8);
  });

  it('hides the average from partners when the whole view has fewer than 3 respondents', async () => {
    const asPartner = await get(`/reports/districts/${ila}`, monitor);
    expect(asPartner.body.meta.total_respondents).toBe(2);
    expect(asPartner.body.meta.avg_level).toBeNull();
    const asAdmin = await get(`/reports/districts/${ila}`, admin);
    expect(asAdmin.body.meta.avg_level).toBeCloseTo(2.5);
  });

  it('hides the average from partners when 1-2 unassigned respondents sit outside every row', async () => {
    const f3 = createFacility('F3', 'Kinondoni Hospital', { regionId: dsm, districtId: tmk });
    const a = createDepartment('AAA', 'Alpha', [f3]);
    const resp = (departmentId: number | null, level: number) =>
      addResponse({ userId: createUser({ facilityId: f3 }), facilityId: f3, regionId: dsm, districtId: tmk, departmentId, level });
    resp(a, 2); resp(a, 3); resp(a, 4); // all rows visible
    resp(null, 4);                      // one unassigned respondent
    const asPartner = await get(`/reports/facilities/${f3}`, monitor);
    expect(row(asPartner.body.items, 'department_id', a).suppressed).toBeUndefined();
    expect(asPartner.body.meta.unassigned_respondents).toBe(1);
    expect(asPartner.body.meta.avg_level).toBeNull();
    const asAdmin = await get(`/reports/facilities/${f3}`, admin);
    expect(asAdmin.body.meta.avg_level).toBeCloseTo(3.25);
  });

  it('rounds the partner average to 2 decimals', async () => {
    // Laboratory 2,3,4 + Microbiology 1,4 + one more -> 3 decimals needed unrounded.
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: xry, level: 1 });
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: xry, level: 1 });
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: xry, level: 2 });
    // 14 + 4 = 18 over 8 = 2.25 ; add one more for a repeating decimal
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: xry, level: 2 });
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: xry, level: 2 });
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: xry, level: 2 });
    const res = await get(`/reports/facilities/${f1}`, monitor);
    const avg = res.body.meta.avg_level as number;
    expect(avg).not.toBeNull();
    expect(Math.round(avg * 100) / 100).toBe(avg);
    const asAdmin = await get(`/reports/facilities/${f1}`, admin);
    expect(asAdmin.body.meta.avg_level).not.toBe(avg); // admin keeps full precision
  });

  it('breaks ties between equally sized rows by taking the first by name', async () => {
    const f3 = createFacility('F3', 'Kinondoni Hospital', { regionId: dsm, districtId: tmk });
    const a = createDepartment('AAA', 'Alpha', [f3]);
    const b = createDepartment('BBB', 'Beta', [f3]);
    const c = createDepartment('CCC', 'Gamma', [f3]);
    const resp = (departmentId: number) =>
      addResponse({ userId: createUser({ facilityId: f3 }), facilityId: f3, regionId: dsm, districtId: tmk, departmentId, level: 2 });
    for (let i = 0; i < 3; i++) { resp(a); resp(b); }
    resp(c);
    const res = await get(`/reports/facilities/${f3}`, monitor);
    expect(row(res.body.items, 'department_id', c).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', a).suppressed).toBe('complementary');
    expect(row(res.body.items, 'department_id', b).suppressed).toBeUndefined();
  });

  it('suppresses a small archived child, flagged archived, and never picks an empty archived one as the complement', async () => {
    const mwz = createRegion('MWZ', 'Mwanza');
    const nya = createDistrict('NYA', 'Nyamagana', mwz);
    const mk = (code: string, name: string) => createFacility(code, name, { regionId: mwz, districtId: nya });
    const fA = mk('FA', 'Alpha Clinic'), fD = mk('FD', 'Delta Clinic');
    const fOld = mk('FO', 'Old Small Clinic'), fEmpty = mk('FE', 'Empty Old Clinic');
    const resp = (facilityId: number, n: number) => {
      for (let i = 0; i < n; i++) {
        addResponse({ userId: createUser({ facilityId }), facilityId, regionId: mwz, districtId: nya, level: 2 });
      }
    };
    resp(fA, 3); resp(fD, 4); resp(fOld, 2);
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE id IN (?, ?)", [fOld, fEmpty]);
    const partner = createUser({ role: 'monitor' });
    assignRegions(partner, [mwz]);

    const res = await get(`/reports/districts/${nya}`, partner);
    expect(res.status).toBe(200);
    expect(row(res.body.items, 'facility_id', fOld)).toMatchObject({ ...HIDDEN, archived: true });
    expect(row(res.body.items, 'facility_id', fA)).toMatchObject({ suppressed: 'complementary' });
    expect(row(res.body.items, 'facility_id', fD).suppressed).toBeUndefined();
    expect(res.body.items.map((i: { facility_id: number }) => i.facility_id)).not.toContain(fEmpty);
  });
});
