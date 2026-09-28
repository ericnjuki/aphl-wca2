import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Must run before src/config/env.ts is imported. dotenv never overrides
// variables that are already set, so these win over apps/api/.env.
process.env.DB_PATH = path.join(os.tmpdir(), `wca-test-${crypto.randomUUID()}.db`);
process.env.NODE_ENV = 'test';
