// Writes a planned country setup import in one transaction. The planner has
// validated everything; anything unexpected here throws and rolls the whole
// import back. Foreign keys are not enforced, so deletes tidy up by hand.

import bcrypt from 'bcryptjs';
import { query, execute, transaction } from '../../db/database';
import { syncFacilitiesRegion, backfillResponseDistrict } from '../org';
import { generateTempPassword, generateUsername } from '../credentials';
import { splitList } from './reader';
import { TAB } from './setup-format';
import type { OrgOp, OrgTab } from './setup-org';
import type { UserOp } from './setup-users';
import type { SetupOps } from './setup-planner';

export interface Credential { name: string; email: string; username: string; temp_password: string }

const TABLE: Record<OrgTab, string> = {
  [TAB.regions]: 'regions',
  [TAB.districts]: 'districts',
  [TAB.departments]: 'departments',
  [TAB.facilities]: 'facilities',
  [TAB.orgRoles]: 'org_roles',
  [TAB.titles]: 'user_titles',
};

// ── Lookups ───────────────────────────────────────────────────────────────────

function idByCode(table: string, code: string): number {
  const [row] = query<{ id: number }>(`SELECT id FROM ${table} WHERE code = ? COLLATE NOCASE`, [code]);
  if (!row) throw new Error(`Import apply: no ${table} row with code "${code}"`);
  return row.id;
}

const optionalId = (table: string, code: string): number | null => (code ? idByCode(table, code) : null);
const isUpsert = (op: OrgOp) => op.kind === 'add' || op.kind === 'update' || op.kind === 'restore';

// ── Organisation upserts ──────────────────────────────────────────────────────

function upsertCodeName(table: string, nameCol: string, op: OrgOp, hasUpdatedAt: boolean): void {
  const name = op.attrs[nameCol];
  if (op.kind === 'add') {
    execute(`INSERT INTO ${table} (code, name) VALUES (?, ?)`, [op.code, name]);
    return;
  }
  const touch = hasUpdatedAt ? ", updated_at = datetime('now')" : '';
  execute(`UPDATE ${table} SET name = ?, archived_at = NULL${touch} WHERE id = ?`, [name, op.id]);
}

