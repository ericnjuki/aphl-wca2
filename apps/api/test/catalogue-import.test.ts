import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query, execute } from '../src/db/database';
import { XLSX_MIME, loadWorkbook } from '../src/lib/workbook/xlsx';
import { initTestDb, resetDb, testApp, asUser, createUser, buildWorkbook, binaryParser } from './helpers';
import type * as ExcelJS from 'exceljs';

const app = testApp();

const DOMAINS = ['domain_code', 'domain_name', 'version', 'purpose', 'introduction'];
const ITEMS = [
  'domain_code', 'competency_value', 'competency_text', 'subcompetency_value', 'subcompetency_text',
  'beginner', 'competent', 'proficient', 'expert', 'na',
];
const FOOTNOTES = ['domain_code', 'symbol', 'definition', 'sort_order'];
const item = (code: string, sub: string, text = `Sub ${sub}`) =>
  [code, '1', 'Competency one', sub, text, 'b', 'c', 'p', 'e', 'N/A'];

interface Tab { tab: string; counts: Record<string, number>; changes: unknown[]; errors: unknown[] }
const tab = (plan: { tabs: Tab[] }, name: string) => plan.tabs.find((t) => t.tab === name) as Tab;

describe('assessment catalogue workbook', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    execute('DELETE FROM assessment_footnotes');
    execute('DELETE FROM assessment_items');
    execute('DELETE FROM assessment_domains');
    admin = createUser({ role: 'admin' });
    execute("INSERT INTO assessment_domains (code, name, version) VALUES ('LAB', 'Laboratory', 1)");
    const [{ id }] = query<{ id: number }>("SELECT id FROM assessment_domains WHERE code = 'LAB'");
    for (const [sub, sort] of [['1.01', 0], ['1.02', 1]] as const) {
      execute(
        `INSERT INTO assessment_items (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
           beginner, competent, proficient, expert, na, sort_order)
         VALUES (?, '1', 'Competency one', ?, ?, 'b', 'c', 'p', 'e', 'N/A', ?)`,
        [id, sub, `Sub ${sub}`, sort],
      );
    }
    execute("INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, '*', 'Defined term', 1)", [id]);
  });

  const preview = (buf: Buffer, user = admin) =>
    request(app).post('/assessments/catalogue/import/preview').set(asUser(user)).set('Content-Type', XLSX_MIME).send(buf);
  const apply = (buf: Buffer, fingerprint: string) =>
    request(app).post(`/assessments/catalogue/import/apply?fingerprint=${fingerprint}`).set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(buf);
  const download = (user = admin) =>
    request(app).get('/assessments/catalogue/export').set(asUser(user)).buffer(true).parse(binaryParser);

  const updated = () => buildWorkbook({
    Domains: [DOMAINS, ['lab', 'Laboratory Practice', '2', 'Why it matters', ''], ['BIO', 'Bioinformatics', '1', '', '']],
    Items: [ITEMS, item('LAB', '1.01'), item('LAB', '1.02', 'Changed'), item('LAB', '1.10'), item('BIO', '1.01')],
    Footnotes: [FOOTNOTES, ['LAB', '*', 'Defined term', '1'], ['BIO', '†', 'Dagger', '']],
  });

  it('previews adds and updates without changing anything', async () => {
    const res = await preview(await updated());
    expect(res.status).toBe(200);
    const { plan } = res.body;
    expect(plan.canApply).toBe(true);
    expect(tab(plan, 'Domains').changes).toEqual([
      {
        row: 2, key: 'LAB', kind: 'update',
        fields: [
          { field: 'domain_name', from: 'Laboratory', to: 'Laboratory Practice' },
          { field: 'version', from: '1', to: '2' },
          { field: 'purpose', from: '', to: 'Why it matters' },
        ],
      },
      {
        row: 3, key: 'BIO', kind: 'add',
        fields: [{ field: 'domain_name', from: '', to: 'Bioinformatics' }, { field: 'version', from: '', to: '1' }],
      },
    ]);
    expect(tab(plan, 'Items').counts).toMatchObject({ added: 2, updated: 1, unchanged: 1 });
    expect(tab(plan, 'Items').changes[0]).toEqual({
      row: 3, key: 'LAB 1.02', kind: 'update', fields: [{ field: 'subcompetency_text', from: 'Sub 1.02', to: 'Changed' }],
    });
    expect(tab(plan, 'Footnotes').counts).toMatchObject({ added: 1, unchanged: 1 });
    expect(query('SELECT id FROM assessment_domains')).toHaveLength(1);
  });

  it("applies adds and updates, appending new items after a domain's existing ones", async () => {
    const buf = await updated();
    const { body } = await preview(buf);
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
    expect(query("SELECT name, version, purpose FROM assessment_domains WHERE code = 'LAB'"))
      .toEqual([{ name: 'Laboratory Practice', version: 2, purpose: 'Why it matters' }]);
    expect(query(
      `SELECT d.code, i.subcompetency_value AS sub, i.subcompetency_text AS text, i.sort_order
       FROM assessment_items i JOIN assessment_domains d ON d.id = i.domain_id ORDER BY d.code, i.sort_order`,
    )).toEqual([
      { code: 'BIO', sub: '1.01', text: 'Sub 1.01', sort_order: 0 },
      { code: 'LAB', sub: '1.01', text: 'Sub 1.01', sort_order: 0 },
      { code: 'LAB', sub: '1.02', text: 'Changed', sort_order: 1 },
      { code: 'LAB', sub: '1.10', text: 'Sub 1.10', sort_order: 2 },
    ]);
    expect(query(
      `SELECT d.code, f.symbol, f.sort_order FROM assessment_footnotes f
       JOIN assessment_domains d ON d.id = f.domain_id ORDER BY d.code`,
    )).toEqual([{ code: 'BIO', symbol: '†', sort_order: 0 }, { code: 'LAB', symbol: '*', sort_order: 1 }]);
  });

  it('never removes anything', async () => {
    const buf = await buildWorkbook({ Items: [ITEMS, item('LAB', '1.01')] });
    const { body } = await preview(buf);
    expect(body.plan.tabs.flatMap((t: Tab) => t.changes)).toEqual([]);
    expect(body.plan.confirmations).toEqual({ archived: 0, deleted: 0, disabledUsers: 0 });
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(200);
    expect(query('SELECT id FROM assessment_items')).toHaveLength(2);
    expect(query('SELECT id FROM assessment_footnotes')).toHaveLength(1);
  });

  it('reports unknown domains, duplicates and bad numbers', async () => {
    const { body } = await preview(await buildWorkbook({
      Domains: [DOMAINS, ['NEW', 'New', 'v2', '', '']],
      Items: [ITEMS, item('ZZZ', '1.01'), item('LAB', '1.01'), item('lab', '1.01')],
      Footnotes: [FOOTNOTES, ['LAB', '*', 'Defined term', 'first']],
    }));
    expect(tab(body.plan, 'Domains').errors).toEqual([
      { row: 2, column: 'version', message: 'version must be a whole number of 1 or more' },
    ]);
    expect(tab(body.plan, 'Items').errors).toEqual([
      { row: 2, column: 'domain_code', message: 'domain_code "ZZZ" is not in the Domains tab or the database' },
      { row: 4, column: 'subcompetency_value', message: 'Duplicate item LAB 1.01 — first used on row 3' },
    ]);
    expect(tab(body.plan, 'Footnotes').errors).toEqual([
      { row: 2, column: 'sort_order', message: 'sort_order must be a whole number' },
    ]);
    expect(body.plan.canApply).toBe(false);
  });

  it('exports the catalogue and re-imports it with no changes', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('assessment-catalogue.xlsx');
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Read me', 'Domains', 'Items', 'Footnotes']);
    expect((wb.getWorksheet('Items') as ExcelJS.Worksheet).getCell('D3').value).toBe('1.02');
    const again = await preview(res.body as Buffer);
    expect(again.body.plan.tabs.flatMap((t: Tab) => t.changes)).toEqual([]);
    expect(again.body.plan.canApply).toBe(true);
  });

  it('guards the endpoints', async () => {
    const staff = createUser();
    expect((await download(staff)).status).toBe(403);
    const buf = await updated();
    expect((await preview(buf, staff)).status).toBe(403);
    const { body } = await preview(buf);
    execute("UPDATE assessment_domains SET name = 'Renamed' WHERE code = 'LAB'");
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(409);
  });
});
