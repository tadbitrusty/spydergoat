# Paid-access production migration review — 2026-08-11

Status: **PASS — production migration applied and verified**

Scope: repository review at `acede06` plus separately authorized read-only production D1 inventory. Inventory receipt: `docs/paid-access-production-d1-inventory-2026-08-11.md`.

The reviewed migration was subsequently applied after preflight and backup. Post-apply schema and aggregate verification passed; see `docs/paid-access-production-dark-release-2026-08-11.md`.

## What passed

- `migrations/0001_transactional_billing.sql` builds a fresh disposable D1 schema and rejects a nonempty legacy `users` table atomically.
- The production repository/service code completes pending-account activation, digest-only credential authority, encrypted one-time delivery, exact 5,000-call accounting, wallet isolation, renewal, and cancellation against that fresh schema.
- The candidate migration contains no plaintext API-key column.
- Foreign-key/table ordering and D1 BLOB normalization worked in the disposable rehearsal.
- Wrangler applies `0001_transactional_billing.sql` once and reports no pending migration on the second local invocation.
- Independent runtime/security review found no material blocker in the candidate runtime.

## Production inventory result

The existing remote database contains only Cloudflare’s internal `_cf_KV` table plus the obsolete `users` table and `idx_users_api_key` index. The obsolete table definition permits plaintext `api_key` authority, but aggregate inventory found:

- zero `users` rows;
- zero plaintext key rows;
- zero Stripe-bound rows;
- zero distinct Stripe customers;
- no applied repository migrations.

Adam’s expected legitimate maximum was one historical self-customer and zero outside customers. The observed population of zero provides no evidence of unauthorized D1-backed paid users, but it also contains no record of Adam’s historical self-entitlement. Bank/Stripe payment receipts were not part of this D1 inventory.

## Resolved migration decision

No customer, key, wallet, period, or usage data requires conversion. The production migration should replace—not preserve—the empty legacy plaintext schema.

It must fail closed if the legacy `users` table has gained any row between inventory and apply. A nonempty result is a stop-line requiring a new reconciliation/security review; it must not silently hash, copy, delete, or expose credentials.

## Package closure

The local production package closes the migration blockers:

- the local-only artifact was replaced by immutable `migrations/0001_transactional_billing.sql`;
- a CHECK-constrained guard aborts atomically when legacy `users` is nonempty;
- fresh and inventoried-empty legacy shapes both apply through Wrangler;
- a second Wrangler invocation reports no pending migrations;
- rejection preserves the legacy row and creates no secure tables;
- exact preflight, Time Travel bookmark, SQL export, apply, post-apply verification, abort, and recovery steps are recorded in `docs/paid-access-production-migration-package-2026-08-11.md`.

Failed-payment behavior remains a required Stripe test-mode lifecycle gate; it is not a schema-apply blocker.

## Security assessment

No schema-level auth bypass or plaintext column was found in the new candidate. Nullable periods, unknown subscription statuses, malformed BLOBs, and mismatched delivery bindings fail closed in current runtime logic. Speculative extra constraints are not launch blockers.

The legacy plaintext risk is currently dormant because `users` is empty. The production migration must remove that empty authority surface and refuse to proceed if it becomes populated.

## Authorized next action

Run the single full release gate, capture production backup/Time Travel receipts, apply the migration remotely, and verify the secure empty schema. Paid access remains disabled until the separately verified Stripe and production-dark stages pass.
