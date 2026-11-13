import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { initTestDb, resetDb, testApp, asUser, createUser, createRegion, assignRegions } from './helpers';

const app = testApp();
const session = { domain_code: 'LAB', domain_name: 'Lab' };

describe('monitors and the survey', () => {
  let monitor: number, staff: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    monitor = createUser({ role: 'monitor' });
    assignRegions(monitor, [createRegion('DSM', 'Dar es Salaam')]);
    staff = createUser();
  });

  it('a monitor cannot start a session', async () => {
    const res = await request(app).post('/survey/sessions').set(asUser(monitor)).send(session);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/do not take assessments/);
  });

  it('a monitor cannot save or complete a session', async () => {
    const created = await request(app).post('/survey/sessions').set(asUser(staff)).send(session);
    const id = created.body.session.id;
    expect((await request(app).put(`/survey/sessions/${id}`).set(asUser(monitor)).send({ survey_data: '{}' })).status).toBe(403);
    expect((await request(app).post(`/survey/sessions/${id}/complete`).set(asUser(monitor)).send({ survey_data: '{}' })).status).toBe(403);
  });

  it('staff can still start a session', async () => {
    const res = await request(app).post('/survey/sessions').set(asUser(staff)).send(session);
    expect(res.status).toBe(201);
  });

  it('a monitor gets empty lists', async () => {
    const sessions = await request(app).get('/survey/sessions').set(asUser(monitor));
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions).toEqual([]);
    const mine = await request(app).get('/my-assessments').set(asUser(monitor));
    expect(mine.status).toBe(200);
    expect(mine.body.assessments).toEqual([]);
  });
});
