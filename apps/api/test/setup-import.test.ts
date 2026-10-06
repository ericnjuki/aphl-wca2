import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { query, execute } from '../src/db/database';
import { XLSX_MIME, MAX_WORKBOOK_BYTES } from '../src/lib/workbook/xlsx';
import { applySetupOps } from '../src/lib/workbook/setup-apply';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  addResponse, buildWorkbook, USERS_HEADER, userSheetRow,
} from './helpers';

const app = testApp();

const REGIONS = ['region_code', 'region_name'];
const DISTRICTS = ['district_code', 'district_name', 'region_code'];
const FACILITIES = ['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes'];

describe('country setup import endpoints', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin', email: 'boss@example.test' });
  });

  const preview = (buf: Buffer, user = admin) =>
    request(app).post('/admin/setup/import/preview').set(asUser(user)).set('Content-Type', XLSX_MIME).send(buf);
  const apply = (buf: Buffer, fingerprint: string, user = admin) =>
    request(app).post(`/admin/setup/import/apply?fingerprint=${fingerprint}`).set(asUser(user))
      .set('Content-Type', XLSX_MIME).send(buf);

  const country = () => buildWorkbook({
    Regions: [REGIONS, ['DSM', 'Dar es Salaam'], ['MWZ', 'Mwanza']],
    Districts: [DISTRICTS, ['TMK', 'Temeke', 'DSM'], ['NYA', 'Nyamagana', 'MWZ']],
    Departments: [['department_code', 'department_name'], ['LAB', 'Laboratory'], ['MIC', 'Microbiology']],
    Facilities: [FACILITIES, ['F1', 'Temeke Hospital', 'Hospital', 'TMK', 'LAB; MIC'], ['F2', 'Mwanza Clinic', '', 'NYA', 'LAB']],
    'Org Roles': [['role_code', 'role_name'], ['MLS', 'Medical Laboratory Scientist']],
    'Job Titles': [['title_code', 'title_name'], ['DR', 'Dr.']],
    Users: [
      USERS_HEADER,
      userSheetRow(admin),
      ['amina@example.test', 'Amina', 'Hassan', '111', 'NRC', 'staff', 'F1', 'MIC', 'MLS', 'DR', '', ''],
      ['pat@ngo.test', 'Pat', 'Partner', '222', 'Passport', 'monitor', '', '', '', '', 'DSM;MWZ', ''],
    ],
  });

  it('previews without changing anything', async () => {
    const res = await preview(await country());
    expect(res.status).toBe(200);
    expect(res.body.plan.canApply).toBe(true);
    expect(res.body.plan.tabs.map((t: { tab: string; counts: { added: number } }) => [t.tab, t.counts.added])).toEqual([
      ['Regions', 2], ['Districts', 2], ['Departments', 2], ['Facilities', 2], ['Org Roles', 1], ['Job Titles', 1], ['Users', 2],
    ]);
    expect(query('SELECT id FROM regions')).toHaveLength(0);
    expect(query('SELECT id FROM users')).toHaveLength(1);
  });

  it('applies the whole workbook and returns credentials for new users only', async () => {
    const buf = await country();
    const { body } = await preview(buf);
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(200);

    const [f1] = query<Record<string, unknown>>(
      `SELECT f.name, f.facility_type, d.code AS district_code, r.code AS region_code
       FROM facilities f JOIN districts d ON d.id = f.district_id JOIN regions r ON r.id = f.region_id
       WHERE f.code = 'F1'`,
    );
    expect(f1).toEqual({ name: 'Temeke Hospital', facility_type: 'Hospital', district_code: 'TMK', region_code: 'DSM' });
    expect(query<{ code: string }>(
      `SELECT dp.code FROM facility_departments fd
       JOIN departments dp ON dp.id = fd.department_id JOIN facilities f ON f.id = fd.facility_id
       WHERE f.code = 'F1' ORDER BY dp.code`,
    ).map((r) => r.code)).toEqual(['LAB', 'MIC']);

    expect(res.body.credentials).toHaveLength(2);
    const amina = res.body.credentials.find((c: { email: string }) => c.email === 'amina@example.test');
    expect(amina).toMatchObject({ name: 'Amina Hassan', username: 'amina.hassan' });
    const [row] = query<Record<string, unknown>>('SELECT * FROM users WHERE email = ?', ['amina@example.test']);
    expect(bcrypt.compareSync(amina.temp_password, String(row.password))).toBe(true);
    expect(row).toMatchObject({ role: 'staff', is_first_login: 1, is_enabled: 1, temp_password: amina.temp_password });

    const [pat] = query<{ id: number }>('SELECT id FROM users WHERE email = ?', ['pat@ngo.test']);
    expect(query<{ code: string }>(
      'SELECT r.code FROM user_regions ur JOIN regions r ON r.id = ur.region_id WHERE ur.user_id = ? ORDER BY r.code',
      [pat.id],
    ).map((r) => r.code)).toEqual(['DSM', 'MWZ']);

    const [me] = query<Record<string, unknown>>('SELECT user_name, password FROM users WHERE id = ?', [admin]);
    expect(me).toEqual({ user_name: expect.stringMatching(/^user\d+$/), password: 'x' });
  });

  it('refuses a stale fingerprint with 409 and changes nothing', async () => {
    const buf = await country();
    const { body } = await preview(buf);
    createRegion('ARU', 'Arusha'); // the data moved on since the preview
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(409);
    expect(query('SELECT code FROM regions')).toEqual([{ code: 'ARU' }]);
  });

  it('refuses a plan with errors with 422 and changes nothing', async () => {
    const buf = await buildWorkbook({ Districts: [DISTRICTS, ['TMK', 'Temeke', 'ZZZ']] });
    const { body } = await preview(buf);
    expect(body.plan.canApply).toBe(false);
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(422);
    expect(query('SELECT id FROM districts')).toHaveLength(0);
  });

  it('applies all-or-nothing', async () => {
    await expect(applySetupOps({
      org: {
        Regions: [{ kind: 'add', id: null, code: 'DSM', attrs: { region_name: 'Dar es Salaam' } }],
        Districts: [{ kind: 'add', id: null, code: 'TMK', attrs: { district_name: 'Temeke', region_code: 'NOPE' } }],
        Departments: [], Facilities: [], 'Org Roles': [], 'Job Titles': [],
      },
      users: [],
    })).rejects.toThrow();
    expect(query('SELECT id FROM regions')).toHaveLength(0);
  });

  it('archives, deletes and restores facilities and keeps references tidy', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const f2 = createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1, f2]);
    addResponse({ userId: createUser({ enabled: false }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab });
    const parked = createUser({ facilityId: f2, departmentId: lab, enabled: false });

    const drop = await buildWorkbook({ Facilities: [FACILITIES, ['F3', 'New Clinic', '', 'TMK', 'LAB']] });
    const p1 = await preview(drop);
    expect((await apply(drop, p1.body.plan.fingerprint)).status).toBe(200);
    expect(query<{ archived_at: string | null }>('SELECT archived_at FROM facilities WHERE id = ?', [f1])[0].archived_at)
      .not.toBeNull();
    expect(query('SELECT id FROM facilities WHERE id = ?', [f2])).toHaveLength(0);
    expect(query('SELECT * FROM facility_departments WHERE facility_id = ?', [f2])).toHaveLength(0);
    expect(query('SELECT facility_id, department_id FROM users WHERE id = ?', [parked]))
      .toEqual([{ facility_id: null, department_id: null }]);

    const back = await buildWorkbook({
      Facilities: [FACILITIES, ['F1', 'Temeke Hospital', '', 'TMK', 'LAB'], ['F3', 'New Clinic', '', 'TMK', 'LAB']],
    });
    const p2 = await preview(back);
    expect(p2.body.plan.tabs[3].changes).toEqual([{ row: 2, key: 'F1', kind: 'restore', fields: [] }]);
    expect((await apply(back, p2.body.plan.fingerprint)).status).toBe(200);
    expect(query('SELECT archived_at FROM facilities WHERE id = ?', [f1])).toEqual([{ archived_at: null }]);
  });

  it('moves facilities with their district when the district changes region', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    createRegion('MWZ', 'Mwanza');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const buf = await buildWorkbook({ Districts: [DISTRICTS, ['TMK', 'Temeke', 'MWZ']] });
    const { body } = await preview(buf);
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(200);
    expect(query<{ code: string }>(
      'SELECT r.code FROM facilities f JOIN regions r ON r.id = f.region_id WHERE f.id = ?', [f1],
    )).toEqual([{ code: 'MWZ' }]);
  });

  it('keeps every facility region equal to its district region after apply', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const mwz = createRegion('MWZ', 'Mwanza');
    const aru = createRegion('ARU', 'Arusha');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const nya = createDistrict('NYA', 'Nyamagana', mwz);
    createDistrict('MRU', 'Meru', aru);
    createFacility('F1', 'Hospital', { regionId: dsm, districtId: tmk }); // changes district
    createFacility('F2', 'Clinic', { regionId: dsm, districtId: tmk });   // follows TMK to ARU
    createFacility('F3', 'Dispensary', { regionId: mwz, districtId: nya }); // untouched
    const buf = await buildWorkbook({
      Regions: [REGIONS, ['DSM', 'Dar es Salaam'], ['MWZ', 'Mwanza'], ['ARU', 'Arusha']],
      Districts: [DISTRICTS, ['TMK', 'Temeke', 'ARU'], ['NYA', 'Nyamagana', 'MWZ'], ['MRU', 'Meru', 'ARU']],
      Facilities: [
        FACILITIES,
        ['F1', 'Hospital', '', 'NYA', ''],
        ['F2', 'Clinic', '', 'TMK', ''],
        ['F3', 'Dispensary', '', 'NYA', ''],
        ['F4', 'New Post', '', 'MRU', ''],
      ],
    });
    const { body } = await preview(buf);
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(200);
    expect(query('SELECT f.code FROM facilities f JOIN districts d ON d.id = f.district_id WHERE f.region_id != d.region_id')).toEqual([]);
    expect(query<{ code: string; region: string }>(
      'SELECT f.code, r.code AS region FROM facilities f JOIN regions r ON r.id = f.region_id ORDER BY f.code',
    )).toEqual([
      { code: 'F1', region: 'MWZ' }, { code: 'F2', region: 'ARU' }, { code: 'F3', region: 'MWZ' }, { code: 'F4', region: 'ARU' },
    ]);
  });

  it('disables a user through status without touching their password', async () => {
    const leaver = createUser({ email: 'leaver@example.test', idType: 'NRC' });
    const [before] = query<{ password: string; user_name: string }>('SELECT password, user_name FROM users WHERE id = ?', [leaver]);
    const [row] = query<Record<string, string>>('SELECT first_name, last_name, national_id FROM users WHERE id = ?', [leaver]);
    const buf = await buildWorkbook({
      Users: [USERS_HEADER, userSheetRow(admin), ['leaver@example.test', row.first_name, row.last_name, row.national_id, 'NRC', 'staff', '', '', '', '', '', 'disabled']],
    });
    const { body } = await preview(buf);
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(200);
    expect(query('SELECT is_enabled, password, user_name FROM users WHERE id = ?', [leaver]))
      .toEqual([{ is_enabled: 0, password: before.password, user_name: before.user_name }]);
  });

  it('guards the endpoints', async () => {
    const buf = await country();
    const staff = createUser();
    expect((await preview(buf, staff)).status).toBe(403);
    expect((await request(app).post('/admin/setup/import/preview').set(asUser(admin)).send({ csv: 'x' })).status).toBe(415);
    expect((await request(app).post('/admin/setup/import/apply').set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(buf)).status).toBe(400);
    expect((await preview(Buffer.alloc(MAX_WORKBOOK_BYTES + 1))).status).toBe(413);
    expect((await preview(Buffer.from('not a workbook'))).status).toBe(400);
  });
});
