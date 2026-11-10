import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createFacility, createDepartment, createUser, addResponse,
} from './helpers';

const app = testApp();

const userIds = (body: { items: { user_id: number }[] }) => body.items.map((i) => i.user_id).sort();

describe('department reports', () => {
  let admin: number, fA: number, fB: number, lab: number, aliceA: number, bobB: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    const dsm = createRegion('DSM', 'Dar es Salaam');
    fA = createFacility('FA', 'Facility A', { regionId: dsm });
    fB = createFacility('FB', 'Facility B', { regionId: dsm });
    // One department shared by both facilities.
    lab = createDepartment('LAB', 'Laboratory', [fA, fB]);

    aliceA = createUser({ facilityId: fA });
    bobB = createUser({ facilityId: fB });
    addResponse({ userId: aliceA, facilityId: fA, regionId: dsm, departmentId: lab, level: 2 });
    addResponse({ userId: bobB, facilityId: fB, regionId: dsm, departmentId: lab, level: 4 });
  });

  it('staff only see respondents from their own facility', async () => {
    const staff = createUser({ facilityId: fA });
    for (const url of [`/reports/departments/${lab}`, `/reports/departments/${lab}?facility_id=${fA}`]) {
      const res = await request(app).get(url).set(asUser(staff));
      expect(res.status).toBe(200);
      expect(userIds(res.body)).toEqual([aliceA]);
      expect(res.body.meta.total_respondents).toBe(1);
      expect(res.body.facility).toEqual({ id: fA, name: 'Facility A' });
    }
  });

  it('staff may not request another facility', async () => {
    const staff = createUser({ facilityId: fA });
    const res = await request(app).get(`/reports/departments/${lab}?facility_id=${fB}`).set(asUser(staff));
    expect(res.status).toBe(403);
  });

  it('admin without facility_id keeps the cross-facility view', async () => {
    const res = await request(app).get(`/reports/departments/${lab}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(userIds(res.body)).toEqual([aliceA, bobB].sort());
    expect(res.body.meta.total_respondents).toBe(2);
    expect(res.body.facility).toBeNull();
  });

  it('admin with facility_id sees only that facility', async () => {
    const res = await request(app).get(`/reports/departments/${lab}?facility_id=${fB}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(userIds(res.body)).toEqual([bobB]);
    expect(res.body.meta.total_respondents).toBe(1);
    expect(res.body.facility).toEqual({ id: fB, name: 'Facility B' });
  });

  it('404s for an unknown facility_id', async () => {
    const res = await request(app).get(`/reports/departments/${lab}?facility_id=99999`).set(asUser(admin));
    expect(res.status).toBe(404);
  });
});
