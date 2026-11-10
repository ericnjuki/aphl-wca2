import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import { XLSX_MIME, loadWorkbook } from '../src/lib/workbook/xlsx';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  createOrgRole, createTitle, assignRegions, addResponse, binaryParser, USERS_HEADER,
} from './helpers';
import type * as ExcelJS from 'exceljs';

const app = testApp();
const header = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1);

describe('country setup export', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin', email: 'boss@example.test' });
  });

  const download = () => request(app).get('/admin/setup/export').set(asUser(admin)).buffer(true).parse(binaryParser);

  it('exports the empty template on a system without organisation data', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain('country-setup.xlsx');

    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Read me', 'Regions', 'Districts', 'Departments', 'Facilities', 'Org Roles', 'Job Titles', 'Users',
    ]);
    const regions = wb.getWorksheet('Regions') as ExcelJS.Worksheet;
    expect(header(regions)).toEqual(['region_code', 'region_name']);
    expect(regions.actualRowCount).toBe(1);
    expect(header(wb.getWorksheet('Facilities') as ExcelJS.Worksheet))
      .toEqual(['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes']);

    const users = wb.getWorksheet('Users') as ExcelJS.Worksheet;
    expect(header(users)).toEqual([...USERS_HEADER, 'username']);
    expect(users.getCell('A2').value).toBe('boss@example.test');
    expect(users.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect((users.getCell('A1').fill as { pattern?: string }).pattern).toBe('solid');            // required
    expect((users.getCell('F1').fill as { pattern?: string } | undefined)?.pattern).not.toBe('solid'); // optional
    expect(users.getCell('E2').dataValidation).toMatchObject({ type: 'list', formulae: ['"NRC,Passport,Other"'] });
    expect(users.getCell('F2').dataValidation).toMatchObject({ type: 'list', formulae: ['"staff,admin,monitor"'] });
    expect(users.getCell('L2').dataValidation).toMatchObject({ type: 'list', formulae: ['"active,disabled"'] });
    expect(users.getCell('M2').value).toMatch(/^user\d+$/);
    expect((users.getCell('M2').fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFEDEDED');
  });

  it('exports only active organisation entities', async () => {
    createRegion('DSM', 'Dar es Salaam');
    const old = createRegion('OLD', 'Old Region');
    execute("UPDATE regions SET archived_at = datetime('now') WHERE id = ?", [old]);
    const wb = await loadWorkbook((await download()).body as Buffer);
    const regions = wb.getWorksheet('Regions') as ExcelJS.Worksheet;
    expect(regions.actualRowCount).toBe(2);
    expect(regions.getCell('A2').value).toBe('DSM');
  });

  it('re-imports its own export with no changes', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const mwz = createRegion('MWZ', 'Mwanza');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const f9 = createFacility('F9', 'Closed Clinic', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1, f9]);
    createDepartment('MIC', 'Microbiology', [f1]);
    const mls = createOrgRole('MLS', 'Medical Laboratory Scientist');
    const dr = createTitle('DR', 'Dr.');
    createUser({ facilityId: f1, departmentId: lab, orgRoleId: mls, titleId: dr, idType: 'NRC' });
    const partner = createUser({ role: 'monitor', idType: 'Passport' });
    assignRegions(partner, [dsm, mwz]);
    // A disabled user who still points at an archived facility.
    const leaver = createUser({ facilityId: f9, enabled: false });
    addResponse({ userId: leaver, facilityId: f9, regionId: dsm, districtId: tmk, departmentId: lab });
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE id = ?", [f9]);

    const exported = (await download()).body as Buffer;
    const res = await request(app).post('/admin/setup/import/preview').set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(exported);
    expect(res.status).toBe(200);
    expect(res.body.plan.tabs.flatMap((t: { errors: unknown[] }) => t.errors)).toEqual([]);
    expect(res.body.plan.tabs.every((t: { present: boolean }) => t.present)).toBe(true);
    expect(res.body.plan.tabs.flatMap((t: { changes: unknown[] }) => t.changes)).toEqual([]);
    expect(res.body.plan.canApply).toBe(true);
  });
});
