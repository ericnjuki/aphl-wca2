import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility,
  createUser, assignRegions, addResponse,
} from './helpers';

const app = testApp();
const get = (path: string, userId: number) => request(app).get(path).set(asUser(userId));

// A partner must not read a report whose row is hidden one level up, or the
// hidden figures could be recovered by subtraction.
describe('partner drill-down privacy', () => {
  let admin: number, partner: number;
  let region: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    region = createRegion('DSM', 'Dar es Salaam');
    admin = createUser({ role: 'admin' });
    partner = createUser({ role: 'monitor' });
    assignRegions(partner, [region]);
  });

  const respond = (n: number, facilityId: number, districtId: number, level = 2): number[] => {
    const users: number[] = [];
    for (let i = 0; i < n; i++) {
      const userId = createUser({ facilityId });
      addResponse({ userId, facilityId, regionId: region, districtId, level });
      users.push(userId);
    }
    return users;
  };

  const expectHidden = (body: any) => {
    expect(body.meta.privacy_hidden).toBe(true);
    expect(body.meta.total_respondents).toBe(0);
    expect(body.meta.unassigned_respondents).toBe(0);
    expect(body.meta.avg_level).toBeNull();
    for (const item of body.items) {
      expect(item).toMatchObject({ suppressed: 'parent', respondents: 0, total_responses: 0, avg_level: null });
    }
  };

  it('hides a district that is hidden as the complementary row in the region list (the subtraction leak)', async () => {
    const a = createDistrict('A', 'Alpha', region);
    const b = createDistrict('B', 'Beta', region);
    const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
    const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
    respond(2, fa, a);
    respond(5, fb, b);

    const asPartner = await get(`/reports/districts/${b}`, partner);
    expect(asPartner.status).toBe(200);
    expectHidden(asPartner.body);
    expect(asPartner.body.district.name).toBe('Beta');
    expect(asPartner.body.items[0]).toMatchObject({ facility_id: fb, facility_name: 'Beta Clinic' });

    const asAdmin = await get(`/reports/districts/${b}`, admin);
    expect(asAdmin.body.meta.total_respondents).toBe(5);
    expect(asAdmin.body.meta.privacy_hidden).toBeFalsy();
    expect(asAdmin.body.items[0].respondents).toBe(5);
  });

  it('hides a facility that is suppressed in its district list', async () => {
    const d = createDistrict('D', 'Delta', region);
    const fx = createFacility('FX', 'Small Clinic', { regionId: region, districtId: d });
    const fy = createFacility('FY', 'Mid Clinic', { regionId: region, districtId: d });
    const fz = createFacility('FZ', 'Big Clinic', { regionId: region, districtId: d });
    respond(2, fx, d); respond(4, fy, d); respond(6, fz, d);

    const small = await get(`/reports/facilities/${fx}`, partner);
    expect(small.status).toBe(200);
    expectHidden(small.body);
    const complementary = await get(`/reports/facilities/${fy}`, partner);
    expectHidden(complementary.body);
    const visible = await get(`/reports/facilities/${fz}`, partner);
    expect(visible.body.meta.privacy_hidden).toBeFalsy();
    expect(visible.body.meta.total_respondents).toBe(6);

    const asAdmin = await get(`/reports/facilities/${fx}`, admin);
    expect(asAdmin.body.meta.total_respondents).toBe(2);
    expect(asAdmin.body.meta.privacy_hidden).toBeFalsy();
  });

  it('hides a facility whose district is hidden, even when the facility is visible in its own district list', async () => {
    const a = createDistrict('A', 'Alpha', region);
    const b = createDistrict('B', 'Beta', region);
    const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
    const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
    respond(2, fa, a);
    respond(5, fb, b);

    // In district Beta's own list the only row has 5 people, so it is visible.
    const res = await get(`/reports/facilities/${fb}`, partner);
    expect(res.status).toBe(200);
    expectHidden(res.body);

    const asAdmin = await get(`/reports/facilities/${fb}`, admin);
    expect(asAdmin.body.meta.total_respondents).toBe(5);
  });

  it('leaves visible districts and facilities untouched', async () => {
    const a = createDistrict('A', 'Alpha', region);
    const b = createDistrict('B', 'Beta', region);
    const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
    const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
    respond(4, fa, a); respond(5, fb, b);

    const district = await get(`/reports/districts/${a}`, partner);
    expect(district.body.meta.privacy_hidden).toBeFalsy();
    expect(district.body.meta.total_respondents).toBe(4);
    expect(district.body.items[0]).toMatchObject({ respondents: 4 });
    expect(district.body.items[0].suppressed).toBeUndefined();

    const facility = await get(`/reports/facilities/${fb}`, partner);
    expect(facility.body.meta.privacy_hidden).toBeFalsy();
    expect(facility.body.meta.total_respondents).toBe(5);
  });

  it('does not treat a facility without a district as hidden by a parent list', async () => {
    const orphan = createFacility('FO', 'Orphan Clinic', { regionId: region, districtId: null });
    for (let i = 0; i < 4; i++) {
      addResponse({ userId: createUser({ facilityId: orphan }), facilityId: orphan, regionId: region, districtId: null });
    }
    const res = await get(`/reports/facilities/${orphan}`, partner);
    expect(res.status).toBe(200);
    expect(res.body.meta.privacy_hidden).toBeFalsy();
    expect(res.body.meta.total_respondents).toBe(4);
  });

  it('applies the request filters to the hidden check', async () => {
    const a = createDistrict('A', 'Alpha', region);
    const b = createDistrict('B', 'Beta', region);
    const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
    const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
    const aUsers = respond(3, fa, a);
    respond(3, fb, b);

    // Unfiltered: both districts have 3 people, nothing is hidden.
    const unfiltered = await get(`/reports/districts/${b}`, partner);
    expect(unfiltered.body.meta.privacy_hidden).toBeFalsy();

    // Move one of Alpha's people to another domain: with domain LAB Alpha has 2
    // (small), which makes Beta the complementary row.
    execute("UPDATE user_assessment_responses SET domain_code = 'OTH' WHERE user_id = ?", [aUsers[0]]);
    const filtered = await get(`/reports/districts/${b}?domain_code=LAB`, partner);
    expectHidden(filtered.body);
    const other = await get(`/reports/districts/${b}`, partner);
    expect(other.body.meta.privacy_hidden).toBeFalsy();
  });

  // Respondents of a region with no district are in the region total but in no
  // list row, so they must take part in suppression too.
  describe('respondents with no district', () => {
    const undistricted = (n: number): number => {
      const u = createFacility('FU', 'Undistricted Clinic', { regionId: region, districtId: null });
      for (let i = 0; i < n; i++) {
        addResponse({ userId: createUser({ facilityId: u }), facilityId: u, regionId: region, districtId: null });
      }
      return u;
    };

    it('hides the undistricted group as the complementary row, and its facility reports', async () => {
      const a = createDistrict('A', 'Alpha', region);
      const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
      respond(2, fa, a);
      const u = undistricted(10);

      const regionRes = await get(`/reports/regions/${region}`, partner);
      expect(regionRes.body.items.find((i: any) => i.district_id === a).suppressed).toBe('small');
      expect(regionRes.body.meta.unassigned_respondents).toBe(0);
      const hidden = await get(`/reports/facilities/${u}`, partner);
      expectHidden(hidden.body);

      const asAdmin = await get(`/reports/facilities/${u}`, admin);
      expect(asAdmin.body.meta.total_respondents).toBe(10);
      expect(asAdmin.body.meta.privacy_hidden).toBeFalsy();
      const adminRegion = await get(`/reports/regions/${region}`, admin);
      expect(adminRegion.body.meta.unassigned_respondents).toBe(10);
    });

    it('hides a small undistricted group without hiding visible districts', async () => {
      const a = createDistrict('A', 'Alpha', region);
      const b = createDistrict('B', 'Beta', region);
      const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
      const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
      respond(2, fa, a); respond(5, fb, b);
      const u = undistricted(2);

      const regionRes = await get(`/reports/regions/${region}`, partner);
      expect(regionRes.body.items.find((i: any) => i.district_id === b).suppressed).toBeUndefined();
      expect(regionRes.body.meta.unassigned_respondents).toBe(0);
      expectHidden((await get(`/reports/facilities/${u}`, partner)).body);
      expect((await get(`/reports/districts/${b}`, partner)).body.meta.privacy_hidden).toBeFalsy();
    });

    it('changes nothing when the region has no undistricted respondents', async () => {
      const a = createDistrict('A', 'Alpha', region);
      const b = createDistrict('B', 'Beta', region);
      const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
      const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
      respond(2, fa, a); respond(5, fb, b);
      const regionRes = await get(`/reports/regions/${region}`, partner);
      expect(regionRes.body.items.find((i: any) => i.district_id === a).suppressed).toBe('small');
      expect(regionRes.body.items.find((i: any) => i.district_id === b).suppressed).toBe('complementary');
      expect(regionRes.body.meta.unassigned_respondents).toBe(0);
    });
  });

  it('counts only responses from the current region of the district in a partner district report', async () => {
    const old = createRegion('OLD', 'Old Region');
    const a = createDistrict('A', 'Alpha', region);
    const e = createDistrict('E', 'Echo', region);
    const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
    const fe = createFacility('FE', 'Echo Clinic', { regionId: region, districtId: e });
    respond(3, fa, a); respond(4, fe, e);
    for (let i = 0; i < 2; i++) {
      addResponse({ userId: createUser({ facilityId: fa }), facilityId: fa, regionId: old, districtId: a });
    }

    const row = (await get(`/reports/regions/${region}`, partner)).body.items.find((i: any) => i.district_id === a);
    expect(row.respondents).toBe(3);
    const res = await get(`/reports/districts/${a}`, partner);
    expect(res.body.meta.privacy_hidden).toBeFalsy();
    expect(res.body.meta.total_respondents).toBe(3);
    expect(res.body.items[0].respondents).toBe(3);

    const asAdmin = await get(`/reports/districts/${a}`, admin);
    expect(asAdmin.body.meta.total_respondents).toBe(5);
  });

  it('drops the archived flag from the children of a hidden report', async () => {
    const a = createDistrict('A', 'Alpha', region);
    const b = createDistrict('B', 'Beta', region);
    const fa = createFacility('FA', 'Alpha Clinic', { regionId: region, districtId: a });
    const fb = createFacility('FB', 'Beta Clinic', { regionId: region, districtId: b });
    respond(2, fa, a); respond(5, fb, b);
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE id = ?", [fb]);
    const res = await get(`/reports/districts/${b}`, partner);
    expectHidden(res.body);
    expect(res.body.items[0].archived).toBeUndefined();
  });
});
