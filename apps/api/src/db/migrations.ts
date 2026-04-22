import { Database } from "sql.js";

/**
 * All schema migrations in order.  Each entry is applied once; add new ones
 * at the end — never edit existing entries.
 */
const migrations: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        id      INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        email           TEXT    NOT NULL UNIQUE,
        first_name      TEXT    NOT NULL,
        last_name       TEXT    NOT NULL,
        national_id     TEXT    NOT NULL,
        id_type         TEXT    NOT NULL,
        user_name       TEXT    NOT NULL UNIQUE,
        password        TEXT    NOT NULL,
        is_first_login  BOOLEAN NOT NULL DEFAULT TRUE,
        is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
        role            TEXT    NOT NULL DEFAULT 'staff',
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(national_id, id_type)
      );

      CREATE TABLE IF NOT EXISTS departments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS assessments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        category     TEXT    NOT NULL,
        version      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_assessments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        status        TEXT    NOT NULL DEFAULT 'pending',
        score         REAL,
        completed_at  TEXT,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, assessment_id)
      );
    `,
  },
  {
    id: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT    PRIMARY KEY,
        data       TEXT    NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 3,
    sql: `
      -- Replace user_assessments with a version that supports multiple
      -- completed sessions per (user, domain) while enforcing only one
      -- in_progress session at a time.

      DROP TABLE IF EXISTS user_assessments;

      CREATE TABLE IF NOT EXISTS user_assessments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain_code  TEXT    NOT NULL,
        domain_name  TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'in_progress'
                             CHECK(status IN ('in_progress', 'completed', 'abandoned')),
        survey_data  TEXT,
        ui_state     TEXT,
        score        REAL,
        started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      -- Partial unique: only one in_progress per (user, domain) at a time.
      -- Completed rows for the same pair are unlimited (tracks history).
      CREATE UNIQUE INDEX IF NOT EXISTS uq_user_assessment_in_progress
        ON user_assessments(user_id, domain_code)
        WHERE status = 'in_progress';
    `,
  },
  {
    id: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS assessment_domains (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name       TEXT    NOT NULL,
        version    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS assessment_items (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id           INTEGER NOT NULL REFERENCES assessment_domains(id) ON DELETE CASCADE,
        competency_value    TEXT    NOT NULL,
        competency_text     TEXT    NOT NULL,
        subcompetency_value TEXT    NOT NULL,
        subcompetency_text  TEXT    NOT NULL,
        beginner            TEXT    NOT NULL DEFAULT '',
        competent           TEXT    NOT NULL DEFAULT '',
        proficient          TEXT    NOT NULL DEFAULT '',
        expert              TEXT    NOT NULL DEFAULT '',
        na                  TEXT    NOT NULL DEFAULT '',
        sort_order          INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    id: 5,
    sql: `
      -- Organisational reference tables

      DROP TABLE IF EXISTS departments;
      CREATE TABLE IF NOT EXISTS departments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name       TEXT    NOT NULL UNIQUE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS regions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name       TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS facilities (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        code            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name            TEXT    NOT NULL,
        facility_type   TEXT,
        region_id       INTEGER REFERENCES regions(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS facility_departments (
        facility_id   INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        PRIMARY KEY (facility_id, department_id)
      );

      CREATE TABLE IF NOT EXISTS org_roles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name       TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_titles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name       TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    id: 6,
    sql: `
      -- Extend users with organisational context + temp password for admin visibility

      ALTER TABLE users ADD COLUMN facility_id   INTEGER REFERENCES facilities(id)   ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id)  ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN org_role_id   INTEGER REFERENCES org_roles(id)    ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN title_id      INTEGER REFERENCES user_titles(id)  ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN temp_password TEXT;
    `,
  },
  {
    id: 7,
    sql: `
      -- Granular per-subcompetency responses — aggregated by the reports API.
      -- Written on survey completion from the SurveyJS JSON blob.
      -- Org context (facility/department/region) is snapshotted at completion
      -- time so historical reports survive later user reassignment.

      CREATE TABLE IF NOT EXISTS user_assessment_responses (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        user_assessment_id  INTEGER NOT NULL REFERENCES user_assessments(id) ON DELETE CASCADE,
        user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain_id           INTEGER REFERENCES assessment_domains(id) ON DELETE SET NULL,
        domain_code         TEXT    NOT NULL,
        competency_value    TEXT    NOT NULL,
        subcompetency_value TEXT    NOT NULL,
        response_level      INTEGER NOT NULL CHECK(response_level BETWEEN 0 AND 4),
        response_text       TEXT,
        facility_id         INTEGER REFERENCES facilities(id)  ON DELETE SET NULL,
        department_id       INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        region_id           INTEGER REFERENCES regions(id)     ON DELETE SET NULL,
        created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_uar_region     ON user_assessment_responses(region_id, domain_code, competency_value);
      CREATE INDEX IF NOT EXISTS idx_uar_facility   ON user_assessment_responses(facility_id, domain_code, competency_value);
      CREATE INDEX IF NOT EXISTS idx_uar_department ON user_assessment_responses(department_id, domain_code, competency_value);
      CREATE INDEX IF NOT EXISTS idx_uar_user       ON user_assessment_responses(user_id, domain_code);
      CREATE INDEX IF NOT EXISTS idx_uar_assessment ON user_assessment_responses(user_assessment_id);

      -- Review workflow fields on the existing sessions table.
      ALTER TABLE user_assessments ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK(review_status IN ('pending','approved','rejected'));
      ALTER TABLE user_assessments ADD COLUMN reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE user_assessments ADD COLUMN reviewed_at   TEXT;
      ALTER TABLE user_assessments ADD COLUMN review_notes  TEXT;
    `,
  },
];

export async function runMigrations(db: Database): Promise<void> {
  // Ensure the migrations table exists before querying it.
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set<number>(
    db
      .exec("SELECT id FROM migrations")
      .flatMap((r) => r.values.map((row) => row[0] as number)),
  );

  let ran = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.run(migration.sql);
    db.run("INSERT INTO migrations (id) VALUES (?)", [migration.id]);
    console.log(`[db] migration ${migration.id} applied`);
    ran++;
  }

  if (ran === 0) {
    console.log("[db] schema up-to-date");
  }
}
