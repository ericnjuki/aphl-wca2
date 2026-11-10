# TODO

<!-- Rules: ~/.claude/doc-system.md (dated items, ≤3 lines each, Now ≤15, done = delete) -->

## Now

- (2026-11-10) Merge `origin/main` (Fred's 99 commits) and port our hosting switches onto his nginx
  layout, then deploy to UAT and prod: `plans/2026-11-10-upstream-merge.md` (signed off).
- (2026-09-16) Back up `aphl-wca-postgresdb-1` on prod to `~/Downloads/aphl-wca-postgres-backup-<date>.sql.gz`,
  then remove it and `aphl-wca-aphl-api-1`: step 4 of `plans/2026-09-16-wca-subpath-deploy.md`.
  Needs the user's go-ahead.

## Later

- (2026-11-10) Offer the hosting switches (BASE_PATH, external TLS, root redirect) upstream as a
  code-only PR from `fork` (see DECISIONS → Repo / Workflow). Needs the user's go-ahead.
