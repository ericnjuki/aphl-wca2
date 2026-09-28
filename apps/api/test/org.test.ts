import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/database';
import {
  getOrgContext, resolveDistrict, syncFacilitiesRegion, backfillResponseDistrict,
} from '../src/lib/org';
import {
  initTestDb, resetDb, createRegion, createDistrict, createFacility, createUser, addResponse,
} from './helpers';

describe('lib/org', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('getOrgContext includes the facility district', () => {
    const r = createRegion('DSM', 'Dar es Salaam');
    const d = createDistrict('TMK', 'Temeke', r);
    const f = createFacility('F1', 'Fac 1', { regionId: r, districtId: d });
    const u = createUser({ facilityId: f });
    expect(getOrgContext(u)).toEqual({ facility_id: f, department_id: null, region_id: r, district_id: d });
  });

  it('resolveDistrict returns id + region, or null for missing/unknown', () => {
    const r = createRegion('DSM', 'Dar es Salaam');
    const d = createDistrict('TMK', 'Temeke', r);
    expect(resolveDistrict(d)).toEqual({ id: d, region_id: r });
    expect(resolveDistrict(String(d))).toEqual({ id: d, region_id: r });
    expect(resolveDistrict(undefined)).toBeNull();
    expect(resolveDistrict(null)).toBeNull();
    expect(resolveDistrict(99999)).toBeNull();
  });

  it('syncFacilitiesRegion moves every facility in the district to the new region', () => {
    const r1 = createRegion('R1', 'One');
    const r2 = createRegion('R2', 'Two');
    const d = createDistrict('D1', 'Dist', r1);
    const f = createFacility('F1', 'Fac', { regionId: r1, districtId: d });
    const other = createFacility('F2', 'Other', { regionId: r1 });
    syncFacilitiesRegion(d, r2);
    const rows = query<{ id: number; region_id: number }>('SELECT id, region_id FROM facilities ORDER BY id');
    expect(rows).toEqual([{ id: f, region_id: r2 }, { id: other, region_id: r1 }]);
  });

  it('backfillResponseDistrict fills only NULL district_id for that facility', () => {
    const r = createRegion('R1', 'One');
    const dOld = createDistrict('OLD', 'Old', r);
    const dNew = createDistrict('NEW', 'New', r);
    const f = createFacility('F1', 'Fac', { regionId: r });
    const g = createFacility('F2', 'Other', { regionId: r });
    const u = createUser({ facilityId: f });
    const empty = addResponse({ userId: u, facilityId: f, regionId: r });
    const kept = addResponse({ userId: u, facilityId: f, regionId: r, districtId: dOld });
    const elsewhere = addResponse({ userId: u, facilityId: g, regionId: r });

    backfillResponseDistrict(f, dNew);

    const byId = Object.fromEntries(
      query<{ id: number; district_id: number | null }>('SELECT id, district_id FROM user_assessment_responses')
        .map((x) => [x.id, x.district_id]),
    );
    expect(byId[empty]).toBe(dNew);
    expect(byId[kept]).toBe(dOld);
    expect(byId[elsewhere]).toBeNull();
  });
});
