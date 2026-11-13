import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility,
  createUser, createCounty, createSubcounty, createDepartment,
} from './helpers';

const app = testApp();
const status = async (path: string, userId: number) => (await request(app).get(path).set(asUser(userId))).status;

// Access matrix per role × report level (plans/2026-11-12-role-model.md → Roles).
describe('report access per role', () => {
  let dsm: number, aru: number, tmk: number, ila: number, ard: number;
  let fTmk: number, fTmk2: number, fIla: number, fAru: number, dept: number, deptAru: number;
  let staffTmk: number, staffTmk2: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    aru = createRegion('ARU', 'Arusha');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    ila = createDistrict('ILA', 'Ilala', dsm);
    ard = createDistrict('ARD', 'Arusha DC', aru);
    fTmk = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    fTmk2 = createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    fIla = createFacility('F3', 'Ilala Clinic', { regionId: dsm, districtId: ila });
    fAru = createFacility('F4', 'Arusha Lab', { regionId: aru, districtId: ard });
    dept = createDepartment('LAB', 'Laboratory', [fTmk]);
    deptAru = createDepartment('MIC', 'Microbiology', [fAru]);
    staffTmk = createUser({ facilityId: fTmk });
    staffTmk2 = createUser({ facilityId: fTmk2 });
  });

  it('admin sees every level', async () => {
    const admin = createUser({ role: 'admin' });
    for (const p of ['/reports/national', `/reports/regions/${aru}`, `/reports/districts/${ard}`,
      `/reports/facilities/${fAru}`, `/reports/departments/${deptAru}`, `/reports/users/${staffTmk}`]) {
      expect(await status(p, admin), p).toBe(200);
    }
  });

  it('national sees the national report only', async () => {
    const nat = createUser({ role: 'national' });
    expect(await status('/reports/national', nat)).toBe(200);
    for (const p of [`/reports/regions/${dsm}`, `/reports/districts/${tmk}`, `/reports/facilities/${fTmk}`,
      `/reports/departments/${dept}`, `/reports/users/${staffTmk}`, `/reports/users/${nat}`]) {
      expect(await status(p, nat), p).toBe(403);
    }
  });

  describe('county coordinator', () => {
    let county: number;
    beforeEach(() => { county = createCounty(dsm); });

    it('sees its county and the districts and facilities in it', async () => {
      for (const p of [`/reports/regions/${dsm}`, `/reports/districts/${tmk}`, `/reports/districts/${ila}`,
        `/reports/facilities/${fTmk}`, `/reports/facilities/${fIla}`]) {
        expect(await status(p, county), p).toBe(200);
      }
    });

    it('sees nothing outside its county, nor the national report', async () => {
      for (const p of ['/reports/national', `/reports/regions/${aru}`, `/reports/districts/${ard}`,
        `/reports/facilities/${fAru}`]) {
        expect(await status(p, county), p).toBe(403);
      }
    });

    it('never sees department or individual reports, its own included', async () => {
      expect(await status(`/reports/departments/${dept}`, county)).toBe(403);
      expect(await status(`/reports/users/${staffTmk}`, county)).toBe(403);
      expect(await status(`/reports/users/${county}`, county)).toBe(403);
    });

    it('follows a facility that moves to another county', async () => {
      execute('UPDATE facilities SET region_id = ? WHERE id = ?', [aru, fTmk]);
      expect(await status(`/reports/facilities/${fTmk}`, county)).toBe(403);
    });

    it('sees nothing without an assigned county', async () => {
      const empty = createUser({ role: 'county' });
      expect(await status(`/reports/regions/${dsm}`, empty)).toBe(403);
    });
  });

  describe('sub-county coordinator', () => {
    let sub: number;
    beforeEach(() => { sub = createSubcounty(tmk); });

    it('sees its sub-county and the facilities in it', async () => {
      for (const p of [`/reports/districts/${tmk}`, `/reports/facilities/${fTmk}`, `/reports/facilities/${fTmk2}`]) {
        expect(await status(p, sub), p).toBe(200);
      }
    });

    it('sees nothing above or beside its sub-county', async () => {
      for (const p of ['/reports/national', `/reports/regions/${dsm}`, `/reports/districts/${ila}`,
        `/reports/facilities/${fIla}`, `/reports/facilities/${fAru}`]) {
        expect(await status(p, sub), p).toBe(403);
      }
    });

    it('never sees department or individual reports', async () => {
      expect(await status(`/reports/departments/${dept}`, sub)).toBe(403);
      expect(await status(`/reports/users/${staffTmk}`, sub)).toBe(403);
    });

    it('follows a facility that moves to another sub-county', async () => {
      execute('UPDATE facilities SET district_id = ? WHERE id = ?', [ila, fTmk]);
      expect(await status(`/reports/facilities/${fTmk}`, sub)).toBe(403);
    });
  });

  describe('facility admin', () => {
    let fadmin: number;
    beforeEach(() => { fadmin = createUser({ role: 'facility_admin', facilityId: fTmk }); });

    it('sees its facility, its departments, and individuals in it', async () => {
      for (const p of [`/reports/facilities/${fTmk}`, `/reports/departments/${dept}`,
        `/reports/users/${staffTmk}`, `/reports/users/${fadmin}`]) {
        expect(await status(p, fadmin), p).toBe(200);
      }
    });

    it('sees nothing outside its facility', async () => {
      for (const p of ['/reports/national', `/reports/regions/${dsm}`, `/reports/districts/${tmk}`,
        `/reports/facilities/${fTmk2}`, `/reports/departments/${deptAru}`, `/reports/users/${staffTmk2}`]) {
        expect(await status(p, fadmin), p).toBe(403);
      }
    });

    it('sees nothing without a facility', async () => {
      const loose = createUser({ role: 'facility_admin' });
      expect(await status(`/reports/facilities/${fTmk}`, loose)).toBe(403);
    });
  });

  describe('staff', () => {
    it('sees its own individual report only', async () => {
      expect(await status(`/reports/users/${staffTmk}`, staffTmk)).toBe(200);
      for (const p of ['/reports/national', `/reports/regions/${dsm}`, `/reports/districts/${tmk}`,
        `/reports/facilities/${fTmk}`, `/reports/departments/${dept}`, `/reports/users/${staffTmk2}`]) {
        expect(await status(p, staffTmk), p).toBe(403);
      }
    });

    it('a facility-less staff user sees only their own report', async () => {
      const a = createUser();
      const b = createUser();
      expect(await status(`/reports/users/${a}`, a)).toBe(200);
      expect(await status(`/reports/users/${b}`, a)).toBe(403);
    });
  });
});
