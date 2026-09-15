import fs from 'fs';
import path from 'path';
import { query, execute, transaction } from './database';
import { parseCsv } from '../lib/csv';

/**
 * Seeds the assessment catalogue — domains, competency items and footnotes —
 * from the CSV files bundled in `seed-data/`, so a fresh install already has
 * the full catalogue without an admin importing anything by hand.
 *
 * Seeding is additive and never destructive. A domain is inserted only when
 * its code is absent, its items only when it has none, and its footnotes only
 * when it has none. Restarting an already-populated instance is therefore a
 * no-op, and content edited through the admin UI is never overwritten. The
 * admin import routes remain the way to push updated content.
 */

// dist/db/ and src/db/ sit at the same depth, so this resolves in both the
// compiled and the ts-node/nodemon case.
const SEED_DIR = path.resolve(
  process.env.SEED_DATA_PATH ?? path.join(__dirname, '../../seed-data'),
);

interface DomainRow extends Record<string, unknown> {
  id: number;
  code: string;
  name: string;
}

/** Reads a CSV from the seed directory, or returns null when it is absent. */
function readSeedCsv(relPath: string): { headers: string[]; rows: string[][] } | null {
  const file = path.join(SEED_DIR, relPath);
  if (!fs.existsSync(file)) {
    console.warn(`[seed:assessments] missing ${relPath} — skipped`);
    return null;
  }
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

/** Builds a `header -> value` accessor for one row, defaulting to ''. */
function rowReader(headers: string[], row: string[]) {
  return (header: string): string => {
    const i = headers.indexOf(header);
    return i === -1 ? '' : (row[i] ?? '');
  };
}

/**
 * Pass 1 — domains from assessment_data.csv. Existing codes are left exactly
 * as they are, including any name/purpose/introduction edited by an admin.
 */
function seedDomains(): number {
  const parsed = readSeedCsv('assessment_data.csv');
  if (!parsed) return 0;
  const { headers, rows } = parsed;

  if (!headers.includes('assessment_code') || !headers.includes('assessment_name')) {
    console.warn('[seed:assessments] assessment_data.csv lacks assessment_code/assessment_name — skipped');
    return 0;
  }

  let inserted = 0;
  for (const row of rows) {
    const get = rowReader(headers, row);
    const code = get('assessment_code').toUpperCase();
    const name = get('assessment_name');
    if (!code || !name) continue;

    const [existing] = query<DomainRow>(
      'SELECT id FROM assessment_domains WHERE code = ? COLLATE NOCASE',
      [code],
    );
    if (existing) continue;

    execute(
      'INSERT INTO assessment_domains (code, name, purpose, introduction) VALUES (?, ?, ?, ?)',
      [code, name, get('purpose') || null, get('introduction') || null],
    );
    inserted++;
  }
  return inserted;
}

/**
 * Pass 2 — competency items from seed-data/assessments/*.csv.
 *
 * Each file carries its own domain in the `code` column, so a file is mapped
 * to its domain by that value rather than by filename. A file whose code is
 * unknown, or whose rows disagree on the code, is reported and skipped instead
 * of being attached to the wrong domain.
 */
function seedItems(): { files: number; items: number } {
  const dir = path.join(SEED_DIR, 'assessments');
  if (!fs.existsSync(dir)) {
    console.warn('[seed:assessments] missing assessments/ directory — skipped');
    return { files: 0, items: 0 };
  }

  const required = ['competency_value', 'competency_text', 'subcompetency_value', 'subcompetency_text'];
  let files = 0;
  let items = 0;

  const filenames = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  for (const filename of filenames) {
    const { headers, rows } = parseCsv(fs.readFileSync(path.join(dir, filename), 'utf8'));
    if (!rows.length) continue;

    const missing = required.filter((h) => !headers.includes(h));
    if (missing.length) {
      console.warn(`[seed:assessments] ${filename}: missing column(s) ${missing.join(', ')} — skipped`);
      continue;
    }
    if (!headers.includes('code')) {
      console.warn(`[seed:assessments] ${filename}: no 'code' column to map it to a domain — skipped`);
      continue;
    }

    // Every row must name the same domain; a mixed file is a data error.
    const codes = new Set(rows.map((r) => rowReader(headers, r)('code').toUpperCase()).filter(Boolean));
    if (codes.size !== 1) {
      const found = codes.size ? [...codes].join(', ') : 'none';
      console.warn(`[seed:assessments] ${filename}: expected one domain code, found ${found} — skipped`);
      continue;
    }
    const code = [...codes][0];

    const [domain] = query<DomainRow>(
      'SELECT id, code FROM assessment_domains WHERE code = ? COLLATE NOCASE',
      [code],
    );
    if (!domain) {
      console.warn(`[seed:assessments] ${filename}: domain '${code}' not in assessment_data.csv — skipped`);
      continue;
    }

    const [{ n }] = query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM assessment_items WHERE domain_id = ?',
      [domain.id],
    );
    if (n > 0) continue; // already populated — leave it alone

    for (let i = 0; i < rows.length; i++) {
      const get = rowReader(headers, rows[i]);
      execute(
        `INSERT INTO assessment_items
           (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
            beginner, competent, proficient, expert, na, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [domain.id, get('competency_value'), get('competency_text'),
         get('subcompetency_value'), get('subcompetency_text'),
         get('beginner'), get('competent'), get('proficient'), get('expert'), get('na'), i],
      );
      items++;
    }
    files++;
    console.log(`[seed:assessments] ${code}: ${rows.length} items from ${filename}`);
  }

  return { files, items };
}

/**
 * Pass 3 — footnotes from footnotes.csv, grouped by `domain_code`. A domain
 * that already has footnotes keeps them.
 */
function seedFootnotes(): number {
  const parsed = readSeedCsv('footnotes.csv');
  if (!parsed) return 0;
  const { headers, rows } = parsed;

  const missing = ['domain_code', 'symbol', 'definition'].filter((h) => !headers.includes(h));
  if (missing.length) {
    console.warn(`[seed:assessments] footnotes.csv: missing column(s) ${missing.join(', ')} — skipped`);
    return 0;
  }

  const byCode = new Map<string, string[][]>();
  for (const row of rows) {
    const code = rowReader(headers, row)('domain_code').toUpperCase();
    if (!code) continue;
    const bucket = byCode.get(code);
    if (bucket) bucket.push(row);
    else byCode.set(code, [row]);
  }

  let inserted = 0;
  for (const [code, group] of byCode) {
    const [domain] = query<DomainRow>(
      'SELECT id FROM assessment_domains WHERE code = ? COLLATE NOCASE',
      [code],
    );
    if (!domain) {
      console.warn(`[seed:assessments] footnotes.csv: unknown domain '${code}' — skipped`);
      continue;
    }

    const [{ n }] = query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM assessment_footnotes WHERE domain_id = ?',
      [domain.id],
    );
    if (n > 0) continue;

    for (let i = 0; i < group.length; i++) {
      const get = rowReader(headers, group[i]);
      const symbol = get('symbol');
      const definition = get('definition');
      if (!symbol || !definition) continue;
      const sortOrder = Number(get('sort_order'));
      execute(
        'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
        [domain.id, symbol, definition, Number.isFinite(sortOrder) ? sortOrder : i],
      );
      inserted++;
    }
  }
  return inserted;
}

export function seedAssessments(): void {
  if (!fs.existsSync(SEED_DIR)) {
    console.warn(`[seed:assessments] seed directory not found at ${SEED_DIR} — nothing seeded`);
    return;
  }

  // One transaction for the whole catalogue: sql.js serialises the entire
  // database to disk on every write made outside a transaction, and this is
  // ~500 item rows.
  const { domains, files, items, footnotes } = transaction(() => {
    const domains = seedDomains();
    const counts = seedItems();
    const footnotes = seedFootnotes();
    return { domains, files: counts.files, items: counts.items, footnotes };
  });

  if (domains + items + footnotes === 0) {
    console.log('[seed:assessments] already up-to-date');
    return;
  }
  console.log(
    `[seed:assessments] seeded ${domains} domain(s), ${items} item(s) across ${files} file(s), ${footnotes} footnote(s)`,
  );
}
