# Old app (aphl-wca, Postgres) vs new app (aphl-wca2, sql.js): assessment

_2026-11-10. Read-only on prod. All figures are aggregates; no personal values were read._

## Bottom line

**Postgres was not "replaced" inside one codebase. These are two unrelated applications.**

- **Old app (`aphl-wca`)**: built 2024 by Matt Marshall, Ross Norvell and Jason Phelps (PRs from
  `J-Michael-Consulting`). Express + Sequelize + Postgres 14.5, CRA UI. Our fork is
  `ericnjuki/aphl-wca`. Prod runs branch `b4` at `02726c76` (2025-08-26, Eric: "skipping sync").
- **New app (`workforce-competency`, deployed as `aphl-wca2`)**: a from-scratch rewrite by
  Fredrick Mwasekaga (APHL). Its first commit (`8c5b0b9`, 2026-04-22, 250 files) already used sql.js.
  `git log --all -S` finds **no** `pg`/`sequelize`/Postgres code anywhere in its history; the only
  hits are our own docs. It shares no code and no schema with the old app.
- So the "switch" happened when APHL started the new codebase in April 2026, not in any merge.
  Today's merge (`b761282`) only brought in upstream's enhancements on top of an app that was
  already SQLite-based. **There is no data migration path from old to new in either codebase.**

## Old app on prod

| | |
|---|---|
| Containers | `aphl-wca-aphl-api-1` (:6868, `npm run dev` under nodemon) and `aphl-wca-postgresdb-1` (:5434). Created 2025-08-26 from `~/projects/aphl-wca/docker-compose.yml` |
| State | **Running** (up ~31 h, since the last host restart), so not "dead" as DECISIONS says. **Idle**: no writes since stats reset (2026-11-09), only startup lines in 72 h of API logs, and no established connections on :6868 |
| Data | **Named volume `aphl-wca_pgdata`** (mounted at `/var/lib/postgresql/data` and also at `/alpha-db`). It survives container removal unless the volume itself is removed (`down -v` / `volume rm`). DB `aphl_db`, 12 MB |

**Tables (exact row counts):**

| Table | Rows | Notes |
|---|---:|---|
| users | 41 | created 2025-04-24 to 2025-05-22; 1 admin; 11 never changed their first password; 0 disabled |
| user_assessments | 60 | 23 people assessed, by 23 administrators, 2025-05-13 to 2025-05-23 |
| assessment_question_responses | 6,094 | integer 0–4 (avg 2.45), all 60 assessments have responses |
| assessments | 15 | codes BIO…WFT; **only `INF` has questions** |
| assessment_versions / assessment_questions | 1 / 96 | the INF catalogue |
| user_permissions / user_roles | 39 / 5 | 32 Facility Personnel, 4 Facility Directors, 2 Regional Admins, 1 Dept Manager |
| facilities / facility_departments / facility_regions | 3,993 / 3,993 / 7,995 | national facility list |
| regions / departments / user_titles / appendixes | 367 / 12 / 6 / 176 | |

There are also 3 views (`facility_users`, `facility_department_users`, `region_users`). The `users`
columns are names, `national_unique_id`, email, username, `password`, title, `is_admin`,
`is_first_time_login`, `is_enabled`, a password reset token and its expiry, and timestamps.

**Auth:** bcryptjs, cost 10 (all 41 hashes are `$2…`). Login issues a **JWT** (HS256, `JWT_SECRET`
env, 2-day expiry), returned in the body and as an `httpOnly` `jwt` cookie. The API reads it from
`Authorization: Bearer`. It is stateless, so there is no server-side session or revocation.

## New app on prod

| | |
|---|---|
| Storage | sql.js (SQLite in memory, persisted to file) at `/app/apps/api/data/workforce.db` on **named volume `aphl-wca2_api_data`** |
| Migrations | 11, tracked in a `migrations` table. 1–8 applied 2026-09-16 (first deploy), 9–11 applied today |
| Content | 2 users, 4 user_assessments, 23 responses, 1 region, 1 facility, 10 departments; catalogue of 20 domains / 511 items / 1 footnote |
| Auth | bcryptjs cost 12 (10 for bulk-imported temporary passwords). **Server-side sessions** (`express-session`, stored in the SQLite `sessions` table): cookie `httpOnly`, `sameSite=lax`, `secure` set by config, 8 h max age. Login is rate-limited. Users are forced to change their password on first login |

## Comparison

| | Old (aphl-wca) | New (aphl-wca2) |
|---|---|---|
| DB | Postgres 14.5, Sequelize | SQLite via sql.js, hand-written SQL migrations |
| Real usage | 41 users, 60 assessments, 6,094 answers (May 2025 pilot) | 2 users, 4 assessments (test use) |
| Catalogue | 15 assessments, 1 populated (INF, 96 questions) | 20 domains, 511 items |
| Response model | one integer per `assessment_question_id` per assessment | per domain: `survey_data` JSON + rows keyed by `domain_code` and competency/subcompetency value, with a review workflow |
| Org model | 3,993 facilities, 367 regions, permission rows per scope | regions → districts → facilities, `user_regions`, archive flags |
| Auth | JWT, 2 days, stateless | session cookie, 8 h, revocable |

**If the May 2025 pilot data should carry over:** password hashes are bcrypt in both, so user
accounts could be moved without resetting passwords. Responses would need mapping from the old INF
questions to the new catalogue by competency/subcompetency value. That mapping is unverified and
would be a separate, planned piece of work.

## Outstanding

- **Done (2026-11-10):** `pg_dump` streamed from prod to UAT
  `~/backups/aphl-wca-postgres-backup-2026-11-10.sql.gz` (200 KB, sha256 `df28dce1…`). All 15 tables'
  row counts match the live DB. The old containers were then **stopped** (Postgres exit 0); the
  containers and the `aphl-wca_pgdata` volume are kept. Restore: `docker start aphl-wca-postgresdb-1
  aphl-wca-aphl-api-1`, or load the dump into a fresh `postgres:14.5`.
- **Done (2026-11-10, user's instruction):** the containers and the `aphl-wca_pgdata` volume were deleted.
  The image, networks and `~/projects/aphl-wca` checkout followed. The dump (sha256 `df28dce1…`) is kept in
  three places: UAT and server 46 `~/backups/` (mode 600) and local `~/Downloads`. Restore: load it into a
  fresh `postgres:14.5` container.
