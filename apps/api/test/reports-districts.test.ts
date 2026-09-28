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

  it('keeps region counts consistent for a response whose snapshotted region disagrees with its district', async () => {
    // A response snapshotted with region DSM but district Nyamagana, which is in region MWZ —
    // e.g. a legacy NULL-region facility later given a district in another region, or a
    // district that moved region after the response was recorded.
    const mwz = createRegion('MWZ', 'Mwanza');
    const nya = createDistrict('NYA', 'Nyamagana', mwz);
    const cross = createUser({ facilityId: fTmk });
    addResponse({ userId: cross, facilityId: fTmk, regionId: dsm, districtId: nya, level: 3 });

    // Region A (DSM): counted in total and as unassigned; no district bar includes it.
    const resDsm = await request(app).get(`/reports/regions/${dsm}`).set(asUser(admin));
    expect(resDsm.status).toBe(200);
    expect(resDsm.body.meta.total_respondents).toBe(4);
    expect(resDsm.body.meta.unassigned_respondents).toBe(2);
    const tmkBar = resDsm.body.items.find((i: { district_name: string }) => i.district_name === 'Temeke');
    const ilaBar = resDsm.body.items.find((i: { district_name: string }) => i.district_name === 'Ilala');
    expect(tmkBar.respondents).toBe(2);
    expect(ilaBar.respondents).toBe(0);
    const sumDsm = resDsm.body.items.reduce((s: number, i: { respondents: number }) => s + i.respondents, 0);
    expect(sumDsm + resDsm.body.meta.unassigned_respondents).toBe(resDsm.body.meta.total_respondents);

    // Region B (MWZ): Nyamagana's bar excludes it, and MWZ's total excludes it too.
    const resMwz = await request(app).get(`/reports/regions/${mwz}`).set(asUser(admin));
    expect(resMwz.status).toBe(200);
    expect(resMwz.body.meta.total_respondents).toBe(0);
    expect(resMwz.body.meta.unassigned_respondents).toBe(0);
    const nyaBar = resMwz.body.items.find((i: { district_name: string }) => i.district_name === 'Nyamagana');
    expect(nyaBar.respondents).toBe(0);
    const sumMwz = resMwz.body.items.reduce((s: number, i: { respondents: number }) => s + i.respondents, 0);
    expect(sumMwz + resMwz.body.meta.unassigned_respondents).toBe(resMwz.body.meta.total_respondents);
  });
});
