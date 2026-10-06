// The assessment catalogue workbook (assessment-catalogue.xlsx): format,
// snapshot, planner (add + update only — it never removes), apply and export.
// The bundled copy seeds a fresh database (db/seed-assessments.ts); admins can
// re-import an updated copy from the Assessments page. Spec §2.

import * as ExcelJS from 'exceljs';
import { query, execute, transaction } from '../../db/database';
import { loadWorkbook, workbookToBuffer } from './xlsx';
import { ParsedTab, SheetRow, TabSpec, readTabs, req, opt } from './reader';
import { ImportPlan, TabPlan, newTab, diffFields, finalisePlan } from './plan';
import { writeTab, writeReadme, appVersion } from './writer';

// ── Format ────────────────────────────────────────────────────────────────────

export const CAT_TAB = { domains: 'Domains', items: 'Items', footnotes: 'Footnotes' } as const;
export type CatalogueTabName = typeof CAT_TAB[keyof typeof CAT_TAB];

export const CATALOGUE_TABS: TabSpec[] = [
  {
    name: CAT_TAB.domains,
    columns: [req('domain_code'), req('domain_name'), req('version'), opt('purpose'), opt('introduction')],
  },
  {
    name: CAT_TAB.items,
    columns: [
      req('domain_code'), req('competency_value'), opt('competency_text'), req('subcompetency_value'),
      req('subcompetency_text'), req('beginner'), req('competent'), req('proficient'), req('expert'), opt('na'),
    ],
  },
  { name: CAT_TAB.footnotes, columns: [req('domain_code'), req('symbol'), req('definition'), opt('sort_order')] },
];

const DOMAIN_FIELDS = ['domain_name', 'version', 'purpose', 'introduction'];
export const ITEM_FIELDS = [
  'competency_value', 'competency_text', 'subcompetency_text', 'beginner', 'competent', 'proficient', 'expert', 'na',
];

export type ParsedCatalogue = Record<CatalogueTabName, ParsedTab | null>;

export async function readCatalogueWorkbook(buffer: Buffer): Promise<ParsedCatalogue> {
  return readTabs(await loadWorkbook(buffer), CATALOGUE_TABS) as ParsedCatalogue;
}

