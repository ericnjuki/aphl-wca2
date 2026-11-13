import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query, execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility,
  createCounty, createSubcounty, addResponse,
} from './helpers';

const app = testApp();

const submissionOf = (userId: number) =>
  query<{ id: number }>('SELECT id FROM user_assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId])[0].id;
const statusOf = (id: number) =>
  query<{ review_status: string }>('SELECT review_status FROM user_assessments WHERE id = ?', [id])[0].review_status;

// Review scoping (plans/2026-11-12-role-model.md → Backend step 5).
describe('review queue per role', () => {
  let admin: number, sub: number, fadmin: number, fadmin2: number;
  let staffTmk: number, staffTmk2: number, staffIla: number;
  let sTmk: number, sTmk2: number, sIla: number, sFadmin: number, sFadmin2: number;
  let tmk: number, dsm: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    const ila = createDistrict('ILA', 'Ilala', dsm);
    const fTmk = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const fTmk2 = createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    const fIla = createFacility('F3', 'Ilala Clinic', { regionId: dsm, districtId: ila });

    admin = createUser({ role: 'admin' });
    sub = createSubcounty(tmk);
    fadmin = createUser({ role: 'facility_admin', facilityId: fTmk });
    fadmin2 = createUser({ role: 'facility_admin', facilityId: fTmk });
    staffTmk = createUser({ facilityId: fTmk });
    staffTmk2 = createUser({ facilityId: fTmk2 });
    staffIla = createUser({ facilityId: fIla });

    const submit = (userId: number, facilityId: number, districtId: number) => {
      addResponse({ userId, facilityId, regionId: dsm, districtId, reviewStatus: 'pending' });
      return submissionOf(userId);
    };
    sTmk = submit(staffTmk, fTmk, tmk);
    sTmk2 = submit(staffTmk2, fTmk2, tmk);
    sIla = submit(staffIla, fIla, ila);
    sFadmin = submit(fadmin, fTmk, tmk);
    sFadmin2 = submit(fadmin2, fTmk, tmk);
  });

  const list = async (userId: number) => {
    const res = await request(app).get('/admin/reviews').set(asUser(userId));
    expect(res.status).toBe(200);
    return res.body.reviews.map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b);
  };
  const sorted = (...ids: number[]) => ids.sort((a, b) => a - b);
  const approve = (userId: number, id: number) => request(app).post(`/admin/reviews/${id}/approve`).set(asUser(userId)).send({});

  it('admin sees every submission', async () => {
    expect(await list(admin)).toEqual(sorted(sTmk, sTmk2, sIla, sFadmin, sFadmin2));
  });

  it('a sub-county coordinator sees submissions from facilities in its sub-county', async () => {
    expect(await list(sub)).toEqual(sorted(sTmk, sTmk2, sFadmin, sFadmin2));
  });

  it('a facility admin sees submissions from its own facility, its own included', async () => {
    expect(await list(fadmin)).toEqual(sorted(sTmk, sFadmin, sFadmin2));
  });

  it('scopes by the submitter\'s current facility', async () => {
    const fIla = query<{ id: number }>("SELECT id FROM facilities WHERE code = 'F3'")[0].id;
    execute('UPDATE users SET facility_id = ? WHERE id = ?', [fIla, staffTmk]);
    expect(await list(sub)).not.toContain(sTmk);
    expect(await list(fadmin)).not.toContain(sTmk);
  });

  it('staff, national and county users have no review queue', async () => {
    for (const id of [staffTmk, createUser({ role: 'national' }), createCounty(dsm)]) {
      expect((await request(app).get('/admin/reviews').set(asUser(id))).status).toBe(403);
      expect((await approve(id, sTmk)).status).toBe(403);
    }
    expect(statusOf(sTmk)).toBe('pending');
  });

  it('reviewers approve and reject inside their scope', async () => {
    expect((await approve(sub, sTmk2)).status).toBe(200);
    expect(statusOf(sTmk2)).toBe('approved');
    const rejected = await request(app).post(`/admin/reviews/${sTmk}/reject`).set(asUser(fadmin)).send({ notes: 'Redo' });
    expect(rejected.status).toBe(200);
    expect(statusOf(sTmk)).toBe('rejected');
  });

  it('a facility admin may review another facility admin in its facility', async () => {
    expect((await approve(fadmin, sFadmin2)).status).toBe(200);
  });

  it('nobody reviews their own submission', async () => {
    const res = await approve(fadmin, sFadmin);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/cannot review your own submission/);
    expect(statusOf(sFadmin)).toBe('pending');
  });

  it('a submission outside the caller\'s scope is not found', async () => {
    expect((await approve(sub, sIla)).status).toBe(404);
    expect((await approve(fadmin, sTmk2)).status).toBe(404);
    expect((await request(app).get(`/admin/reviews/${sIla}`).set(asUser(sub))).status).toBe(404);
    expect(statusOf(sIla)).toBe('pending');
    expect(statusOf(sTmk2)).toBe('pending');
  });

  it('the detail view returns the submission and its answers', async () => {
    const res = await request(app).get(`/admin/reviews/${sTmk}`).set(asUser(sub));
    expect(res.status).toBe(200);
    expect(res.body.assessment).toMatchObject({ id: sTmk, user_id: staffTmk, review_status: 'pending', facility_name: 'Temeke Hospital' });
    expect(res.body.subcompetencies).toHaveLength(1);
    expect(res.body.subcompetencies[0]).toMatchObject({ competency_value: '1', subcompetency_value: '1.01', response_level: 2 });
  });

  it('rejection still needs notes', async () => {
    expect((await request(app).post(`/admin/reviews/${sTmk}/reject`).set(asUser(sub)).send({})).status).toBe(400);
  });
});
