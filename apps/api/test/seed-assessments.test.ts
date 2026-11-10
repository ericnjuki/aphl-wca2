import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query, execute } from '../src/db/database';
import { seedAssessments } from '../src/db/seed-assessments';
import { XLSX_MIME } from '../src/lib/workbook/xlsx';
import { initTestDb, testApp, asUser, createUser, binaryParser } from './helpers';

const count = (sql: string) => query<{ n: number }>(sql)[0].n;

// Items per domain as seeded from the former CSVs (SAF has none).
const ITEMS_PER_DOMAIN: Record<string, number> = {
  BIO: 11, CHM: 34, COM: 22, EMR: 25, ETH: 6, GEN: 29, INF: 95, MCB: 42, MLD: 43, QMS: 44,
  RES: 31, SAC: 12, SAF: 0, SCT: 6, SDR: 8, SEC: 17, SHC: 21, SPH: 21, SRV: 22, WFT: 22,
};

describe('assessment catalogue seeding from the bundled workbook', () => {
  beforeAll(initTestDb);

  it('matches the former CSV seeding on a fresh database', async () => {
    await seedAssessments();
    expect(count('SELECT COUNT(*) AS n FROM assessment_domains')).toBe(20);
    expect(count('SELECT COUNT(*) AS n FROM assessment_items')).toBe(511);
    expect(count('SELECT COUNT(*) AS n FROM assessment_footnotes')).toBe(1);

    const perDomain = Object.fromEntries(query<{ code: string; n: number }>(
      `SELECT d.code, COUNT(i.id) AS n FROM assessment_domains d
       LEFT JOIN assessment_items i ON i.domain_id = d.id GROUP BY d.code`,
    ).map((r) => [r.code, r.n]));
    expect(perDomain).toEqual(ITEMS_PER_DOMAIN);

    expect(query('SELECT code FROM assessment_domains WHERE version <> 1')).toEqual([]);
    expect(query(
      `SELECT i.subcompetency_value, i.subcompetency_text, i.sort_order FROM assessment_items i
       JOIN assessment_domains d ON d.id = i.domain_id WHERE d.code = 'SAC' ORDER BY i.sort_order LIMIT 1`,
    )).toEqual([{ subcompetency_value: '1.01', subcompetency_text: 'Safety program', sort_order: 0 }]);
    // Text-formatted cells keep codes like 1.10 intact.
    expect(count("SELECT COUNT(*) AS n FROM assessment_items WHERE subcompetency_value LIKE '%.10'")).toBeGreaterThan(0);
    // sort_order is 0..n-1 within every domain.
    expect(query(
      `SELECT domain_id FROM assessment_items GROUP BY domain_id
       HAVING MIN(sort_order) <> 0 OR MAX(sort_order) <> COUNT(*) - 1`,
    )).toEqual([]);
    expect(query("SELECT purpose IS NOT NULL AS p, introduction IS NOT NULL AS i FROM assessment_domains WHERE code = 'INF'"))
      .toEqual([{ p: 1, i: 1 }]);
    expect(query(
      `SELECT f.symbol, f.definition, f.sort_order FROM assessment_footnotes f
       JOIN assessment_domains d ON d.id = f.domain_id WHERE d.code = 'INF'`,
    )).toEqual([{ symbol: '*', definition: 'This term is defined in Appendix B.', sort_order: 1 }]);
  });

  it('exports the seeded catalogue as a workbook that previews with no changes and no errors', async () => {
    const app = testApp();
    const admin = createUser({ role: 'admin' });
    const exported = await request(app).get('/assessments/catalogue/export').set(asUser(admin))
      .buffer(true).parse(binaryParser);
    expect(exported.status).toBe(200);

    const res = await request(app).post('/assessments/catalogue/import/preview').set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(exported.body);
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: { tabs: { tab: string; changes: unknown[]; errors: unknown[] }[] } };
    expect(plan.tabs.map((t) => t.tab).sort()).toEqual(['Domains', 'Footnotes', 'Items']);
    for (const t of plan.tabs) {
      expect(t.errors, `${t.tab} errors`).toEqual([]);
      expect(t.changes, `${t.tab} changes`).toEqual([]);
    }
  });

  it('is insert-only on restart and never overwrites edits', async () => {
    execute("UPDATE assessment_domains SET name = 'Edited' WHERE code = 'QMS'");
    execute('DELETE FROM assessment_footnotes');
    await seedAssessments();
    expect(query("SELECT name FROM assessment_domains WHERE code = 'QMS'")).toEqual([{ name: 'Edited' }]);
    expect(count('SELECT COUNT(*) AS n FROM assessment_domains')).toBe(20);
    expect(count('SELECT COUNT(*) AS n FROM assessment_items')).toBe(511);
    // INF had no footnotes any more, so its footnote is inserted again.
    expect(count('SELECT COUNT(*) AS n FROM assessment_footnotes')).toBe(1);
  });
});