/** Rows without reader errors (used by the lenient startup loader). */
export function usableRows(tab: ParsedTab | null): SheetRow[] {
  if (!tab || !tab.headerOk) return [];
  return tab.rows.filter((r) => !tab.badRows.has(r.row));
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface CatDomain { id: number; code: string; values: Record<string, string> }
export interface CatItem { id: number; domainCode: string; subcompetency: string; sortOrder: number; values: Record<string, string> }
export interface CatFootnote { id: number; domainCode: string; symbol: string; definition: string; sortOrder: number }
export interface CatalogueSnapshot { domains: CatDomain[]; items: CatItem[]; footnotes: CatFootnote[] }

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function loadCatalogueSnapshot(): CatalogueSnapshot {
  const domains = query<{
    id: number; code: string; name: string; version: number; purpose: string | null; introduction: string | null;
  }>('SELECT id, code, name, version, purpose, introduction FROM assessment_domains ORDER BY code')
    .map((d) => ({
      id: d.id,
      code: txt(d.code).toUpperCase(),
      values: { domain_name: txt(d.name), version: String(d.version), purpose: txt(d.purpose), introduction: txt(d.introduction) },
    }));
  const items = query<Record<string, string | number | null>>(
    `SELECT i.*, d.code AS domain_code FROM assessment_items i
     JOIN assessment_domains d ON d.id = i.domain_id ORDER BY d.code, i.sort_order, i.id`,
  ).map((i) => ({
    id: Number(i.id),
    domainCode: txt(i.domain_code).toUpperCase(),
    subcompetency: txt(i.subcompetency_value),
    sortOrder: Number(i.sort_order),
    values: Object.fromEntries(ITEM_FIELDS.map((f) => [f, txt(i[f])])),
  }));
  const footnotes = query<{ id: number; domain_code: string; symbol: string; definition: string; sort_order: number }>(
    `SELECT f.id, d.code AS domain_code, f.symbol, f.definition, f.sort_order FROM assessment_footnotes f
     JOIN assessment_domains d ON d.id = f.domain_id ORDER BY d.code, f.sort_order, f.id`,
  ).map((f) => ({
    id: f.id, domainCode: txt(f.domain_code).toUpperCase(), symbol: txt(f.symbol), definition: txt(f.definition),
    sortOrder: Number(f.sort_order),
  }));
  return { domains, items, footnotes };
}

// ── Planning (add + update only) ──────────────────────────────────────────────

export interface DomainOp { kind: 'add' | 'update'; id: number | null; code: string; values: Record<string, string> }
export interface ItemOp {
  kind: 'add' | 'update'; id: number | null; domainCode: string; subcompetency: string; values: Record<string, string>;
}
export interface FootnoteOp {
  kind: 'add' | 'update'; id: number | null; domainCode: string; symbol: string; definition: string; sortOrder: number | null;
}
export interface CatalogueOps { domains: DomainOp[]; items: ItemOp[]; footnotes: FootnoteOp[] }

const WHOLE = /^-?\d+$/;
const unknownDomain = (code: string) => `domain_code "${code}" is not in the Domains tab or the database`;

/** Domains; adds every code the workbook names to `known`. */
function planDomains(parsed: ParsedTab | null, snap: CatalogueSnapshot, known: Set<string>): { plan: TabPlan; ops: DomainOp[] } {
  const plan = newTab(CAT_TAB.domains, parsed !== null);
  const ops: DomainOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops };
  }
  plan.errors.push(...parsed.errors);
  const byCode = new Map(snap.domains.map((d) => [d.code, d]));
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values.domain_code.toUpperCase();
    if (!code) continue;
    const first = firstRow.get(code);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: 'domain_code', message: `Duplicate domain_code "${code}" — first used on row ${first}` });
      continue;
    }
    firstRow.set(code, r.row);
    known.add(code);
    let valid = !parsed.badRows.has(r.row);
    if (r.values.version && !/^[1-9]\d*$/.test(r.values.version)) {
      plan.errors.push({ row: r.row, column: 'version', message: 'version must be a whole number of 1 or more' });
      valid = false;
    }
    if (!valid) continue;
    const values = {
      domain_name: r.values.domain_name, version: r.values.version, purpose: r.values.purpose, introduction: r.values.introduction,
    };
    const prev = byCode.get(code);
    if (!prev) {
      ops.push({ kind: 'add', id: null, code, values });
      plan.changes.push({ row: r.row, key: code, kind: 'add', fields: diffFields({}, values, DOMAIN_FIELDS) });
      continue;
    }
    const fields = diffFields(prev.values, values, DOMAIN_FIELDS);
    if (fields.length) {
      ops.push({ kind: 'update', id: prev.id, code, values });
      plan.changes.push({ row: r.row, key: code, kind: 'update', fields });
    } else {
      plan.counts.unchanged++;
    }
  }
  return { plan, ops };
}

