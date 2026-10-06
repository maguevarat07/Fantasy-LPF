# Admin cutover readiness — 2026-10-06

The administrative migration is **not applied** and the panel is **not deployed**. No real account has `ADMIN`.

## Database identity and privilege boundary

`/api/admin/*` authenticates the ordinary cookie using the existing server-side database, looks up the application `ADMIN` role, verifies confirmed TOTP and the independent administrative session, then sends *admin data reads* over `ADMIN_DATABASE_URL`. That URL must log in as `fantasy_lpf_admin_api`, a distinct LOGIN/NOINHERIT/NOBYPASSRLS non-owner. The application checks the session identity before `SET LOCAL ROLE fantasy_lpf_admin_reader`. The latter is NOLOGIN/NOINHERIT/NOBYPASSRLS with limited SELECT grants and explicit RLS policies. Browser input cannot choose either role. The admin login cannot use the pipeline credential and has no membership in `postgres` or another privileged role. The existing credential/session database connection remains privileged; that pre-existing backend trust boundary is not widened to perform admin data SELECTs.

The migration creates `fantasy_lpf_admin_api` **without a password**. A trusted Supabase project Owner must provision a random password through a privileged channel after migration, then configure a distinct server-only `ADMIN_DATABASE_URL` in Vercel. For the shared Supavisor pooler, the connection username is `fantasy_lpf_admin_api.[PROJECT-REF]` (the database session role remains `fantasy_lpf_admin_api`). Never commit, log, or return the password or URL. A misconfigured URL pointing at the existing `postgres` login fails closed at runtime. Supabase documents custom-role pooler connections at <https://supabase.com/docs/guides/database/connecting-to-postgres>.

## Migration review

Read-only production inventory found all 18 referenced tables, all explicitly granted columns, existing constraints, RLS enabled on those tables, and `postgres` ownership. The admin roles/tables/functions do not yet exist. The migration only creates new roles, five new tables and four functions, enables RLS on the **new** tables, and adds SELECT-only reader policies/grants on existing tables. It contains no DROP, TRUNCATE, existing-table recreation, scoring/pricing change, scheduler change, or real-user role promotion. The existing production SHA `928d5a0ffe58333de6408dfef1dd555950f61a14` does not query these new objects, so the migration is expected to be additive, non-destructive and backward-compatible. This is a static/precheck conclusion, not a completed migration acceptance.

**Gate before migration:** verify a usable backup and a tested recovery path. The project was last reported on Supabase Free; its current pricing lists automatic backups as unavailable and its backup guide recommends `supabase db dump` plus off-site storage for Free projects (<https://supabase.com/pricing>, <https://supabase.com/docs/guides/platform/backups>). No such verified backup or restore rehearsal is available in this workspace. Backup/recovery readiness is **NOT VERIFIED**, so the migration is blocked. Do not use the legacy `/api/admin/migrate` endpoint. No migration, role password, MFA key, or admin deployment should occur until this gate is satisfied.

## Test classification

All 24 previously skipped PostgreSQL integration tests are **B — mutating, isolated environment only**: 1 admin-role test creates a QA schema and global roles; 4 transfer tests create schema/policies and fixtures; 4 queue tests create a QA schema, queue and cron job; 15 scheduled-pipeline tests create schema/policies and sports fixtures. Do not run them against production for a numerical PASS. The test runner now requires `POSTGRES_TEST_ISOLATED=true` and rejects a test URL matching the configured production database/project. No local PostgreSQL server, Docker runtime, WSL distribution or separate Supabase QA project was available at this review, so these remain unexecuted.

**A — safe, read-only production acceptance** is a separate SQL suite: role attributes and direct/indirect memberships; `SET ROLE` denial for normal roles; read-only SELECT under the dedicated admin login and reader; privilege inspection for INSERT/UPDATE/DELETE/DDL and escalation; existing two-user RLS reads; schema/policy/grant checks; current deployment health. Operations that would write are checked through privileges or rolled-back transactions, never by changing real user data. Before migration, the two-user RLS read passed in both directions (zero cross-user rows); post-migration rerun remains pending.

## Cutover gates

1. Verify backup/recovery readiness and obtain an isolated PostgreSQL environment for all 24 integration tests.
2. Run the isolated tests, including a real dedicated-login, membership and `SET ROLE` test; resolve failures before production.
3. Apply only the reviewed migration through a privileged direct connection; do not promote users.
4. Verify objects, grants, role membership, reader SELECT and denied writes/escalation, plus the existing two-user RLS probes.
5. Provision the dedicated admin login secret and the independent MFA encryption key server-side; verify neither reaches the browser.
6. Run regression, then deploy only if CRITICAL/HIGH findings are zero; verify production SHA, `/api/admin/migrate` disabled, `/admin` smoke tests and Supabase Cron/Queues.
7. Stop before promoting any real account.