function upsertDistrict(op: OrgOp): void {
  const regionId = idByCode('regions', op.attrs.region_code);
  if (op.kind === 'add') {
    execute('INSERT INTO districts (code, name, region_id) VALUES (?, ?, ?)', [op.code, op.attrs.district_name, regionId]);
    return;
  }
  const id = op.id as number;
  const [before] = query<{ region_id: number }>('SELECT region_id FROM districts WHERE id = ?', [id]);
  execute(
    `UPDATE districts SET name = ?, region_id = ?, archived_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    [op.attrs.district_name, regionId, id],
  );
  if (before && before.region_id !== regionId) syncFacilitiesRegion(id, regionId); // invariant 2
}

function upsertFacility(op: OrgOp): void {
  const [district] = query<{ id: number; region_id: number }>(
    'SELECT id, region_id FROM districts WHERE code = ? COLLATE NOCASE', [op.attrs.district_code],
  );
  if (!district) throw new Error(`Import apply: no district with code "${op.attrs.district_code}"`);
  const type = op.attrs.facility_type || null;
  let id: number;
  if (op.kind === 'add') {
    execute(
      'INSERT INTO facilities (code, name, facility_type, region_id, district_id) VALUES (?, ?, ?, ?, ?)',
      [op.code, op.attrs.facility_name, type, district.region_id, district.id],
    );
    id = idByCode('facilities', op.code);
  } else {
    id = op.id as number;
    execute(
      `UPDATE facilities SET name = ?, facility_type = ?, region_id = ?, district_id = ?, archived_at = NULL,
         updated_at = datetime('now') WHERE id = ?`,
      [op.attrs.facility_name, type, district.region_id, district.id, id],
    );
    backfillResponseDistrict(id, district.id);
  }
  execute('DELETE FROM facility_departments WHERE facility_id = ?', [id]);
  for (const code of splitList(op.attrs.department_codes)) {
    execute('INSERT INTO facility_departments (facility_id, department_id) VALUES (?, ?)', [id, idByCode('departments', code)]);
  }
}

// ── Removals ──────────────────────────────────────────────────────────────────

function removeEntity(tab: OrgTab, op: OrgOp): void {
  const table = TABLE[tab];
  const id = op.id as number;
  if (op.kind === 'archive') {
    execute(`UPDATE ${table} SET archived_at = datetime('now') WHERE id = ?`, [id]);
    return;
  }
  // Delete: no history, so only links and (disabled) users can still point here.
  if (tab === TAB.regions) execute('DELETE FROM user_regions WHERE region_id = ?', [id]);
  if (tab === TAB.districts) execute('UPDATE facilities SET district_id = NULL WHERE district_id = ?', [id]);
  if (tab === TAB.departments) {
    execute('DELETE FROM facility_departments WHERE department_id = ?', [id]);
    execute('UPDATE users SET department_id = NULL WHERE department_id = ?', [id]);
  }
  if (tab === TAB.facilities) {
    execute('DELETE FROM facility_departments WHERE facility_id = ?', [id]);
    execute('UPDATE users SET facility_id = NULL, department_id = NULL WHERE facility_id = ?', [id]);
  }
  execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

// ── Users ─────────────────────────────────────────────────────────────────────

// Import temporary passwords are single-use (forced change at first login), so a
// cheaper cost keeps a first import of hundreds of users inside the proxy timeout.
const IMPORT_TEMP_BCRYPT_COST = 10;

interface Secret { temp: string; hash: string }
interface PreparedUser extends Secret { op: UserOp; username: string }

function setRegions(userId: number, codes: string): void {
  execute('DELETE FROM user_regions WHERE user_id = ?', [userId]);
  for (const code of splitList(codes)) {
    execute('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)', [userId, idByCode('regions', code)]);
  }
}

function writeUser(op: UserOp, prepared: PreparedUser | undefined): void {
  const v = op.values;
  if (op.kind === 'disable') {
    execute(`UPDATE users SET is_enabled = 0, updated_at = datetime('now') WHERE id = ?`, [op.id]);
    return;
  }
  const placement = [
    optionalId('facilities', v.facility_code),
    optionalId('departments', v.department_code),
    optionalId('org_roles', v.org_role_code),
    optionalId('user_titles', v.title_code),
  ];
  const enabled = v.status === 'active' ? 1 : 0;
  let userId: number;
  if (op.kind === 'add') {
    if (!prepared) throw new Error('Import apply: missing credentials for a new user');
    const email = v.email.toLowerCase();
    execute(
      `INSERT INTO users (first_name, last_name, national_id, id_type, email, user_name, password, role, is_enabled,
         facility_id, department_id, org_role_id, title_id, temp_password)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [v.first_name, v.last_name, v.national_id, v.id_type, email, prepared.username, prepared.hash, v.system_role,
       enabled, ...placement, prepared.temp],
    );
    userId = query<{ id: number }>('SELECT id FROM users WHERE email = ?', [email])[0].id;
  } else {
    userId = op.id as number;
    execute(
      `UPDATE users SET first_name = ?, last_name = ?, national_id = ?, id_type = ?, role = ?, is_enabled = ?,
         facility_id = ?, department_id = ?, org_role_id = ?, title_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [v.first_name, v.last_name, v.national_id, v.id_type, v.system_role, enabled, ...placement, userId],
    );
  }
  setRegions(userId, v.region_codes);
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/** Temporary passwords and their bcrypt hashes for the new users, keyed by email. Async: do this first. */
export async function prepareSecrets(ops: SetupOps): Promise<Map<string, Secret>> {
  const secrets = new Map<string, Secret>();
  for (const op of ops.users) {
    if (op.kind !== 'add') continue;
    const temp = generateTempPassword();
    secrets.set(op.values.email.toLowerCase(), { temp, hash: await bcrypt.hash(temp, IMPORT_TEMP_BCRYPT_COST) });
  }
  return secrets;
}

const TEMP_VALUE = (id: number) => `__import_tmp_${id}`;

/**
 * Synchronous: no await between the caller's fingerprint check and these
 * writes. Unique columns (departments.name, users national_id + id_type) are
 * first parked on a temporary value for every row about to change, so renames
 * and swaps cannot collide mid-way; deleted departments go first.
 */
export function applyPrepared(ops: SetupOps, secrets: Map<string, Secret>): Credential[] {
  const prepared: PreparedUser[] = [];
  transaction(() => {
    const reserved = new Set<string>();
    for (const op of ops.users) {
      if (op.kind !== 'add') continue;
      const secret = secrets.get(op.values.email.toLowerCase());
      if (!secret) throw new Error('Import apply: missing credentials for a new user');
      const username = generateUsername(op.values.first_name, op.values.last_name, reserved);
      reserved.add(username);
      prepared.push({ op, username, ...secret });
    }
    const byOp = new Map(prepared.map((p) => [p.op, p]));

    // Departments: free names before anything claims them.
    const depts = ops.org[TAB.departments];
    for (const op of depts.filter((o) => o.kind === 'delete')) removeEntity(TAB.departments, op);
    for (const op of depts.filter((o) => o.kind === 'update' || o.kind === 'restore')) {
      execute('UPDATE departments SET name = ? WHERE id = ?', [TEMP_VALUE(op.id as number), op.id]);
    }
    for (const op of ops.users.filter((o) => o.kind === 'update')) {
      execute('UPDATE users SET national_id = ? WHERE id = ?', [TEMP_VALUE(op.id as number), op.id]);
    }

    // Parents before children, then users, then the remaining removals children-first.
    for (const op of ops.org[TAB.regions].filter(isUpsert)) upsertCodeName('regions', 'region_name', op, true);
    for (const op of ops.org[TAB.districts].filter(isUpsert)) upsertDistrict(op);
    for (const op of depts.filter(isUpsert)) upsertCodeName('departments', 'department_name', op, true);
    for (const op of ops.org[TAB.facilities].filter(isUpsert)) upsertFacility(op);
    for (const op of ops.org[TAB.orgRoles].filter(isUpsert)) upsertCodeName('org_roles', 'role_name', op, false);
    for (const op of ops.org[TAB.titles].filter(isUpsert)) upsertCodeName('user_titles', 'title_name', op, false);
    for (const op of ops.users) writeUser(op, byOp.get(op));
    const removalOrder: OrgTab[] = [TAB.facilities, TAB.districts, TAB.regions, TAB.departments, TAB.orgRoles, TAB.titles];
    for (const tab of removalOrder) {
      for (const op of ops.org[tab].filter((o) => !isUpsert(o) && !(tab === TAB.departments && o.kind === 'delete'))) {
        removeEntity(tab, op);
      }
    }
  });

  return prepared.map((p) => ({
    name: `${p.op.values.first_name} ${p.op.values.last_name}`,
    email: p.op.values.email.toLowerCase(),
    username: p.username,
    temp_password: p.temp,
  }));
}

/** Prepare secrets, then apply (for callers that have no fingerprint to re-check). */
export async function applySetupOps(ops: SetupOps): Promise<Credential[]> {
  return applyPrepared(ops, await prepareSecrets(ops));
}