function planItems(parsed: ParsedTab | null, snap: CatalogueSnapshot, known: Set<string>): { plan: TabPlan; ops: ItemOp[] } {
  const plan = newTab(CAT_TAB.items, parsed !== null);
  const ops: ItemOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops };
  }
  plan.errors.push(...parsed.errors);
  const existing = new Map<string, CatItem>();
  for (const i of snap.items) {
    const key = `${i.domainCode}|${i.subcompetency}`;
    if (!existing.has(key)) existing.set(key, i);
  }
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values.domain_code.toUpperCase();
    const sub = r.values.subcompetency_value;
    if (!code || !sub) continue;
    const key = `${code}|${sub}`;
    const label = `${code} ${sub}`;
    const first = firstRow.get(key);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: 'subcompetency_value', message: `Duplicate item ${label} — first used on row ${first}` });
      continue;
    }
    firstRow.set(key, r.row);
    let valid = !parsed.badRows.has(r.row);
    if (!known.has(code)) {
      plan.errors.push({ row: r.row, column: 'domain_code', message: unknownDomain(code) });
      valid = false;
    }
    if (!valid) continue;
    const values = Object.fromEntries(ITEM_FIELDS.map((f) => [f, r.values[f] ?? '']));
    const prev = existing.get(key);
    if (!prev) {
      ops.push({ kind: 'add', id: null, domainCode: code, subcompetency: sub, values });
      plan.changes.push({ row: r.row, key: label, kind: 'add', fields: diffFields({}, values, ITEM_FIELDS) });
      continue;
    }
    const fields = diffFields(prev.values, values, ITEM_FIELDS);
    if (fields.length) {
      ops.push({ kind: 'update', id: prev.id, domainCode: code, subcompetency: sub, values });
      plan.changes.push({ row: r.row, key: label, kind: 'update', fields });
    } else {
      plan.counts.unchanged++;
    }
  }
  return { plan, ops };
}

function planFootnotes(parsed: ParsedTab | null, snap: CatalogueSnapshot, known: Set<string>): { plan: TabPlan; ops: FootnoteOp[] } {
  const plan = newTab(CAT_TAB.footnotes, parsed !== null);
  const ops: FootnoteOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops };
  }
  plan.errors.push(...parsed.errors);
  const existing = new Map<string, CatFootnote>();
  for (const f of snap.footnotes) {
    const key = `${f.domainCode}|${f.symbol}`;
    if (!existing.has(key)) existing.set(key, f);
  }
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values.domain_code.toUpperCase();
    const symbol = r.values.symbol;
    if (!code || !symbol) continue;
    const key = `${code}|${symbol}`;
    const label = `${code} ${symbol}`;
    const first = firstRow.get(key);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: 'symbol', message: `Duplicate footnote ${label} — first used on row ${first}` });
      continue;
    }
    firstRow.set(key, r.row);
    let valid = !parsed.badRows.has(r.row);
    const rawSort = r.values.sort_order;
    if (rawSort && !WHOLE.test(rawSort)) {
      plan.errors.push({ row: r.row, column: 'sort_order', message: 'sort_order must be a whole number' });
      valid = false;
    }
    if (!known.has(code)) {
      plan.errors.push({ row: r.row, column: 'domain_code', message: unknownDomain(code) });
      valid = false;
    }
    if (!valid) continue;
    // A blank sort_order keeps an existing footnote's position.
    const sortOrder = rawSort ? Number(rawSort) : null;
    const fields = sortOrder === null ? ['definition'] : ['definition', 'sort_order'];
    const values: Record<string, string> = { definition: r.values.definition };
    if (sortOrder !== null) values.sort_order = String(sortOrder);
    const op = { domainCode: code, symbol, definition: r.values.definition, sortOrder };
    const prev = existing.get(key);
    if (!prev) {
      ops.push({ kind: 'add', id: null, ...op });
      plan.changes.push({ row: r.row, key: label, kind: 'add', fields: diffFields({}, values, fields) });
      continue;
    }
    const diff = diffFields({ definition: prev.definition, sort_order: String(prev.sortOrder) }, values, fields);
    if (diff.length) {
      ops.push({ kind: 'update', id: prev.id, ...op });
      plan.changes.push({ row: r.row, key: label, kind: 'update', fields: diff });
    } else {
      plan.counts.unchanged++;
    }
  }
  return { plan, ops };
}

