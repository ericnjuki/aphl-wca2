// Country setup import — the Users tab. Users are matched by email
// (case-insensitive), keep their username and password, and are never
// deleted: users missing from a present Users tab are disabled.

import { ParsedTab, splitList } from './reader';
import { TabPlan, newTab, diffFields } from './plan';
import { TAB, ID_TYPES, SYSTEM_ROLES, STATUSES } from './setup-format';
import { SetupSnapshot, SnapUser } from './setup-snapshot';
import {
  OrgState, OrgTab, UserState, MAJORITY_WARNING, canonical, refError, isActive, usersFromSnapshot,
} from './setup-org';

// ── Types ─────────────────────────────────────────────────────────────────────

export const USER_FIELDS = [
  'first_name', 'last_name', 'national_id', 'id_type', 'system_role', 'facility_code',
  'department_code', 'org_role_code', 'title_code', 'region_codes', 'status',
] as const;
export type UserField = typeof USER_FIELDS[number];
export type UserValues = Record<UserField, string> & { email: string };

export interface UserOp { kind: 'add' | 'update' | 'disable'; id: number | null; values: UserValues }
export interface UsersResult { plan: TabPlan; ops: UserOp[]; state: Map<string, UserState> }

interface Problem { column: string | null; message: string }
interface WorkbookUser { row: number; key: string; values: UserValues; prev: SnapUser | undefined; valid: boolean }

// ── Values ────────────────────────────────────────────────────────────────────

function snapValues(u: SnapUser): UserValues {
  return {
    email: u.email,
    first_name: u.firstName,
    last_name: u.lastName,
    national_id: u.nationalId,
    id_type: u.idType,
    system_role: u.role,
    facility_code: u.facilityCode,
    department_code: u.departmentCode,
    org_role_code: u.orgRoleCode,
    title_code: u.titleCode,
    region_codes: u.regionCodes.join(';'),
    status: u.enabled ? 'active' : 'disabled',
  };
}

function toState(v: UserValues, fromWorkbook: boolean): UserState {
  return {
    email: v.email,
    active: v.status === 'active',
    fromWorkbook,
    role: v.system_role,
    facility: v.facility_code,
    department: v.department_code,
    orgRole: v.org_role_code,
    title: v.title_code,
    regions: splitList(v.region_codes),
  };
}

/** Canonical values plus problems with allowed-value columns. */
function normalise(raw: Record<string, string>, prev: SnapUser | undefined): { values: UserValues; problems: Problem[] } {
  const problems: Problem[] = [];
  // An existing user's legacy id_type (e.g. the seed admin's) is fine while it is unchanged.
  const idType = ID_TYPES.find((t) => t.toLowerCase() === raw.id_type.toLowerCase())
    ?? (prev && prev.idType === raw.id_type ? raw.id_type : null);
  if (raw.id_type && idType === null) {
    problems.push({ column: 'id_type', message: `id_type must be one of ${ID_TYPES.join(', ')}` });
  }
  const role = (raw.system_role || 'staff').toLowerCase();
  if (!(SYSTEM_ROLES as readonly string[]).includes(role)) {
    problems.push({ column: 'system_role', message: `system_role must be one of ${SYSTEM_ROLES.join(', ')}` });
  }
  const status = (raw.status || 'active').toLowerCase();
  if (!(STATUSES as readonly string[]).includes(status)) {
    problems.push({ column: 'status', message: `status must be one of ${STATUSES.join(', ')}` });
  }
  return {
    problems,
    values: {
      email: raw.email,
      first_name: raw.first_name,
      last_name: raw.last_name,
      national_id: raw.national_id,
      id_type: idType ?? raw.id_type,
      system_role: role,
      status,
      facility_code: canonical('facility_code', raw.facility_code),
      department_code: canonical('department_code', raw.department_code),
      org_role_code: canonical('org_role_code', raw.org_role_code),
      title_code: canonical('title_code', raw.title_code),
      region_codes: canonical('region_codes', raw.region_codes),
    },
  };
}

/** Placement rules and references for one (already normalised) row. */
function checkUser(v: UserValues, org: OrgState): Problem[] {
  const out: Problem[] = [];
  const disabled = v.status === 'disabled';
  const ref = (column: string, code: string, tab: OrgTab) => {
    if (!code) return;
    // Disabled users may keep pointing at archived entities (their history).
    const ok = isActive(org, tab, code) || (disabled && org[tab].state.has(code));
    if (!ok) out.push({ column, message: refError(column, code, tab, org) });
  };

  if (v.system_role === 'monitor') {
    if (!v.region_codes) {
      out.push({ column: 'region_codes', message: 'A partner (monitor) user needs at least one region in region_codes' });
    }
    if (v.facility_code || v.department_code || v.org_role_code || v.title_code) {
      out.push({ column: null, message: 'Partner (monitor) users cannot have a facility, department, org role or title' });
    }
  } else if (v.region_codes) {
    out.push({ column: 'region_codes', message: 'Only partner (monitor) users can have region_codes' });
  }

  ref('facility_code', v.facility_code, TAB.facilities);
  ref('department_code', v.department_code, TAB.departments);
  ref('org_role_code', v.org_role_code, TAB.orgRoles);
  ref('title_code', v.title_code, TAB.titles);
  for (const code of splitList(v.region_codes)) ref('region_codes', code, TAB.regions);

  // Disabled users keep their history, so their department is not re-validated against the facility.
  if (v.department_code && !disabled) {
    if (!v.facility_code) {
      out.push({ column: 'department_code', message: 'department_code needs a facility_code' });
    } else {
      const facility = org[TAB.facilities].state.get(v.facility_code);
      if (facility && !splitList(facility.attrs.department_codes ?? '').includes(v.department_code)) {
        out.push({
          column: 'department_code',
          message: `Department "${v.department_code}" is not one of facility "${v.facility_code}"'s departments`,
        });
      }
    }
  }
  return out;
}

