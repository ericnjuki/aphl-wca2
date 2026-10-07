// Country setup import — organisation tabs (Regions … Job Titles).
//
// Pure planning: compares a parsed workbook with a database snapshot and
// returns, per tab, the changes (for the preview), the operations (for apply)
// and the resulting state (for cross-tab validation). Nothing here writes.
// A present tab is a full sync of its entity type; an absent tab changes
// nothing. Spec: docs/superpowers/specs/2026-10-06-workbook-import-design.md §1.

import { ParsedTab, splitList } from './reader';
import { TabPlan, newTab, diffFields } from './plan';
import { TAB, SetupTabName, ParsedSetup } from './setup-format';
import { SetupSnapshot, SnapEntity } from './setup-snapshot';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgTab = Exclude<SetupTabName, typeof TAB.users>;
export const ORG_TABS: OrgTab[] = [TAB.regions, TAB.districts, TAB.departments, TAB.facilities, TAB.orgRoles, TAB.titles];

export type OrgOpKind = 'add' | 'update' | 'restore' | 'archive' | 'delete';

/** One write for apply. `attrs` are canonical workbook values keyed by column. */
export interface OrgOp { kind: OrgOpKind; id: number | null; code: string; attrs: Record<string, string> }

/** An entity as it will be after the import. */
export interface StateEntry {
  code: string;
  active: boolean;
  fromWorkbook: boolean;   // false → an unchanged database row
  row: number | null;
  valid: boolean;          // false → the row has errors (it still claims its code)
  attrs: Record<string, string>;
}

export interface OrgTabResult { plan: TabPlan; ops: OrgOp[]; state: Map<string, StateEntry>; fromWorkbook: boolean }
export type OrgState = Record<OrgTab, OrgTabResult>;

/** A user as they will be after the import (codes upper-case). */
export interface UserState {
  email: string;
  active: boolean;
  fromWorkbook: boolean;
  role: string;
  facility: string;
  department: string;
  orgRole: string;
  title: string;
  regions: string[];
}

interface OrgTabConfig { keyCol: string; fields: string[]; label: string }

const ORG_CONFIG: Record<OrgTab, OrgTabConfig> = {
  [TAB.regions]: { keyCol: 'region_code', fields: ['region_name'], label: 'region' },
  [TAB.districts]: { keyCol: 'district_code', fields: ['district_name', 'region_code'], label: 'district' },
  [TAB.departments]: { keyCol: 'department_code', fields: ['department_name'], label: 'department' },
  [TAB.facilities]: {
    keyCol: 'facility_code', fields: ['facility_name', 'facility_type', 'district_code', 'department_codes'], label: 'facility',
  },
  [TAB.orgRoles]: { keyCol: 'role_code', fields: ['role_name'], label: 'org role' },
  [TAB.titles]: { keyCol: 'title_code', fields: ['title_name'], label: 'job title' },
};

export const MAJORITY_WARNING = 'this usually means the wrong file';

// ── Canonical values ──────────────────────────────────────────────────────────

const CODE_FIELDS = new Set(['region_code', 'district_code', 'facility_code', 'department_code', 'org_role_code', 'title_code']);
const LIST_FIELDS = new Set(['department_codes', 'region_codes']);

