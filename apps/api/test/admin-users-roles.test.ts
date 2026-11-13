import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility,
  createCounty, createSubcounty,
} from './helpers';

const app = testApp();

let n = 0;
const person = () => {
  n++;
  return { first_name: 'Pat', last_name: `Person${n}`, national_id: `P${n}`, id_type: 'NIN', email: `p${n}@example.test` };
};
const roleOf = (id: number) => query<{ role: string }>('SELECT role FROM users WHERE id = ?', [id])[0].role;

// Placement rules per role (plans/2026-11-12-role-model.md → Backend step 6).
describe('admin: users per role', () => {
  let admin: number, dsm: number, mwz: number, tmk: number, nya: number, fac: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    nya = createDistrict('NYA', 'Nyamagana', mwz);
    fac = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
  });

  const post = (body: object) => request(app).post('/admin/users').set(asUser(admin)).send(body);
  const put = (id: number, body: object) => request(app).put(`/admin/users/${id}`).set(asUser(admin)).send(body);

  it('rejects an unknown role on create and creates no user', async () => {
    const body = { ...person(), role: 'monitor' };
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/role must be one of: admin, national, county, subcounty, facility_admin, staff/);
    expect(query('SELECT id FROM users WHERE email = ?', [body.email])).toHaveLength(0);
  });

  it('rejects an unknown role on update', async () => {
    const u = createUser();
    expect((await put(u, { role: 'monitor' })).status).toBe(400);
    expect(roleOf(u)).toBe('staff');
  });

  it('creates a national user with no placement, and rejects one with a facility', async () => {
    const res = await post({ ...person(), role: 'national' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'national', facility_id: null, region_ids: [], district_ids: [] });
    expect((await post({ ...person(), role: 'national', facility_id: fac })).status).toBe(400);
  });

  describe('county coordinator', () => {
    it('is created with exactly one region', async () => {
      const res = await post({ ...person(), role: 'county', region_ids: [dsm] });
      expect(res.status).toBe(201);
      expect(res.body.user.region_ids).toEqual([dsm]);
      expect(res.body.user.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }]);
    });

    it('needs exactly one known region', async () => {
      expect((await post({ ...person(), role: 'county' })).status).toBe(400);
      expect((await post({ ...person(), role: 'county', region_ids: [] })).status).toBe(400);
      const two = await post({ ...person(), role: 'county', region_ids: [dsm, mwz] });
      expect(two.status).toBe(400);
      expect(JSON.stringify(two.body)).toMatch(/Region coordinators need exactly one region/);
      expect((await post({ ...person(), role: 'county', region_ids: [99999] })).status).toBe(400);
    });

    it('cannot have a facility or districts', async () => {
      expect((await post({ ...person(), role: 'county', region_ids: [dsm], facility_id: fac })).status).toBe(400);
      expect((await post({ ...person(), role: 'county', region_ids: [dsm], district_ids: [tmk] })).status).toBe(400);
    });

    it('does not create the user when validation fails', async () => {
      const p = person();
      await post({ ...p, role: 'county', region_ids: [99999] });
      expect(query('SELECT id FROM users WHERE email = ?', [p.email])).toHaveLength(0);
    });

    it('replaces the region on update and keeps it when omitted', async () => {
      const id = (await post({ ...person(), role: 'county', region_ids: [dsm] })).body.user.id;
      const updated = await put(id, { region_ids: [mwz] });
      expect(updated.status).toBe(200);
      expect(updated.body.user.region_ids).toEqual([mwz]);
      const renamed = await put(id, { first_name: 'Renamed' });
      expect(renamed.body.user.region_ids).toEqual([mwz]);
    });

    it('clears the region when the user becomes staff', async () => {
      const id = (await post({ ...person(), role: 'county', region_ids: [dsm] })).body.user.id;
      const res = await put(id, { role: 'staff', facility_id: fac });
      expect(res.status).toBe(200);
      expect(res.body.user.region_ids).toEqual([]);
      expect(query('SELECT * FROM user_regions WHERE user_id = ?', [id])).toHaveLength(0);
    });

    it('requires clearing the facility when a staff user becomes a county coordinator', async () => {
      const staff = createUser({ facilityId: fac });
      expect((await put(staff, { role: 'county', region_ids: [dsm] })).status).toBe(400);
      expect((await put(staff, { role: 'county', region_ids: [dsm], facility_id: null })).status).toBe(200);
    });
  });

  describe('sub-county coordinator', () => {
    it('is created with exactly one district', async () => {
      const res = await post({ ...person(), role: 'subcounty', district_ids: [tmk] });
      expect(res.status).toBe(201);
      expect(res.body.user.district_ids).toEqual([tmk]);
      expect(res.body.user.districts).toEqual([{ id: tmk, name: 'Temeke', region_id: dsm }]);
      expect(res.body.user.region_ids).toEqual([]);
    });

    it('needs exactly one known district and no region or facility', async () => {
      expect((await post({ ...person(), role: 'subcounty' })).status).toBe(400);
      expect((await post({ ...person(), role: 'subcounty', district_ids: [tmk, nya] })).status).toBe(400);
      expect((await post({ ...person(), role: 'subcounty', district_ids: [99999] })).status).toBe(400);
      expect((await post({ ...person(), role: 'subcounty', district_ids: [tmk], region_ids: [dsm] })).status).toBe(400);
      expect((await post({ ...person(), role: 'subcounty', district_ids: [tmk], facility_id: fac })).status).toBe(400);
    });

    it('keeps the district when omitted on update and clears it on a role change', async () => {
      const id = (await post({ ...person(), role: 'subcounty', district_ids: [tmk] })).body.user.id;
      expect((await put(id, { first_name: 'Renamed' })).body.user.district_ids).toEqual([tmk]);
      const res = await put(id, { role: 'county', region_ids: [dsm] });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ role: 'county', region_ids: [dsm], district_ids: [] });
      expect(query('SELECT * FROM user_districts WHERE user_id = ?', [id])).toHaveLength(0);
    });
  });

  it('rejects regions or districts on facility roles', async () => {
    expect((await post({ ...person(), role: 'staff', region_ids: [dsm] })).status).toBe(400);
    expect((await post({ ...person(), role: 'staff', district_ids: [tmk] })).status).toBe(400);
    expect((await post({ ...person(), role: 'facility_admin', facility_id: fac, region_ids: [dsm] })).status).toBe(400);
  });

  it('requires a facility for a facility admin, but not for staff', async () => {
    const res = await post({ ...person(), role: 'facility_admin' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Facility admins need a facility/);
    expect((await post({ ...person(), role: 'facility_admin', facility_id: fac })).status).toBe(201);
    expect((await post({ ...person(), role: 'staff' })).status).toBe(201);
  });

  it('lists users with their regions and districts', async () => {
    const c = createCounty(dsm);
    const s = createSubcounty(tmk);
    const res = await request(app).get('/admin/users').set(asUser(admin));
    const find = (id: number) => res.body.users.find((u: { id: number }) => u.id === id);
    expect(find(c).regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }]);
    expect(find(s).district_ids).toEqual([tmk]);
    expect(find(admin)).toMatchObject({ region_ids: [], district_ids: [] });
  });

  it('blocks deleting a region assigned to a county coordinator', async () => {
    const bare = createRegion('ARU', 'Arusha');
    createCounty(bare);
    const res = await request(app).delete(`/admin/regions/${bare}`).set(asUser(admin));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/region coordinator is still assigned/);
  });

  it('blocks deleting a district assigned to a sub-county coordinator', async () => {
    const bare = createDistrict('ILA', 'Ilala', dsm);
    createSubcounty(bare);
    const res = await request(app).delete(`/admin/districts/${bare}`).set(asUser(admin));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/district coordinator is still assigned/);
  });
});

