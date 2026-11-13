import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, assignRegions,
} from './helpers';

const app = testApp();

let n = 0;
const person = () => {
  n++;
  return { first_name: 'Pat', last_name: `Partner${n}`, national_id: `P${n}`, id_type: 'NIN', email: `p${n}@ngo.test` };
};

describe('admin: partner (monitor) users', () => {
  let admin: number, dsm: number, mwz: number, fac: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    fac = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: createDistrict('TMK', 'Temeke', dsm) });
  });

  const post = (body: object) => request(app).post('/admin/users').set(asUser(admin)).send(body);
  const put = (id: number, body: object) => request(app).put(`/admin/users/${id}`).set(asUser(admin)).send(body);

  it('rejects an unknown role on create and creates no user', async () => {
    const body = { ...person(), role: 'Monitor' };
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/role must be one of: staff, admin, monitor/);
    expect(query('SELECT id FROM users WHERE email = ?', [body.email])).toHaveLength(0);
  });

  it('rejects an unknown role on update', async () => {
    const u = createUser();
    const res = await put(u, { role: 'Monitor' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/role must be one of: staff, admin, monitor/);
    expect(query<{ role: string }>('SELECT role FROM users WHERE id = ?', [u])[0].role).toBe('staff');
  });

  it('creates a monitor with regions', async () => {
    const res = await post({ ...person(), role: 'monitor', region_ids: [mwz, dsm] });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('monitor');
    expect(res.body.user.region_ids).toEqual([dsm, mwz]);
    expect(res.body.user.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }, { id: mwz, name: 'Mwanza' }]);
  });

  it('rejects a monitor without regions', async () => {
    expect((await post({ ...person(), role: 'monitor', region_ids: [] })).status).toBe(400);
    expect((await post({ ...person(), role: 'monitor' })).status).toBe(400);
  });

  it('rejects a monitor with a facility', async () => {
    expect((await post({ ...person(), role: 'monitor', region_ids: [dsm], facility_id: fac })).status).toBe(400);
  });

  it('rejects an unknown region', async () => {
    expect((await post({ ...person(), role: 'monitor', region_ids: [99999] })).status).toBe(400);
  });

  it('rejects regions on a staff user', async () => {
    expect((await post({ ...person(), role: 'staff', region_ids: [dsm] })).status).toBe(400);
  });

  it('does not create the user when validation fails', async () => {
    const p = person();
    await post({ ...p, role: 'monitor', region_ids: [99999] });
    expect(query('SELECT id FROM users WHERE email = ?', [p.email])).toHaveLength(0);
  });

  it('replaces regions on update and keeps them when omitted', async () => {
    const created = await post({ ...person(), role: 'monitor', region_ids: [dsm] });
    const id = created.body.user.id;
    const updated = await put(id, { region_ids: [mwz] });
    expect(updated.status).toBe(200);
    expect(updated.body.user.region_ids).toEqual([mwz]);
    const renamed = await put(id, { first_name: 'Renamed' });
    expect(renamed.body.user.region_ids).toEqual([mwz]);
  });

  it('clears regions when a monitor becomes staff', async () => {
    const created = await post({ ...person(), role: 'monitor', region_ids: [dsm] });
    const id = created.body.user.id;
    const res = await put(id, { role: 'staff', facility_id: fac });
    expect(res.status).toBe(200);
    expect(res.body.user.region_ids).toEqual([]);
    expect(query('SELECT * FROM user_regions WHERE user_id = ?', [id])).toHaveLength(0);
  });

  it('requires clearing the facility when a staff user becomes a monitor', async () => {
    const staff = createUser({ facilityId: fac });
    expect((await put(staff, { role: 'monitor', region_ids: [dsm] })).status).toBe(400);
    expect((await put(staff, { role: 'monitor', region_ids: [dsm], facility_id: null })).status).toBe(200);
  });

  it('lists users with their regions', async () => {
    const m = createUser({ role: 'monitor' });
    assignRegions(m, [dsm]);
    const res = await request(app).get('/admin/users').set(asUser(admin));
    const row = res.body.users.find((u: { id: number }) => u.id === m);
    expect(row.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }]);
    const adminRow = res.body.users.find((u: { id: number }) => u.id === admin);
    expect(adminRow.region_ids).toEqual([]);
  });

  it('blocks deleting a region assigned to a partner user', async () => {
    const bare = createRegion('ARU', 'Arusha');
    const m = createUser({ role: 'monitor' });
    assignRegions(m, [bare]);
    const res = await request(app).delete(`/admin/regions/${bare}`).set(asUser(admin));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/partner user is still assigned/);
  });
});

describe('auth: /me exposes regions', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('returns regions for a monitor', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const m = createUser({ role: 'monitor' });
    assignRegions(m, [dsm]);
    const res = await request(app).get('/auth/me').set(asUser(m));
    expect(res.status).toBe(200);
    expect(res.body.user.region_ids).toEqual([dsm]);
    expect(res.body.user.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }]);
  });

  it('returns empty regions for staff', async () => {
    const s = createUser();
    const res = await request(app).get('/auth/me').set(asUser(s));
    expect(res.body.user.region_ids).toEqual([]);
  });
});