/** Codes upper-case; lists de-duplicated, sorted and joined with ';'. */
export function canonical(field: string, raw: string): string {
  if (LIST_FIELDS.has(field)) return [...new Set(splitList(raw).map((c) => c.toUpperCase()))].sort().join(';');
  if (CODE_FIELDS.has(field)) return raw.toUpperCase();
  return raw;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Existing rows ─────────────────────────────────────────────────────────────

interface Existing { id: number; code: string; archived: boolean; hasHistory: boolean; attrs: Record<string, string> }

const base = (e: SnapEntity) => ({ id: e.id, code: e.code, archived: e.archived, hasHistory: e.hasHistory });

function existingFor(tab: OrgTab, snap: SetupSnapshot): Existing[] {
  switch (tab) {
    case TAB.regions:
      return snap.regions.map((e) => ({ ...base(e), attrs: { region_name: e.name } }));
    case TAB.districts:
      return snap.districts.map((e) => ({ ...base(e), attrs: { district_name: e.name, region_code: e.regionCode } }));
    case TAB.departments:
      return snap.departments.map((e) => ({ ...base(e), attrs: { department_name: e.name } }));
    case TAB.facilities:
      return snap.facilities.map((e) => ({
        ...base(e),
        attrs: {
          facility_name: e.name, facility_type: e.facilityType,
          district_code: e.districtCode, department_codes: e.departmentCodes.join(';'),
        },
      }));
    case TAB.orgRoles:
      return snap.orgRoles.map((e) => ({ ...base(e), attrs: { role_name: e.name } }));
    case TAB.titles:
      return snap.titles.map((e) => ({ ...base(e), attrs: { title_name: e.name } }));
  }
}

// ── One tab ───────────────────────────────────────────────────────────────────

function planOrgTab(tab: OrgTab, parsed: ParsedTab | null, existing: Existing[]): OrgTabResult {
  const cfg = ORG_CONFIG[tab];
  const plan = newTab(tab, parsed !== null);
  const ops: OrgOp[] = [];
  const state = new Map<string, StateEntry>();
  const keep = (e: Existing) => state.set(e.code, {
    code: e.code, active: !e.archived, fromWorkbook: false, row: null, valid: true, attrs: e.attrs,
  });

  // Absent tab, or one whose header we cannot read: the database stays as it is.
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    existing.forEach(keep);
    return { plan, ops, state, fromWorkbook: false };
  }
  plan.errors.push(...parsed.errors);

  const byCode = new Map(existing.map((e) => [e.code, e]));
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values[cfg.keyCol].toUpperCase();
    if (!code) continue; // the reader already reported the empty key
    const first = firstRow.get(code);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: cfg.keyCol, message: `Duplicate ${cfg.keyCol} "${code}" — first used on row ${first}` });
      continue;
    }
    firstRow.set(code, r.row);
    const attrs = Object.fromEntries(cfg.fields.map((f) => [f, canonical(f, r.values[f] ?? '')]));
    const valid = !parsed.badRows.has(r.row);
    state.set(code, { code, active: true, fromWorkbook: true, row: r.row, valid, attrs });
    if (!valid) continue;

    const prev = byCode.get(code);
    if (!prev) {
      ops.push({ kind: 'add', id: null, code, attrs });
      plan.changes.push({ row: r.row, key: code, kind: 'add', fields: diffFields({}, attrs, cfg.fields) });
    } else if (prev.archived) {
      ops.push({ kind: 'restore', id: prev.id, code, attrs });
      plan.changes.push({ row: r.row, key: code, kind: 'restore', fields: diffFields(prev.attrs, attrs, cfg.fields) });
    } else {
      const fields = diffFields(prev.attrs, attrs, cfg.fields);
      if (fields.length) {
        ops.push({ kind: 'update', id: prev.id, code, attrs });
        plan.changes.push({ row: r.row, key: code, kind: 'update', fields });
      } else {
        plan.counts.unchanged++;
      }
    }
  }

  // Everything the workbook no longer lists: archive (has history) or delete.
  const activeBefore = existing.filter((e) => !e.archived).length;
  let removed = 0;
  for (const e of existing) {
    if (firstRow.has(e.code)) continue;
    if (e.archived) { keep(e); continue; }
    removed++;
    const kind: OrgOpKind = e.hasHistory ? 'archive' : 'delete';
    ops.push({ kind, id: e.id, code: e.code, attrs: e.attrs });
    plan.changes.push({ row: null, key: e.code, kind });
    if (kind === 'archive') {
      state.set(e.code, { code: e.code, active: false, fromWorkbook: false, row: null, valid: true, attrs: e.attrs });
    }
  }
  if (activeBefore > 0 && removed / activeBefore > 0.5) {
    plan.warnings.push(`${removed} of ${activeBefore} existing ${tab.toLowerCase()} would be archived or deleted — ${MAJORITY_WARNING}.`);
  }
  return { plan, ops, state, fromWorkbook: true };
}

// ── Cross-tab validation ──────────────────────────────────────────────────────

export function isActive(org: OrgState, tab: OrgTab, code: string): boolean {
  return org[tab].state.get(code)?.active === true;
}

export function refError(column: string, code: string, target: OrgTab, org: OrgState): string {
  const where = org[target].fromWorkbook ? `the ${target} tab` : `the database (no ${target} tab in this workbook)`;
  return `${column} "${code}" is not an active ${ORG_CONFIG[target].label} in ${where}`;
}

function workbookRows(org: OrgState, tab: OrgTab): (StateEntry & { row: number })[] {
  return [...org[tab].state.values()]
    .filter((e): e is StateEntry & { row: number } => e.fromWorkbook && e.valid && e.row !== null);
}