// Facility admins manage staff and facility admins in their own facility only.
describe('facility admin: user management limits', () => {
  let fadmin: number, f1: number, f2: number, staff1: number, staff2: number, otherAdmin1: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    f2 = createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    fadmin = createUser({ role: 'facility_admin', facilityId: f1 });
    otherAdmin1 = createUser({ role: 'facility_admin', facilityId: f1 });
    staff1 = createUser({ facilityId: f1 });
    staff2 = createUser({ facilityId: f2 });
    createUser({ role: 'admin', facilityId: f1 }); // a system admin placed in the facility
    createSubcounty(tmk);
  });

  const as = () => asUser(fadmin);
  const post = (body: object) => request(app).post('/admin/users').set(as()).send(body);
  const put = (id: number, body: object) => request(app).put(`/admin/users/${id}`).set(as()).send(body);

  it('lists only staff and facility admins in its facility', async () => {
    const res = await request(app).get('/admin/users').set(as());
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u: { id: number }) => u.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([fadmin, otherAdmin1, staff1].sort((a, b) => a - b));
  });

  it('creates staff and facility admins, always in its own facility', async () => {
    const staff = await post({ ...person(), role: 'staff' });
    expect(staff.status).toBe(201);
    expect(staff.body.user.facility_id).toBe(f1);
    const fa = await post({ ...person(), role: 'facility_admin', facility_id: f1 });
    expect(fa.status).toBe(201);
    expect(fa.body.user).toMatchObject({ role: 'facility_admin', facility_id: f1 });
  });

  it('cannot create other roles or users in another facility', async () => {
    for (const role of ['admin', 'national', 'county', 'subcounty']) {
      const p = person();
      expect((await post({ ...p, role })).status, role).toBe(403);
      expect(query('SELECT id FROM users WHERE email = ?', [p.email]), role).toHaveLength(0);
    }
    expect((await post({ ...person(), role: 'staff', facility_id: f2 })).status).toBe(403);
  });

  it('edits details of users in its facility', async () => {
    const res = await put(staff1, { first_name: 'Renamed', email: 'renamed@example.test' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ first_name: 'Renamed', email: 'renamed@example.test' });
    expect((await put(staff1, { role: 'facility_admin' })).status).toBe(200);
  });

  it('cannot edit users outside its facility or with other roles', async () => {
    expect((await put(staff2, { first_name: 'X' })).status).toBe(403);
    const admins = query<{ id: number }>("SELECT id FROM users WHERE role IN ('admin', 'subcounty')");
    for (const { id } of admins) expect((await put(id, { first_name: 'X' })).status).toBe(403);
  });

  it('cannot move a user, give another role, or enable/disable', async () => {
    expect((await put(staff1, { facility_id: f2 })).status).toBe(403);
    expect((await put(staff1, { role: 'county' })).status).toBe(403);
    expect((await put(staff1, { is_enabled: false })).status).toBe(403);
    expect(roleOf(staff1)).toBe('staff');
  });

  it('cannot change its own role but can edit its own details', async () => {
    const res = await put(fadmin, { role: 'staff' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/cannot change your own role/);
    expect((await put(fadmin, { first_name: 'Me' })).status).toBe(200);
  });

  it('resets passwords in its facility only', async () => {
    const ok = await request(app).post(`/admin/users/${staff1}/reset-password`).set(as());
    expect(ok.status).toBe(200);
    expect(ok.body.temp_password).toBeTruthy();
    expect((await request(app).post(`/admin/users/${staff2}/reset-password`).set(as())).status).toBe(403);
  });

  it('staff and coordinators cannot manage users at all', async () => {
    const sub = query<{ id: number }>("SELECT id FROM users WHERE role = 'subcounty'")[0].id;
    for (const id of [staff1, sub]) {
      expect((await request(app).get('/admin/users').set(asUser(id))).status).toBe(403);
      expect((await request(app).post('/admin/users').set(asUser(id)).send({ ...person(), role: 'staff' })).status).toBe(403);
    }
  });
});

describe('auth: /me exposes regions and districts', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('returns the region for a county coordinator', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const c = createCounty(dsm);
    const res = await request(app).get('/auth/me').set(asUser(c));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ region_ids: [dsm], regions: [{ id: dsm, name: 'Dar es Salaam' }], district_ids: [] });
  });

  it('returns the district for a sub-county coordinator', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const s = createSubcounty(tmk);
    const res = await request(app).get('/auth/me').set(asUser(s));
    expect(res.body.user).toMatchObject({ district_ids: [tmk], districts: [{ id: tmk, name: 'Temeke', region_id: dsm }] });
  });

  it('returns empty placements for staff', async () => {
    const s = createUser();
    const res = await request(app).get('/auth/me').set(asUser(s));
    expect(res.body.user).toMatchObject({ region_ids: [], district_ids: [] });
  });
});
