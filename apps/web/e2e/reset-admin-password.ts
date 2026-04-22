// Deterministic fixture setup for e2e tests.
//
// Reads the API's on-disk sqlite database, force-resets the admin user's
// password to TEST_ADMIN_PASSWORD, and clears the first-login flag so
// Playwright never has to go through the change-password dialog.
//
// Kept out of the app source tree so test fixtures can't leak into prod.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';

export const TEST_ADMIN_USERNAME = 'admin';
export const TEST_ADMIN_PASSWORD = 'TestAdmin123!';

// ESM-safe __dirname: web/ is `"type": "module"`.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DB_PATH = path.resolve(HERE, '..', '..', 'api', 'data', 'workforce.db');

export async function resetAdminPassword(): Promise<void> {
  if (!fs.existsSync(API_DB_PATH)) {
    throw new Error(
      `API database not found at ${API_DB_PATH}. ` +
      `Start the API at least once before running e2e tests.`,
    );
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(API_DB_PATH));

  const hashed = await bcrypt.hash(TEST_ADMIN_PASSWORD, 12);
  db.run(
    `UPDATE users
     SET password = ?, is_first_login = 0, is_enabled = 1, temp_password = NULL
     WHERE user_name = ?`,
    [hashed, TEST_ADMIN_USERNAME],
  );

  fs.writeFileSync(API_DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log(`[e2e] admin password reset → ${TEST_ADMIN_PASSWORD}`);
}

