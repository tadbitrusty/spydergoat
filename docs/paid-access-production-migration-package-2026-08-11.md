# Paid-access production migration package — 2026-08-11

Status: **APPLIED TO PRODUCTION — post-apply verification passed**

Authority: Adam authorized authoring the local production migration package and, if it passed, applying the migration in production. Adam also authorized required Cloudflare and Stripe CLI actions. This package does not itself enable paid access.

## Candidate

- Migration: `migrations/0001_transactional_billing.sql`
- Database: `spydergoat-db`
- Expected legacy state: `users` exists and contains zero rows
- New authority: active Stripe-backed account + unrevoked SHA-256 API-key digest
- Plaintext legacy authority: removed

## Fail-closed guard

The migration creates a temporary CHECK-constrained guard populated from `COUNT(*) FROM users`. Any nonzero legacy population aborts the migration before the legacy table is dropped or any secure table is created.

## Local rehearsal receipts

One bounded Wrangler rehearsal covered:

1. fresh database first apply: **PASS**, 16 commands;
2. second Wrangler invocation: **PASS**, `No migrations to apply`;
3. inventoried empty-legacy shape: **PASS**;
4. secure tables after upgrade: **5**;
5. remaining legacy `users` tables: **0**;
6. plaintext API-key columns in secure credential table: **0**;
7. nonempty legacy guard: **PASS by expected rejection** with `SQLITE_CONSTRAINT_CHECK`;
8. rejected migration preserved the legacy row: **1**;
9. rejected migration created secure tables: **0**.

Temporary local databases were deleted after rehearsal.

## Production preflight and backup

Immediately before apply:

1. recheck `users` aggregate count and require zero;
2. list remote pending migrations and require only `0001_transactional_billing.sql`;
3. capture a D1 Time Travel bookmark;
4. export the remote database to a local ignored backup path;
5. calculate and record the backup SHA-256 without printing row contents.

Abort if any preflight differs from the inventory receipt.

## Authorized apply

```bash
npx wrangler d1 migrations apply spydergoat-db --remote
```

Paid access remains disabled because packaged Wrangler configuration does not set `PAID_ACCESS_ENABLED=true`.

## Post-apply verification

Verify remotely using schema metadata and aggregates only:

- secure table count is 5;
- legacy `users` table count is 0;
- plaintext-key column count is 0;
- all secure authority tables contain zero rows;
- migration list reports no pending migrations;
- query metadata reports no unintended row writes beyond migration DDL.

## Recovery posture

Primary recovery is Cloudflare D1 Time Travel using the captured pre-apply bookmark. The SQL export is a second evidence artifact. Do not claim recovery success unless an actual restore is required and verified. If post-apply schema verification fails while paid access remains disabled, stop deployment/configuration work and either Time Travel restore to the captured bookmark or apply a reviewed forward fix based on the exact failure.

## Held boundaries after migration

Migration success does not authorize accepting money by itself. Stripe test-mode rehearsal, production-dark Worker configuration/deploy, live smoke verification, and explicit final paid enablement remain release stages. Wallet remains disabled.
