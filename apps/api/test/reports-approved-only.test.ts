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

// Response rows are written when a survey is completed, before review, so the
// approved_only filter (default on) has to drop pending/rejected sessions.
describe('approved_only report filter', () => {
  let admin: number, pendingUser: number;
  let dsm: number, tmk: number, f1: number, lab: number;
  let mby: number, mbd: number, f2: number, mic: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    lab = createDepartment('LAB', 'Laboratory', [f1]);
    // Mbeya only has a pending response: an empty bucket once filtered.
    mby = createRegion('MBY', 'Mbeya');
    mbd = createDistrict('MBD', 'Mbeya Urban', mby);
    f2 = createFacility('F2', 'Mbeya Clinic', { regionId: mby, districtId: mbd });
    mic = createDepartment('MIC', 'Microbiology', [f2]);

    const inTemeke = { facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab };
    addResponse({ userId: createUser({ facilityId: f1 }), ...inTemeke, level: 4 });
    pendingUser = createUser({ facilityId: f1 });
    addResponse({ userId: pendingUser, ...inTemeke, level: 1, reviewStatus: 'pending' });
    addResponse({ userId: createUser({ facilityId: f1 }), ...inTemeke, level: 1, reviewStatus: 'rejected' });
    // No location at all: counts as unassigned at national level.
    addResponse({ userId: createUser(), level: 2, reviewStatus: 'pending' });
    addResponse({
      userId: createUser({ facilityId: f2 }), facilityId: f2, regionId: mby, districtId: mbd, departmentId: mic,
      level: 3, reviewStatus: 'pending',
    });

    admin = createUser({ role: 'admin' });
  });

  describe('on by default', () => {
    it('national: counts only approved sessions in rows, totals, unassigned and average', async () => {
      const res = await get('/reports/national', admin);
      expect(res.status).toBe(200);
      expect(row(res.body.items, 'region_id', dsm)).toMatchObject({ respondents: 1, total_responses: 1, avg_level: 4 });
      expect(res.body.meta).toMatchObject({
        total_respondents: 1, unassigned_respondents: 0, avg_level: 4,
        filters: { approved_only: true },
      });
    });

    it('region, district and facility rows count only approved sessions', async () => {
      const region = await get(`/reports/regions/${dsm}`, admin);
      expect(row(region.body.items, 'district_id', tmk)).toMatchObject({ respondents: 1, count_expert: 1, count_beginner: 0 });
      expect(region.body.meta).toMatchObject({ total_respondents: 1, avg_level: 4 });

      const district = await get(`/reports/districts/${tmk}`, admin);
      expect(row(district.body.items, 'facility_id', f1)).toMatchObject({ respondents: 1 });
      expect(district.body.meta.total_respondents).toBe(1);

      const facility = await get(`/reports/facilities/${f1}`, admin);
      expect(row(facility.body.items, 'department_id', lab)).toMatchObject({ respondents: 1 });
      expect(facility.body.meta.total_respondents).toBe(1);
    });

    it('department grid lists only users with approved sessions', async () => {
      const res = await get(`/reports/departments/${lab}?facility_id=${f1}`, admin);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ respondents: 1, avg_level: 4 });
      expect(res.body.meta.total_respondents).toBe(1);
    });

    it('individual report hides a pending session', async () => {
      const res = await get(`/reports/users/${pendingUser}`, admin);
      expect(res.body.items).toEqual([]);
      expect(res.body.subcompetencies).toEqual([]);
    });

    it('still lists buckets whose only responses are filtered out', async () => {
      const national = await get('/reports/national', admin);
      expect(row(national.body.items, 'region_id', mby)).toMatchObject({ respondents: 0, total_responses: 0 });

      const region = await get(`/reports/regions/${mby}`, admin);
      expect(row(region.body.items, 'district_id', mbd)).toMatchObject({ respondents: 0 });

      const district = await get(`/reports/districts/${mbd}`, admin);
      expect(row(district.body.items, 'facility_id', f2)).toMatchObject({ respondents: 0 });

      const facility = await get(`/reports/facilities/${f2}`, admin);
      expect(row(facility.body.items, 'department_id', mic)).toMatchObject({ respondents: 0 });
    });
  });

  describe('approved_only=false', () => {
    it('national includes pending and rejected sessions', async () => {
      const res = await get('/reports/national?approved_only=false', admin);
      expect(row(res.body.items, 'region_id', dsm)).toMatchObject({ respondents: 3 });
      expect(row(res.body.items, 'region_id', mby)).toMatchObject({ respondents: 1 });
      expect(res.body.meta).toMatchObject({
        total_respondents: 5, unassigned_respondents: 1, filters: { approved_only: false },
      });
      expect(res.body.meta.avg_level).toBeCloseTo(2.2);
    });

    it('lower levels include pending and rejected sessions', async () => {
      const facility = await get(`/reports/facilities/${f1}?approved_only=false`, admin);
      expect(row(facility.body.items, 'department_id', lab)).toMatchObject({ respondents: 3 });

      const dept = await get(`/reports/departments/${lab}?facility_id=${f1}&approved_only=false`, admin);
      expect(dept.body.items).toHaveLength(3);

      const user = await get(`/reports/users/${pendingUser}?approved_only=false`, admin);
      expect(user.body.items).toHaveLength(1);
      expect(user.body.subcompetencies).toHaveLength(1);
    });
  });

  describe('partner (monitor) users', () => {
    let monitor: number, f3: number, kgm: number;

    // Kigamboni Clinic: one facility in its own district, so suppression of
    // its row depends only on its own (filtered) respondent count.
    const fill = (approved: number, pending: number) => {
      for (let i = 0; i < approved + pending; i++) {
        addResponse({
          userId: createUser({ facilityId: f3 }), facilityId: f3, regionId: dsm, districtId: kgm,
          level: 3, reviewStatus: i < approved ? 'approved' : 'pending',
        });
      }
    };

    beforeEach(() => {
      kgm = createDistrict('KGM', 'Kigamboni', dsm);
      f3 = createFacility('F3', 'Kigamboni Clinic', { regionId: dsm, districtId: kgm });
      monitor = createUser({ role: 'monitor' });
      assignRegions(monitor, [dsm]);
      // Give Temeke enough approved respondents (with the one above) that it is
      // not itself hidden in the region list, so Kigamboni's own count decides.
      for (let i = 0; i < 3; i++) {
        addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab, level: 3 });
      }
    });

    it('suppresses a row whose approved respondents are a small group', async () => {
      fill(2, 3);
      // Only the 2 approved respondents count, so Kigamboni is a small row in the
      // region list and (being hidden there) its own report is privacy hidden.
      const regionRes = await get(`/reports/regions/${dsm}`, monitor);
      expect(row(regionRes.body.items, 'district_id', kgm)).toMatchObject({ suppressed: 'small', respondents: 0 });
      const res = await get(`/reports/districts/${kgm}`, monitor);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ privacy_hidden: true, total_respondents: 0, avg_level: null });
    });

    it('does not suppress a row with enough approved respondents', async () => {
      fill(3, 2);
      const res = await get(`/reports/districts/${kgm}`, monitor);
      const r = row(res.body.items, 'facility_id', f3);
      expect(r.suppressed).toBeUndefined();
      expect(r.respondents).toBe(3);
    });

    it('cannot turn the filter off', async () => {
      fill(3, 2);
      const res = await get(`/reports/districts/${kgm}?approved_only=false`, monitor);
      expect(row(res.body.items, 'facility_id', f3)).toMatchObject({ respondents: 3 });
      expect(res.body.meta.filters.approved_only).toBe(true);
    });
  });
});
