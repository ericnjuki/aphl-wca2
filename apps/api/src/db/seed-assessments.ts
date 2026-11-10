import fs from 'fs';
import path from 'path';
import { query, execute, transaction } from './database';
import { CAT_TAB, ParsedCatalogue, readCatalogueWorkbook, usableRows } from '../lib/workbook/catalogue';
import type { SheetRow } from '../lib/workbook/reader';

/**
 * Seeds the assessment catalogue — domains, competency items and footnotes —
 * from the workbook bundled at `seed-data/assessment-catalogue.xlsx`, so a
 * fresh install already has the full catalogue.
 *
 * Seeding is additive and never destructive. A domain is inserted only when
 * its code is absent, its items only when it has none, and its footnotes only
 * when it has none. Restarting a populated instance is therefore a no-op, and
 * content edited through the admin UI is never overwritten. Admins push
 * updated content with the catalogue workbook import on the Assessments page.
 */

// dist/db/ and src/db/ sit at the same depth, so this resolves in both the
// compiled and the ts-node/nodemon case.
const SEED_DIR = path.resolve(
  process.env.SEED_DATA_PATH ?? path.join(__dirname, '../../seed-data'),
);
export const CATALOGUE_FILE = 'assessment-catalogue.xlsx';

function domainIdOf(code: string): number | null {
  const [row] = query<{ id: number }>('SELECT id FROM assessment_domains WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? null;
}

function countFor(table: 'assessment_items' | 'assessment_footnotes', domainId: number): number {
  return query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE domain_id = ?`, [domainId])[0].n;
}

/** Rows grouped by upper-cased domain_code, in sheet order. */
function groupByDomain(rows: SheetRow[]): Map<string, SheetRow[]> {
  const out = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const code = r.values.domain_code.toUpperCase();
    out.set(code, [...(out.get(code) ?? []), r]);
  }
  return out;
}

/** Insert-only seeding from a parsed catalogue workbook. Call inside a transaction. */
export function seedCatalogue(parsed: ParsedCatalogue): { domains: number; items: number; footnotes: number } {
  let domains = 0;
  let items = 0;
  let footnotes = 0;

  for (const r of usableRows(parsed[CAT_TAB.domains])) {
    const code = r.values.domain_code.toUpperCase();
    if (domainIdOf(code) !== null) continue;
    const version = Number(r.values.version);
    execute(
      'INSERT INTO assessment_domains (code, name, version, purpose, introduction) VALUES (?, ?, ?, ?, ?)',
      [code, r.values.domain_name, Number.isInteger(version) && version > 0 ? version : 1,
       r.values.purpose || null, r.values.introduction || null],
    );
    domains++;
  }

  for (const [code, rows] of groupByDomain(usableRows(parsed[CAT_TAB.items]))) {
    const domain = domainIdOf(code);
    if (domain === null) {
      console.warn(`[seed:assessments] items for unknown domain '${code}' — skipped`);
      continue;
    }
    if (countFor('assessment_items', domain) > 0) continue; // already populated — leave it alone
    rows.forEach((r, i) => {
      const v = r.values;
      execute(
        `INSERT INTO assessment_items
           (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
            beginner, competent, proficient, expert, na, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [domain, v.competency_value, v.competency_text, v.subcompetency_value, v.subcompetency_text,
         v.beginner, v.competent, v.proficient, v.expert, v.na, i],
      );
      items++;
    });
  }

  for (const [code, rows] of groupByDomain(usableRows(parsed[CAT_TAB.footnotes]))) {
    const domain = domainIdOf(code);
    if (domain === null) {
      console.warn(`[seed:assessments] footnotes for unknown domain '${code}' — skipped`);
      continue;
    }
    if (countFor('assessment_footnotes', domain) > 0) continue;
    rows.forEach((r, i) => {
      const raw = r.values.sort_order;
      const sort = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : i;
      execute(
        'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
        [domain, r.values.symbol, r.values.definition, sort],
      );
      footnotes++;
    });
  }

  return { domains, items, footnotes };
}

export async function seedAssessments(): Promise<void> {
  const file = path.join(SEED_DIR, CATALOGUE_FILE);
  if (!fs.existsSync(file)) {
    console.warn(`[seed:assessments] ${file} not found — nothing seeded`);
    return;
  }
  const parsed = await readCatalogueWorkbook(fs.readFileSync(file));
  for (const [name, tab] of Object.entries(parsed)) {
    if (tab && tab.errors.length) {
      console.warn(`[seed:assessments] ${name}: ${tab.errors.length} problem(s) in the bundled workbook — those rows skipped`);
    }
  }

  // One transaction for the whole catalogue: sql.js serialises the entire
  // database to disk on every write made outside a transaction.
  const counts = transaction(() => seedCatalogue(parsed));
  if (counts.domains + counts.items + counts.footnotes === 0) {
    console.log('[seed:assessments] already up-to-date');
    return;
  }
  console.log(
    `[seed:assessments] seeded ${counts.domains} domain(s), ${counts.items} item(s), ${counts.footnotes} footnote(s)`,
  );
}