// ── Planning ──────────────────────────────────────────────────────────────────

export function planUsersTab(
  parsed: ParsedTab | null, snap: SetupSnapshot, org: OrgState, actorUserId: number,
): UsersResult {
  const plan = newTab(TAB.users, parsed !== null);
  const ops: UserOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops, state: usersFromSnapshot(snap) };
  }
  plan.errors.push(...parsed.errors);
  const err = (row: number, column: string | null, message: string) => plan.errors.push({ row, column, message });

  const existing = new Map(snap.users.map((u) => [u.email.toLowerCase(), u]));
  const firstRow = new Map<string, number>();
  const rows: WorkbookUser[] = [];
  const state = new Map<string, UserState>();

  // 1. Each row on its own.
  for (const r of parsed.rows) {
    const key = r.values.email.toLowerCase();
    if (!key) continue; // the reader already reported the empty email
    const first = firstRow.get(key);
    if (first !== undefined) {
      err(r.row, 'email', `Duplicate email "${r.values.email}" — first used on row ${first}`);
      continue;
    }
    firstRow.set(key, r.row);
    const prev = existing.get(key);
    const { values, problems } = normalise(r.values, prev);
    const readerBad = parsed.badRows.has(r.row);
    if (!problems.length && !readerBad) problems.push(...checkUser(values, org));
    for (const p of problems) err(r.row, p.column, p.message);
    rows.push({ row: r.row, key, values, prev, valid: problems.length === 0 && !readerBad });
    state.set(key, toState(values, true));
  }

  // 2. national_id + id_type is unique across every user that will exist.
  const pair = (id: string, type: string) => `${id}\u0000${type}`;
  const holder = new Map<string, string>();
  for (const u of snap.users) {
    if (!firstRow.has(u.email.toLowerCase())) holder.set(pair(u.nationalId, u.idType), `existing user ${u.email}`);
  }
  for (const r of rows) {
    if (!r.valid) continue;
    const p = pair(r.values.national_id, r.values.id_type);
    const other = holder.get(p);
    if (other !== undefined) {
      err(r.row, 'national_id',
        `national_id "${r.values.national_id}" with id_type "${r.values.id_type}" is already used by ${other}`);
      r.valid = false;
    } else {
      holder.set(p, `row ${r.row} (${r.values.email})`);
    }
  }

  // 3. Changes for valid rows.
  let statusDisabled = 0;
  for (const r of rows) {
    if (!r.valid) continue;
    if (!r.prev) {
      ops.push({ kind: 'add', id: null, values: r.values });
      plan.changes.push({ row: r.row, key: r.values.email, kind: 'add', fields: diffFields({}, r.values, USER_FIELDS) });
      continue;
    }
    const fields = diffFields(snapValues(r.prev), r.values, USER_FIELDS);
    if (fields.length) {
      ops.push({ kind: 'update', id: r.prev.id, values: { ...r.values, email: r.prev.email } });
      // enabled → disabled via status is a 'disable' in the plan (confirmations, majority warning);
      // the op stays an 'update' carrying values.status so apply needs no special case.
      const kind = r.prev.enabled && r.values.status === 'disabled' ? 'disable' : 'update';
      if (kind === 'disable') statusDisabled++;
      plan.changes.push({ row: r.row, key: r.prev.email, kind, fields });
    } else {
      plan.counts.unchanged++;
    }
  }

  // 4. Users missing from the tab are disabled, never deleted.
  const enabledBefore = snap.users.filter((u) => u.enabled).length;
  let disabled = 0;
  for (const u of snap.users) {
    const key = u.email.toLowerCase();
    if (firstRow.has(key)) continue;
    const values: UserValues = { ...snapValues(u), status: 'disabled' };
    if (u.enabled) {
      disabled++;
      ops.push({ kind: 'disable', id: u.id, values });
      plan.changes.push({ row: null, key: u.email, kind: 'disable' });
    }
    state.set(key, toState(values, false));
  }
  if (disabled > 0) {
    plan.warnings.push(`${disabled} ${disabled === 1 ? 'user is' : 'users are'} not in the Users tab and will be disabled.`);
  }
  const totalDisabled = disabled + statusDisabled;
  if (enabledBefore > 0 && totalDisabled / enabledBefore > 0.5) {
    plan.warnings.push(`${totalDisabled} of ${enabledBefore} active users would be disabled — ${MAJORITY_WARNING}.`);
  }

  // 5. Lock-out guards.
  const actor = snap.users.find((u) => u.id === actorUserId);
  if (actor) {
    const mine = rows.find((r) => r.key === actor.email.toLowerCase());
    if (!mine) err(0, 'email', `Your own account (${actor.email}) is not in the Users tab — the import would disable you`);
    else if (mine.values.status !== 'active') err(mine.row, 'status', 'You cannot disable your own account');
    else if (mine.values.system_role !== 'admin') err(mine.row, 'system_role', 'You cannot remove your own admin role');
  }
  if (!rows.some((r) => r.values.system_role === 'admin' && r.values.status === 'active')) {
    err(0, 'system_role', 'The import must leave at least one active admin');
  }

  return { plan, ops, state };
}
