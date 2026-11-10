import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  createOrgRole, createTitle, addResponse,
} from './helpers';

const app = testApp();

describe('single-entity DELETE refuses entities with history', () => {
  let admin: number;
  let staff: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    staff = createUser({ role: 'staff' });
  });
  const del = (path: string) => request(app).delete(path).set(asUser(admin));
  const count = (table: string, id: number) =>
    query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, [id])[0].n;

  it.each([
    ['regions', '/admin/regions', 'regionId'],
    ['districts', '/admin/districts', 'districtId'],
    ['facilities', '/admin/facilities', 'facilityId'],
    ['departments', '/admin/departments', 'departmentId'],
  ] as const)('%s with responses -> 409 and the row stays', async (table, path, key) => {
    const ids = {
      regionId: createRegion('R1', 'Region One'),
      districtId: 0, facilityId: 0, departmentId: createDepartment('D1', 'Dept One'),
    };
    ids.districtId = createDistrict('T1', 'District One', ids.regionId);
    ids.facilityId = createFacility('F1', 'Facility One', { regionId: ids.regionId, districtId: ids.districtId });
    addResponse({ userId: staff, ...ids });
    const res = await del(`${path}/${ids[key]}`);
    expect(res.status).toBe(409);
    expect(res.body.error ?? res.body.message).toMatch(/has past assessment data/);
    expect(count(table, ids[key])).toBe(1);
  });

  it('org role / title assigned to a disabled user -> 409', async () => {
    const role = createOrgRole('MLS', 'Scientist');
    const title = createTitle('DR', 'Dr.');
    createUser({ enabled: false, orgRoleId: role, titleId: title });
    const r1 = await del(`/admin/org-roles/${role}`);
    const r2 = await del(`/admin/user-titles/${title}`);
    expect(r1.status).toBe(409);
    expect(r2.status).toBe(409);
    expect(JSON.stringify(r1.body)).toMatch(/is still assigned to users/);
    expect(count('org_roles', role)).toBe(1);
    expect(count('user_titles', title)).toBe(1);
  });

  it('entities without history can still be deleted', async () => {
    const region = createRegion('R2', 'Lonely Region');
    const district = createDistrict('T2', 'Lonely District', createRegion('R3', 'Other'));
    const facility = createFacility('F2', 'Lonely Facility');
    const dept = createDepartment('D2', 'Lonely Dept');
    const role = createOrgRole('X', 'Unused Role');
    const title = createTitle('Y', 'Unused Title');
    for (const path of [`regions/${region}`, `districts/${district}`, `facilities/${facility}`,
      `departments/${dept}`, `org-roles/${role}`, `user-titles/${title}`]) {
      expect((await del(`/admin/${path}`)).status).toBe(200);
    }
    expect(count('regions', region)).toBe(0);
  });
});
