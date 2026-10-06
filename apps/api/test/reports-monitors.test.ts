import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility,
  createUser, assignRegions, createDepartment,
} from './helpers';

const app = testApp();
const get = (path: string, userId: number) => request(app).get(path).set(asUser(userId));

describe('monitor report scope', () => {
  let monitor: number, staffDsm: number;
  let dsm: number, mwz: number, aru: number;
  let tmk: number, ard: number;
  let fDsm: number, fMwz: number, fAru: number, dept: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    aru = createRegion('ARU', 'Arusha');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    const nya = createDistrict('NYA', 'Nyamagana', mwz);
    ard = createDistrict('ARD', 'Arusha DC', aru);
    fDsm = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    fMwz = createFacility('F2', 'Nyamagana Clinic', { regionId: mwz, districtId: nya });
    fAru = createFacility('F3', 'Arusha Lab', { regionId: aru, districtId: ard });
    dept = createDepartment('LAB', 'Laboratory', fDsm);
    staffDsm = createUser({ facilityId: fDsm });
    monitor = createUser({ role: 'monitor' });
    assignRegions(monitor, [dsm, mwz]);
  });

  it('can view every assigned region', async () => {
    expect((await get(`/reports/regions/${dsm}`, monitor)).status).toBe(200);
    expect((await get(`/reports/regions/${mwz}`, monitor)).status).toBe(200);
  });

  it('cannot view an unassigned region', async () => {
    expect((await get(`/reports/regions/${aru}`, monitor)).status).toBe(403);
  });

  it('can view districts and facilities inside assigned regions only', async () => {
    expect((await get(`/reports/districts/${tmk}`, monitor)).status).toBe(200);
    expect((await get(`/reports/districts/${ard}`, monitor)).status).toBe(403);
    expect((await get(`/reports/facilities/${fDsm}`, monitor)).status).toBe(200);
    expect((await get(`/reports/facilities/${fMwz}`, monitor)).status).toBe(200);
    expect((await get(`/reports/facilities/${fAru}`, monitor)).status).toBe(403);
  });

  it('cannot view the national report', async () => {
    expect((await get('/reports/national', monitor)).status).toBe(403);
  });

  it('cannot view department reports, even inside an assigned region', async () => {
    expect((await get(`/reports/departments/${dept}`, monitor)).status).toBe(403);
  });

  it('cannot view individual reports, including their own', async () => {
    expect((await get(`/reports/users/${staffDsm}`, monitor)).status).toBe(403);
    expect((await get(`/reports/users/${monitor}`, monitor)).status).toBe(403);
  });

  it('follows the facility when it moves to an unassigned region', async () => {
    execute('UPDATE facilities SET region_id = ? WHERE id = ?', [aru, fDsm]);
    expect((await get(`/reports/facilities/${fDsm}`, monitor)).status).toBe(403);
  });

  it('a monitor with no regions sees nothing', async () => {
    const empty = createUser({ role: 'monitor' });
    expect((await get(`/reports/regions/${dsm}`, empty)).status).toBe(403);
  });
});

describe('staff individual-report scope without a facility', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('a facility-less staff user cannot view another facility-less user', async () => {
    const a = createUser();
    const b = createUser();
    expect((await get(`/reports/users/${b}`, a)).status).toBe(403);
  });

  it('a facility-less staff user can still view their own report', async () => {
    const a = createUser();
    expect((await get(`/reports/users/${a}`, a)).status).toBe(200);
  });
});
