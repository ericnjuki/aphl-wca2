// One-off conversion: the CSV catalogue in seed-data/ → seed-data/assessment-catalogue.xlsx.
// Reads the CSVs the way the old seeder did, writes the workbook, reads it back
// and checks every value survived. Run once, commit the workbook, then delete
// this script together with the CSVs.

import fs from 'fs';
import path from 'path';
import { parseCsv } from '../lib/csv';
import {
  CAT_TAB, ITEM_FIELDS, CatalogueSnapshot, CatDomain, CatItem, CatFootnote, writeCatalogueWorkbook, readCatalogueWorkbook,
} from '../lib/workbook/catalogue';

const SEED_DIR = path.resolve(__dirname, '../../seed-data');
const OUT = path.join(SEED_DIR, 'assessment-catalogue.xlsx');

function readCsv(file: string): Record<string, string>[] {
  const { headers, rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function fail(message: string): never {
  console.error(`[catalogue] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Items: one CSV per domain, mapped by its `code` column; order = sort_order.
  const versions = new Map<string, string>();
  const items: CatItem[] = [];
  const dir = path.join(SEED_DIR, 'assessments');
  for (const filename of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort()) {
    const rows = readCsv(path.join(dir, filename));
    const codes = new Set(rows.map((r) => r.code.toUpperCase()));
    if (codes.size !== 1) fail(`${filename}: expected one domain code, found ${[...codes].join(', ')}`);
    const code = [...codes][0];
    versions.set(code, rows[0].assessment_version || '1');
    rows.forEach((r, i) => items.push({
      id: 0, domainCode: code, subcompetency: r.subcompetency_value, sortOrder: i,
      values: Object.fromEntries(ITEM_FIELDS.map((f) => [f, r[f] ?? ''])),
    }));
  }

  const domains: CatDomain[] = readCsv(path.join(SEED_DIR, 'assessment_data.csv')).map((r) => {
    const code = r.assessment_code.toUpperCase();
    return {
      id: 0, code,
      values: {
        domain_name: r.assessment_name, version: versions.get(code) ?? '1',
        purpose: r.purpose ?? '', introduction: r.introduction ?? '',
      },
    };
  });

  // Old rule: a footnote's sort_order is its CSV value, else its index within the domain.
  const perDomain = new Map<string, number>();
  const footnotes: CatFootnote[] = readCsv(path.join(SEED_DIR, 'footnotes.csv')).map((r) => {
    const code = r.domain_code.toUpperCase();
    const index = perDomain.get(code) ?? 0;
    perDomain.set(code, index + 1);
    const sort = r.sort_order !== '' && Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : index;
    return { id: 0, domainCode: code, symbol: r.symbol, definition: r.definition, sortOrder: sort };
  });

  const snap: CatalogueSnapshot = { domains, items, footnotes };
  const buffer = await writeCatalogueWorkbook(snap);
  fs.writeFileSync(OUT, buffer);

  // Read it back with the import reader and compare every value (cells are trimmed).
  const parsed = await readCatalogueWorkbook(buffer);
  for (const [name, t] of Object.entries(parsed)) {
    if (!t || !t.headerOk || t.errors.length) fail(`${name}: read-back problems ${JSON.stringify(t?.errors ?? 'tab missing')}`);
  }
  const same = (label: string, expected: string[][], tab: keyof typeof parsed, cols: string[]) => {
    const actual = (parsed[tab]?.rows ?? []).map((r) => cols.map((c) => r.values[c]));
    const want = expected.map((row) => row.map((v) => v.trim()));
    if (want.length !== actual.length) fail(`${label}: ${want.length} source rows, ${actual.length} workbook rows`);
    want.forEach((row, i) => {
      if (JSON.stringify(row) !== JSON.stringify(actual[i])) {
        fail(`${label} row ${i + 2}: ${JSON.stringify(row)} became ${JSON.stringify(actual[i])}`);
      }
    });
  };
  same('Domains', domains.map((d) => [d.code, d.values.domain_name, d.values.version, d.values.purpose, d.values.introduction]),
    CAT_TAB.domains, ['domain_code', 'domain_name', 'version', 'purpose', 'introduction']);
  same('Items', items.map((i) => [
    i.domainCode, i.values.competency_value, i.values.competency_text, i.subcompetency, i.values.subcompetency_text,
    i.values.beginner, i.values.competent, i.values.proficient, i.values.expert, i.values.na,
  ]), CAT_TAB.items, [
    'domain_code', 'competency_value', 'competency_text', 'subcompetency_value', 'subcompetency_text',
    'beginner', 'competent', 'proficient', 'expert', 'na',
  ]);
  same('Footnotes', footnotes.map((f) => [f.domainCode, f.symbol, f.definition, String(f.sortOrder)]),
    CAT_TAB.footnotes, ['domain_code', 'symbol', 'definition', 'sort_order']);

  console.log(`[catalogue] wrote ${OUT}: ${domains.length} domains, ${items.length} items, ${footnotes.length} footnotes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
