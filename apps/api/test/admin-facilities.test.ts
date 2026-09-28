import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility, createUser, addResponse,
} from './helpers';

const app = testApp();

describe('/admin/facilities with districts', () => {
  let admin: number, dsm: number, mwz: number, tmk: number, nya: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    nya = createDistrict('NYA', 'Nyamagana', mwz);
  });

  it('requires a valid district on create and derives region from it', async () => {
    const missing = await request(app).post('/admin/facilities').set(asUser(admin)).send({ code: 'F1', name: 'Fac' });
    expect(missing.status).toBe(400);

    const res = await request(app).post('/admin/facilities').set(asUser(admin))
      .send({ code: 'F1', name: 'Fac', district_id: tmk, region_id: mwz /* ignored */ });
    expect(res.status).toBe(201);
    expect(res.body.facility).toMatchObject({ district_id: tmk, region_id: dsm });
  });

  it('on update, requires a district, derives region and back-fills NULL response districts', async () => {
    const f = createFacility('F1', 'Fac', { regionId: dsm }); // legacy: no district
    const u = createUser({ facilityId: f });
    const resp = addResponse({ userId: u, facilityId: f, regionId: dsm });

    const noDistrict = await request(app).put(`/admin/facilities/${f}`).set(asUser(admin)).send({ name: 'Renamed' });
    expect(noDistrict.status).toBe(400);

    const ok = await request(app).put(`/admin/facilities/${f}`).set(asUser(admin)).send({ district_id: nya });
    expect(ok.status).toBe(200);
    expect(ok.body.facility).toMatchObject({ district_id: nya, region_id: mwz });
    expect(query<{ district_id: number }>('SELECT district_id FROM user_assessment_responses WHERE id = ?', [resp])[0].district_id).toBe(nya);
  });

  it('lists district_id and district_name', async () => {
    createFacility('F1', 'Fac', { regionId: dsm, districtId: tmk });
    const res = await request(app).get('/admin/facilities').set(asUser(admin));
    expect(res.body.facilities[0]).toMatchObject({ district_id: tmk, district_name: 'Temeke', region_name: 'Dar es Salaam' });
  });

  it('imports new facilities, updates districts of existing codes, and explains skips', async () => {
    const legacy = createFacility('OLD', 'Legacy Hospital', { regionId: dsm });
    const u = createUser({ facilityId: legacy });
    const resp = addResponse({ userId: u, facilityId: legacy, regionId: dsm });

    const csv = [
      'facility_code,facility_name,facility_type,district_code,region_code',
      'NEW1,New One,Hospital,TMK,DSM',
      'OLD,Ignored Name,Ignored,NYA,',
      'BAD1,Mismatch,,TMK,MWZ',
      'BAD2,No district,,,DSM',
      'BAD3,Unknown district,,ZZZ,',
    ].join('\n');
    const res = await request(app).post('/admin/facilities/import').set(asUser(admin)).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imported: 1,
      updated: 1,
      skipped: 3,
      errors: [
        { row: 4, reason: 'region_code "MWZ" does not match district TMK (region DSM)' },
        { row: 5, reason: 'facility_code, facility_name and district_code are required' },
        { row: 6, reason: 'Unknown district_code "ZZZ"' },
      ],
    });

    const [created] = query('SELECT * FROM facilities WHERE code = ?', ['NEW1']);
    expect(created).toMatchObject({ name: 'New One', facility_type: 'Hospital', district_id: tmk, region_id: dsm });
    const [updated] = query('SELECT * FROM facilities WHERE id = ?', [legacy]);
    expect(updated).toMatchObject({ name: 'Legacy Hospital', district_id: nya, region_id: mwz });
    expect(query<{ district_id: number }>('SELECT district_id FROM user_assessment_responses WHERE id = ?', [resp])[0].district_id).toBe(nya);
  });

  it('rejects an import without district_code column', async () => {
    const res = await request(app).post('/admin/facilities/import').set(asUser(admin))
      .send({ csv: 'facility_code,facility_name\nA,B' });
    expect(res.status).toBe(400);
  });
});
