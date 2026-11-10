import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import { requireAuth } from '../src/middleware/auth';
import { initTestDb, resetDb, testApp, asUser, createUser } from './helpers';

const app = testApp();

describe('requireAuth and disabled users', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('rejects a logged-in user who has since been disabled', async () => {
    const id = createUser({ role: 'admin' });
    expect((await request(app).get('/admin/users').set(asUser(id))).status).toBe(200);

    execute('UPDATE users SET is_enabled = 0 WHERE id = ?', [id]);
    const res = await request(app).get('/admin/users').set(asUser(id));
    expect(res.status).toBe(401);
    expect(res.body.error ?? res.body.message).toMatch(/disabled/i);
  });

  it('rejects a session whose user no longer exists', async () => {
    const id = createUser({ role: 'admin' });
    execute('DELETE FROM users WHERE id = ?', [id]);
    const res = await request(app).get('/admin/users').set(asUser(id));
    expect(res.status).toBe(401);
  });

  it('leaves enabled users unaffected', async () => {
    const id = createUser({ role: 'staff' });
    const res = await request(app).get('/my-assessments').set(asUser(id));
    expect(res.status).not.toBe(401);
  });

  it('destroys the session when the user is disabled', () => {
    const id = createUser({ enabled: false });
    const destroy = vi.fn((cb?: (err?: unknown) => void) => cb?.());
    const next = vi.fn();
    requireAuth({ session: { userId: id, destroy } } as never, {} as never, next);
    expect(destroy).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });
});
