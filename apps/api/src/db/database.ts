import initSqlJs, { Database, QueryExecResult, BindParams } from 'sql.js';
import fs from 'fs';
import path from 'path';
import env from '../config/env';

let db: Database | null = null;
let inTransaction = false;

/**
 * Returns the singleton sql.js database instance, initialising it on first
 * call.  The database is loaded from disk (env.dbPath) when it exists, or
 * created fresh otherwise.
 */
export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs({
    // Point sql.js at its WASM file bundled inside node_modules.
    locateFile: (file: string) =>
      path.join(__dirname, '../../node_modules/sql.js/dist/', file),
  });

  if (fs.existsSync(env.dbPath)) {
    const buffer = fs.readFileSync(env.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  console.log(`[db] opened → ${env.dbPath}`);
  return db;
}

/**
 * Serialise and write the in-memory database back to disk.
 */
export function persistDb(): void {
  if (!db) return;
  const data = db.export();
  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  fs.writeFileSync(env.dbPath, Buffer.from(data));
}

/**
 * Synchronous accessor — safe to call after getDb() has resolved at startup.
 */
export function getDbSync(): Database {
  if (!db) throw new Error('Database not initialised — call getDb() first');
  return db;
}

/**
 * Run a SELECT and return the rows as plain objects.
 */
export function query<T extends Record<string, unknown>>(
  sql: string,
  params: BindParams = [],
): T[] {
  if (!db) throw new Error('Database not initialised');

  const results: QueryExecResult[] = db.exec(sql, params);
  if (!results.length) return [];

  const { columns, values } = results[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])),
  ) as T[];
}

/**
 * Run multiple writes inside a single SQLite transaction.
 * Rolls back and re-throws on any error; persists on success.
 */
export function transaction<T>(fn: () => T): T {
  if (!db) throw new Error('Database not initialised');
  db.run('BEGIN');
  inTransaction = true;
  try {
    const result = fn();
    db.run('COMMIT');
    inTransaction = false;
    persistDb();
    return result;
  } catch (err) {
    inTransaction = false;
    try { db.run('ROLLBACK'); } catch { /* already rolled back or never started */ }
    throw err;
  }
}

/**
 * Execute a write statement (INSERT / UPDATE / DELETE / DDL).
 * Persists the database to disk after every write.
 */
export function execute(
  sql: string,
  params: BindParams = [],
): { changes: number; lastInsertRowid: number } {
  if (!db) throw new Error('Database not initialised');

  db.run(sql, params);
  if (!inTransaction) persistDb();

  return {
    changes: db.getRowsModified(),
    lastInsertRowid: Number(query<{ id: number }>('SELECT last_insert_rowid() AS id')[0]?.id ?? 0),
  };
}
