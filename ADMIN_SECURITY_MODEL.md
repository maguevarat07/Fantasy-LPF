# Fantasy LPF administrative security model

Status: implementation in repository; **not enabled in production until the PostgreSQL migration, encryption key, live RLS checks, and QA pass**.

## Protected assets and boundaries

The panel may read user identities, teams, transfers, leagues, scores, and sanitized pipeline state. It must never return password hashes, session hashes/tokens, MFA ciphertext, database credentials, Vault contents, queue bodies, or worker secrets.

Browser → Vercel API is an untrusted boundary. A browser cookie proves only possession of an opaque token. Normal sessions are stored by hash in `sessions`, in an `HttpOnly` cookie. The normal application database switches to `fantasy_lpf_app` in a transaction and applies owner RLS. Admin read queries use a **separate server-only PostgreSQL connection** (`ADMIN_DATABASE_URL`) logging in as `fantasy_lpf_admin_api`. That login is not an owner, has no `BYPASSRLS`, and can only `SET LOCAL ROLE fantasy_lpf_admin_reader` inside a transaction. The reader has no login, no `BYPASSRLS`, and only SELECT permissions with explicit RLS policies. The API checks `session_user` and the login's `BYPASSRLS`/superuser flags before changing role; a misconfigured privileged URL fails closed. `fantasy_lpf_app`, `anon`, and `authenticated` must have no direct or inherited membership of either admin role. The browser cannot select a SQL role. Normal credential validation, MFA state and session checks still use the existing server-only privileged connection; no admin data SELECT uses that connection.

HTTP admin data request → normal cookie authentication → application `ADMIN` role lookup → confirmed MFA and separate admin session → server-only `fantasy_lpf_admin_api` login → transaction `SET LOCAL ROLE fantasy_lpf_admin_reader` → PostgreSQL RLS → bounded SELECT. The dedicated login credential is different from `DATABASE_URL` and from worker/queue credentials. The migration creates it without a password; password provisioning and `ADMIN_DATABASE_URL` configuration are separate privileged cutover steps. Until provisioned, the new API entrypoint fails closed. The existing deployed API is unaffected by these new database objects.

## Authentication, roles and MFA

`admin_user_roles` stores the application role separately from editable profile data. Only a trusted database operator may change it. A database trigger appends grants, changes and revocations to `admin_audit_log`. The normal profile API rejects a `role` field. Every admin API request checks the normal session, current database role, confirmed TOTP credential, and a separate administrative session. A stolen normal session alone cannot enroll TOTP: enrollment requires the account password. TOTP is implemented by `otplib`; its seed is encrypted with AES-256-GCM using `ADMIN_MFA_ENCRYPTION_KEY` (32 random bytes encoded as base64, server-only). Missing/invalid key fails closed. The seed is shown to its owner only during enrollment, never in logs or subsequent API responses. Confirmed TOTP steps are recorded to reject replay.

The administrative cookie is `HttpOnly`, `Secure` and `SameSite=Strict` in production, with a hashed random token in `admin_sessions`. It has a 15-minute idle timeout and 8-hour absolute limit. New MFA proof replaces the previous admin session tied to that login. The admin session is tied to the normal session; logout deletes it, password change deletes all normal sessions, and role revocation is checked on every request. Future write actions must add recent password/TOTP step-up; none are enabled now.

## Web/API protections

All `/api/admin/*` data endpoints share authorization middleware. Queries are bounded, parameterized, and use fixed sort/filter allowlists. React renders user data as text. Same-origin checks protect state-changing admin requests; the application also rejects cross-site Origin/Fetch Metadata on ordinary writes. Admin and login/MFA attempts use database-backed rate limits shared across Vercel instances. Security headers include CSP, HSTS, nosniff, Referrer-Policy and frame protection. Admin responses use `Cache-Control: no-store`.

`/api/admin/migrate` historically allowed arbitrary SQL under `ENABLE_MIGRATION_ENDPOINT`, using `MIGRATION_SECRET` or `CRON_SECRET`. An unauthenticated production probe returned `404 NOT_FOUND` on 2026-10-06, so it was not exposed by the deployed version at that time. New code makes it unavailable when `NODE_ENV=production`, and the nonproduction endpoint requires its distinct `MIGRATION_SECRET`. Direct privileged PostgreSQL migration scripts remain the supported path; the endpoint is **not** part of the admin panel.

## Audit, recovery and remaining risks

`admin_audit_log` is append-oriented and inaccessible to browser roles or the admin reader. Role changes are logged by a database trigger; MFA enrollment, verification and admin logout are logged by the server. Logs omit passwords, tokens and MFA seeds. A trusted database operator must perform MFA recovery, role revocation or account disablement, preserving an audit trail. No browser recovery backdoor exists.

The production migration has **not** been applied. Supabase connectivity and a read-only table/column/RLS precheck succeeded on 2026-10-06, but backup/recovery readiness, isolated PostgreSQL security tests, the dedicated login credential, and post-migration acceptance are still pending. No real account was promoted. Do not deploy/enable the panel until those gates pass. A response of HTTP 200 for the SPA shell at `/admin` is not administrative access; every data endpoint denies unauthorized callers. The current release gate still requires verifying the exact HTTP behavior of `/admin` in production.
