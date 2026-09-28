import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility, createUser,
} from './helpers';

const app = testApp();

describe('/admin/districts', () => {
  let admin: number;
  let dsm: number;
  let mwz: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
  });

  it('lists districts with region name and facility count', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    createFacility('F1', 'Fac', { regionId: dsm, districtId: d });
    const res = await request(app).get('/admin/districts').set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.districts).toEqual([
      expect.objectContaining({ id: d, code: 'TMK', name: 'Temeke', region_id: dsm, region_name: 'Dar es Salaam', facility_count: 1 }),
    ]);
  });

  it('creates a district (code upper-cased) and requires a real region', async () => {
    const ok = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'tmk', name: 'Temeke', region_id: dsm });
    expect(ok.status).toBe(201);
    expect(ok.body.district).toMatchObject({ code: 'TMK', region_id: dsm });

    const noRegion = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'X', name: 'X' });
    expect(noRegion.status).toBe(400);

    const badRegion = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'Y', name: 'Y', region_id: 99999 });
    expect(badRegion.status).toBe(400);

    const dup = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'TMK', name: 'Again', region_id: dsm });
    expect(dup.status).toBe(409);
  });

  it('rejects non-admins', async () => {
    const staff = createUser();
    const res = await request(app).post('/admin/districts').set(asUser(staff))
      .send({ code: 'TMK', name: 'Temeke', region_id: dsm });
    expect(res.status).toBe(403);
  });

  it('moving a district to another region moves its facilities (invariant 2)', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    const f = createFacility('F1', 'Fac', { regionId: dsm, districtId: d });
    const res = await request(app).put(`/admin/districts/${d}`).set(asUser(admin)).send({ region_id: mwz });
    expect(res.status).toBe(200);
    expect(res.body.district.region_id).toBe(mwz);
    expect(query<{ region_id: number }>('SELECT region_id FROM facilities WHERE id = ?', [f])[0].region_id).toBe(mwz);
  });

  it('rejects updating a district with an empty name', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    const res = await request(app).put(`/admin/districts/${d}`).set(asUser(admin)).send({ name: '' });
    expect(res.status).toBe(400);
    expect(query<{ name: string }>('SELECT name FROM districts WHERE id = ?', [d])[0].name).toBe('Temeke');
  });

  it('refuses to delete a district that still has facilities (invariant 3)', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    createFacility('F1', 'Fac', { regionId: dsm, districtId: d });
    const blocked = await request(app).delete(`/admin/districts/${d}`).set(asUser(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('1 facility is still assigned to this district');

    const empty = createDistrict('ILA', 'Ilala', dsm);
    const ok = await request(app).delete(`/admin/districts/${empty}`).set(asUser(admin));
    expect(ok.status).toBe(200);
  });

  it('refuses to delete a region that still has districts (invariant 4)', async () => {
    createDistrict('TMK', 'Temeke', dsm);
    const blocked = await request(app).delete(`/admin/regions/${dsm}`).set(asUser(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('1 district is still assigned to this region');

    const ok = await request(app).delete(`/admin/regions/${mwz}`).set(asUser(admin));
    expect(ok.status).toBe(200);
  });

  it('imports districts from CSV and reports skipped rows with reasons', async () => {
    createDistrict('TMK', 'Temeke', dsm);
    const csv = [
      'district_code,district_name,region_code',
      'ila,Ilala,dsm',
      'NYA,Nyamagana,MWZ',
      'XXX,Nowhere,ZZZ',
      'TMK,Temeke again,DSM',
      ',Missing code,DSM',
    ].join('\n');
    const res = await request(app).post('/admin/districts/import').set(asUser(admin)).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imported: 2,
      skipped: 3,
      errors: [
        { row: 4, reason: 'Unknown region_code "ZZZ"' },
        { row: 5, reason: 'District code "TMK" already exists' },
        { row: 6, reason: 'district_code, district_name and region_code are required' },
      ],
    });
  });

  it('rejects an import missing required columns', async () => {
    const res = await request(app).post('/admin/districts/import').set(asUser(admin))
      .send({ csv: 'district_code,district_name\nA,B' });
    expect(res.status).toBe(400);
  });
});
