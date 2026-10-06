// Usernames and temporary passwords for new accounts (admin form + workbook import).

import crypto from 'crypto';
import { query } from '../db/database';

export function generateTempPassword(): string {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

/**
 * `first.last` (lower-case, a–z 0–9 and dots), or `first.last_N` when taken.
 * `reserved` holds names already handed out in the same batch.
 */
export function generateUsername(firstName: string, lastName: string, reserved: Set<string> = new Set()): string {
  const base = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9.]/g, '') || 'user';
  const existing = new Set(
    query<{ user_name: string }>('SELECT user_name FROM users WHERE user_name LIKE ?', [`${base}%`]).map((r) => r.user_name),
  );
  const taken = (name: string) => existing.has(name) || reserved.has(name);
  if (!taken(base)) return base;
  let suffix = 2;
  while (taken(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}
