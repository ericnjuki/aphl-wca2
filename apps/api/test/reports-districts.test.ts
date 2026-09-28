import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility, createUser, addResponse,
} from './helpers';

const app = testApp();

describe('district reports', () => {
  let admin: number, dsm: number, tmk: number, ila: number, fTmk: number, fLegacy: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    ila = createDistrict('ILA', 'Ilala', dsm);
    fTmk = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    createFacility('F2', 'Ilala Clinic', { regionId: dsm, districtId: ila });
    fLegacy = createFacility('F3', 'Legacy Lab', { regionId: dsm });

    const a = createUser({ facilityId: fTmk });
    const b = createUser({ facilityId: fTmk });
    const c = createUser({ facilityId: fLegacy });
    addResponse({ userId: a, facilityId: fTmk, regionId: dsm, districtId: tmk, level: 2 });
    addResponse({ userId: b, facilityId: fTmk, regionId: dsm, districtId: tmk, level: 4 });
    addResponse({ userId: c, facilityId: fLegacy, regionId: dsm, level: 1 });
  });

  it('region report groups by district and lists undistricted facilities', async () => {
    const res = await request(app).get(`/reports/regions/${dsm}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { district_name: string; respondents: number }) => [i.district_name, i.respondents]))
      .toEqual([['Ilala', 0], ['Temeke', 2]]);
    expect(res.body.undistricted_facilities).toEqual([{ id: fLegacy, name: 'Legacy Lab' }]);
    expect(res.body.meta.total_respondents).toBe(3);
    expect(res.body.meta.unassigned_respondents).toBe(1);
  });

  it('district report lists its facilities with counts', async () => {
    const res = await request(app).get(`/reports/districts/${tmk}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.level).toBe('district');
    expect(res.body.district).toEqual({ id: tmk, name: 'Temeke', region_id: dsm, region_name: 'Dar es Salaam' });
    expect(res.body.items).toEqual([
      expect.objectContaining({ facility_id: fTmk, facility_name: 'Temeke Hospital', respondents: 2, avg_level: 3 }),
    ]);
    expect(res.body.meta.total_respondents).toBe(2);
    expect(res.body.meta.unassigned_respondents).toBe(0);
  });

  it('district report 404s for an unknown district', async () => {
    const res = await request(app).get('/reports/districts/99999').set(asUser(admin));
    expect(res.status).toBe(404);
  });

  it('facility report exposes district and region names', async () => {
    const res = await request(app).get(`/reports/facilities/${fTmk}`).set(asUser(admin));
    expect(res.body.facility).toEqual({
      id: fTmk, name: 'Temeke Hospital', region_id: dsm, region_name: 'Dar es Salaam',
      district_id: tmk, district_name: 'Temeke',
    });
  });

  it('staff can see their own district only', async () => {
    const staff = createUser({ facilityId: fTmk });
    expect((await request(app).get(`/reports/districts/${tmk}`).set(asUser(staff))).status).toBe(200);
    expect((await request(app).get(`/reports/districts/${ila}`).set(asUser(staff))).status).toBe(403);
  });
});
