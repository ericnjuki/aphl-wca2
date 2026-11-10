import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { initTestDb, resetDb, testApp, asUser, createUser } from './helpers';

const app = testApp();

describe('the CSV import endpoints are gone', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
  });

  it.each([
    '/admin/regions/import',
    '/admin/districts/import',
    '/admin/departments/import',
    '/admin/facilities/import',
    '/admin/org-roles/import',
    '/admin/user-titles/import',
    '/admin/users/import',
    '/assessments/domains/import',
    '/assessments/domains/1/items/import',
    '/assessments/domains/1/footnotes/import',
    '/assessments/footnotes/import',
  ])('POST %s → 404', async (path) => {
    const res = await request(app).post(path).set(asUser(admin)).send({ csv: 'a,b\n1,2' });
    expect(res.status).toBe(404);
  });
});
