# TODO

<!-- Rules: ~/.claude/doc-system.md (dated items, ≤3 lines each, Now ≤15, done = delete) -->

## Now

- (2026-11-12) Role model rework: plan `plans/2026-11-12-role-model.md` (signed off, in progress).
  Code, live pass and UI follow-ups done; remaining: deploy to UAT/prod (HANDOFF → Next).
- (2026-11-12) Email for account-created / password-reset (no mail code exists yet). Separate plan after the
  role model. Open: which SMTP/provider (NPHL relay, M365, Brevo/SendGrid?) and whether to mail on create too.

## Later

- (2026-11-10) Deferred: blank page after deploy (stale `index.html` → 404 on lazy chunks, "Failed to fetch
  dynamically imported module"; a reload fixes it). `index.html` has no Cache-Control. Candidate fix:
  `add_header Cache-Control "no-cache" always;` in `location ${BASE_PATH}/` of `nginx/snippets/wca-app.conf.template`.

- (2026-11-10) Deferred: Chrome logs "Permissions-Policy: Unrecognized feature" (attribution-reporting,
  private-aggregation, join-ad-interest-group, run-ad-auction, browsing-topics). Not from our nginx or
  API, and not on `/wca/` at either layer. Harmless.

- (2026-11-10) `apps/web/index.html` favicon points at `/vite.svg`, which doesn't exist (also broken
  upstream) and ignores `BASE_PATH`. Cosmetic.

- (2026-11-10) Offer the hosting switches (BASE_PATH, external TLS, root redirect) upstream as a
  code-only PR from `fork` (see DECISIONS → Repo / Workflow). Needs the user's go-ahead.
