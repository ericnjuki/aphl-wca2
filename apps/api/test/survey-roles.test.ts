import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility,
  createCounty, createSubcounty,
} from './helpers';

const app = testApp();
const session = { domain_code: 'LAB', domain_name: 'Lab' };

// Only facility-placed roles (facility_admin, staff) take assessments.
describe('who takes assessments', () => {
  let nonTakers: Record<string, number>, staff: number, fadmin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    nonTakers = {
      admin: createUser({ role: 'admin' }),
      national: createUser({ role: 'national' }),
      county: createCounty(dsm),
      subcounty: createSubcounty(tmk),
    };
    staff = createUser({ facilityId: f });
    fadmin = createUser({ role: 'facility_admin', facilityId: f });
  });

  it('non-taker roles cannot start a session', async () => {
    for (const [role, id] of Object.entries(nonTakers)) {
      const res = await request(app).post('/survey/sessions').set(asUser(id)).send(session);
      expect(res.status, role).toBe(403);
      expect(JSON.stringify(res.body), role).toMatch(/does not take assessments/);
    }
  });

  it('non-taker roles cannot save or complete a session', async () => {
    const created = await request(app).post('/survey/sessions').set(asUser(staff)).send(session);
    const id = created.body.session.id;
    for (const [role, uid] of Object.entries(nonTakers)) {
      const put = await request(app).put(`/survey/sessions/${id}`).set(asUser(uid)).send({ survey_data: '{}' });
      expect(put.status, role).toBe(403);
      const done = await request(app).post(`/survey/sessions/${id}/complete`).set(asUser(uid)).send({ survey_data: '{}' });
      expect(done.status, role).toBe(403);
    }
  });

  it('staff and facility admins can start a session', async () => {
    expect((await request(app).post('/survey/sessions').set(asUser(staff)).send(session)).status).toBe(201);
    expect((await request(app).post('/survey/sessions').set(asUser(fadmin)).send(session)).status).toBe(201);
  });

  it('non-taker roles get empty lists', async () => {
    for (const [role, id] of Object.entries(nonTakers)) {
      const sessions = await request(app).get('/survey/sessions').set(asUser(id));
      expect(sessions.status, role).toBe(200);
      expect(sessions.body.sessions, role).toEqual([]);
      const mine = await request(app).get('/my-assessments').set(asUser(id));
      expect(mine.status, role).toBe(200);
      expect(mine.body.assessments, role).toEqual([]);
    }
  });
});