export function planCatalogueImport(parsed: ParsedCatalogue, snap: CatalogueSnapshot): { plan: ImportPlan; ops: CatalogueOps } {
  const known = new Set(snap.domains.map((d) => d.code));
  const domains = planDomains(parsed[CAT_TAB.domains], snap, known);
  const items = planItems(parsed[CAT_TAB.items], snap, known);
  const footnotes = planFootnotes(parsed[CAT_TAB.footnotes], snap, known);
  return {
    plan: finalisePlan([domains.plan, items.plan, footnotes.plan]),
    ops: { domains: domains.ops, items: items.ops, footnotes: footnotes.ops },
  };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

function domainId(code: string): number {
  const [row] = query<{ id: number }>('SELECT id FROM assessment_domains WHERE code = ? COLLATE NOCASE', [code]);
  if (!row) throw new Error(`Catalogue apply: no domain "${code}"`);
  return row.id;
}

function nextSortOrder(table: 'assessment_items' | 'assessment_footnotes', domain: number): number {
  const [row] = query<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM ${table} WHERE domain_id = ?`, [domain]);
  return row?.m === null || row?.m === undefined ? 0 : row.m + 1;
}

export function applyCatalogueOps(ops: CatalogueOps): void {
  transaction(() => {
    for (const op of ops.domains) {
      const v = op.values;
      const args = [v.domain_name, Number(v.version), v.purpose || null, v.introduction || null];
      if (op.kind === 'add') {
        execute('INSERT INTO assessment_domains (code, name, version, purpose, introduction) VALUES (?, ?, ?, ?, ?)', [op.code, ...args]);
      } else {
        execute(
          `UPDATE assessment_domains SET name = ?, version = ?, purpose = ?, introduction = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [...args, op.id],
        );
      }
    }
    for (const op of ops.items) {
      const v = op.values;
      const cols = [
        v.competency_value, v.competency_text, op.subcompetency, v.subcompetency_text,
        v.beginner, v.competent, v.proficient, v.expert, v.na,
      ];
      if (op.kind === 'add') {
        const domain = domainId(op.domainCode);
        execute(
          `INSERT INTO assessment_items (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
             beginner, competent, proficient, expert, na, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [domain, ...cols, nextSortOrder('assessment_items', domain)],
        );
      } else {
        execute(
          `UPDATE assessment_items SET competency_value = ?, competency_text = ?, subcompetency_value = ?, subcompetency_text = ?,
             beginner = ?, competent = ?, proficient = ?, expert = ?, na = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [...cols, op.id],
        );
      }
    }
    for (const op of ops.footnotes) {
      if (op.kind === 'add') {
        const domain = domainId(op.domainCode);
        execute(
          'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
          [domain, op.symbol, op.definition, op.sortOrder ?? nextSortOrder('assessment_footnotes', domain)],
        );
      } else {
        execute(
          'UPDATE assessment_footnotes SET definition = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?',
          [op.definition, op.sortOrder, op.id],
        );
      }
    }
  });
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function writeCatalogueWorkbook(snap: CatalogueSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const version = snap.domains.reduce((m, d) => Math.max(m, Number(d.values.version) || 0), 0);
  writeReadme(wb, 'Assessment catalogue', [
    ['How to use', 'Domains, items and footnotes, one row each. Shaded column headers are required.'],
    ['Matching', 'Domains by domain_code; items by domain_code + subcompetency_value; footnotes by domain_code + symbol. Codes ignore upper/lower case.'],
    ['Adds and updates only', 'Importing adds new rows and updates changed ones. Nothing is ever removed — delete items on the Assessments page.'],
    ['Order', "New items are added after a domain's existing items, in sheet order. A blank footnote sort_order keeps the current position."],
    ['Catalogue version', String(version)],
    ['Exported', new Date().toISOString()],
    ['App version', appVersion()],
  ]);
  writeTab(wb, CATALOGUE_TABS[0], snap.domains.map((d) => [
    d.code, d.values.domain_name, d.values.version, d.values.purpose, d.values.introduction,
  ]));
  writeTab(wb, CATALOGUE_TABS[1], snap.items.map((i) => [
    i.domainCode, i.values.competency_value, i.values.competency_text, i.subcompetency, i.values.subcompetency_text,
    i.values.beginner, i.values.competent, i.values.proficient, i.values.expert, i.values.na,
  ]));
  writeTab(wb, CATALOGUE_TABS[2], snap.footnotes.map((f) => [f.domainCode, f.symbol, f.definition, String(f.sortOrder)]));
  return workbookToBuffer(wb);
}