function checkReferences(org: OrgState): void {
  const err = (tab: OrgTab, row: number, column: string, message: string) =>
    org[tab].plan.errors.push({ row, column, message });
  for (const d of workbookRows(org, TAB.districts)) {
    const region = d.attrs.region_code;
    if (!isActive(org, TAB.regions, region)) {
      err(TAB.districts, d.row, 'region_code', refError('region_code', region, TAB.regions, org));
    }
  }
  for (const f of workbookRows(org, TAB.facilities)) {
    const district = f.attrs.district_code;
    if (!isActive(org, TAB.districts, district)) {
      err(TAB.facilities, f.row, 'district_code', refError('district_code', district, TAB.districts, org));
    }
    for (const dep of splitList(f.attrs.department_codes)) {
      if (!isActive(org, TAB.departments, dep)) {
        err(TAB.facilities, f.row, 'department_codes', refError('department_codes', dep, TAB.departments, org));
      }
    }
  }
}

// departments.name is UNIQUE in the database.
function checkDepartmentNames(org: OrgState): void {
  const entries = [...org[TAB.departments].state.values()]
    .sort((a, b) => Number(a.fromWorkbook) - Number(b.fromWorkbook) || (a.row ?? 0) - (b.row ?? 0));
  const owner = new Map<string, string>();
  for (const e of entries) {
    const name = e.attrs.department_name;
    const taken = owner.get(name);
    if (taken === undefined) { owner.set(name, e.code); continue; }
    if (e.fromWorkbook && e.row !== null) {
      org[TAB.departments].plan.errors.push({
        row: e.row, column: 'department_name', message: `department_name "${name}" is already used by department "${taken}"`,
      });
    }
  }
}

export function planOrgTabs(parsed: ParsedSetup, snap: SetupSnapshot): OrgState {
  const org = {} as OrgState;
  for (const tab of ORG_TABS) org[tab] = planOrgTab(tab, parsed[tab], existingFor(tab, snap));
  checkReferences(org);
  checkDepartmentNames(org);
  return org;
}

// ── Removal guards ────────────────────────────────────────────────────────────
// Rows from present tabs that point at a removed entity already fail the
// reference check; here we catch unchanged database rows (absent tabs) and
// active users that would be left pointing at something archived or deleted.

const ORG_REFERRERS: Partial<Record<OrgTab, { from: OrgTab; uses: (e: StateEntry, code: string) => boolean }[]>> = {
  [TAB.regions]: [{ from: TAB.districts, uses: (e, c) => e.attrs.region_code === c }],
  [TAB.districts]: [{ from: TAB.facilities, uses: (e, c) => e.attrs.district_code === c }],
  [TAB.departments]: [{ from: TAB.facilities, uses: (e, c) => splitList(e.attrs.department_codes ?? '').includes(c) }],
};

const USER_USES: Record<OrgTab, (u: UserState, code: string) => boolean> = {
  [TAB.regions]: (u, c) => u.regions.includes(c),
  [TAB.districts]: () => false,
  [TAB.departments]: (u, c) => u.department === c,
  [TAB.facilities]: (u, c) => u.facility === c,
  [TAB.orgRoles]: (u, c) => u.orgRole === c,
  [TAB.titles]: (u, c) => u.title === c,
};

export function checkOrgRemovals(org: OrgState, users: Map<string, UserState>): void {
  for (const tab of ORG_TABS) {
    const { label } = ORG_CONFIG[tab];
    for (const op of org[tab].ops) {
      if (op.kind !== 'archive' && op.kind !== 'delete') continue;
      const blockers: string[] = [];
      for (const ref of ORG_REFERRERS[tab] ?? []) {
        for (const e of org[ref.from].state.values()) {
          if (e.active && !e.fromWorkbook && ref.uses(e, op.code)) blockers.push(`${ORG_CONFIG[ref.from].label} "${e.code}"`);
        }
      }
      for (const u of users.values()) {
        if (u.active && !u.fromWorkbook && USER_USES[tab](u, op.code)) blockers.push(`user ${u.email}`);
      }
      if (!blockers.length) continue;
      const verb = op.kind === 'archive' ? 'archived' : 'deleted';
      org[tab].plan.errors.push({
        row: 0,
        column: null,
        message: `${capitalise(label)} "${op.code}" would be ${verb}, but ${blockers.join(', ')} still `
          + `${blockers.length === 1 ? 'uses' : 'use'} it — keep it in the workbook or remove those too`,
      });
    }
  }
}

/** Users unchanged by the import (Users tab absent). */
export function usersFromSnapshot(snap: SetupSnapshot): Map<string, UserState> {
  return new Map(snap.users.map((u) => [u.email.toLowerCase(), {
    email: u.email,
    active: u.enabled,
    fromWorkbook: false,
    role: u.role,
    facility: u.facilityCode,
    department: u.departmentCode,
    orgRole: u.orgRoleCode,
    title: u.titleCode,
    regions: u.regionCodes,
  }]));
}
