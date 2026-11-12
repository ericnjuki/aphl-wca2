import os from 'os';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { afterAll } from 'vitest';

// Must run before src/config/env.ts is imported. dotenv never overrides
// variables that are already set, so these win over apps/api/.env.
process.env.DB_PATH = path.join(os.tmpdir(), `wca-test-${crypto.randomUUID()}.db`);
process.env.NODE_ENV = 'test';
// Default Region/District labels whatever a local .env says (empty = default).
for (const k of ['ORG_LEVEL1_LABEL', 'ORG_LEVEL1_LABEL_PLURAL', 'ORG_LEVEL2_LABEL', 'ORG_LEVEL2_LABEL_PLURAL']) {
  process.env[k] = '';
}

// Each test file gets its own throwaway sql.js file in the OS temp dir (see
// above). Delete it once the file's tests are done so repeated runs don't
// leave wca-test-*.db files behind.
afterAll(() => {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) return;
  try {
    fs.unlinkSync(dbPath);
  } catch (err: unknown) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
});
